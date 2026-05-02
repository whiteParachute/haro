import { Hono } from 'hono';
import { CheckpointStore, PermissionBudgetStore, db as haroDb } from '@haro/core';
import type { WorkflowCheckpoint, WorkflowPermissionBudgetSummary } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createWorkflowsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => {
    const limit = readLimit(c.req.query('limit'));
    const workflowIds = listWorkflowIds(runtime, limit);
    const checkpointStore = openCheckpointStore(runtime);
    const guardStore = openGuardStore(runtime);
    try {
      const items = workflowIds
        .map((workflowId) => {
          const checkpoint = checkpointStore.loadLatest(workflowId);
          return checkpoint
            ? toWorkflowSummary(checkpoint, guardStore.readWorkflowPermissionBudgetSummary(workflowId))
            : null;
        })
        .filter((item): item is ReturnType<typeof toWorkflowSummary> => item !== null);
      return c.json({
        success: true,
        data: {
          items,
          limit,
          count: items.length,
        },
      });
    } finally {
      checkpointStore.close();
      guardStore.close();
    }
  });

  route.get('/:id/checkpoints', (c) => {
    const store = openCheckpointStore(runtime);
    try {
      const checkpointId = c.req.query('checkpointId');
      const checkpoints = store.loadAll(c.req.param('id'));
      if (checkpointId) {
        const checkpoint = checkpoints.find((candidate) => candidate.id === checkpointId);
        if (!checkpoint) {
          return c.json(
            {
              success: false,
              message: `Checkpoint '${checkpointId}' was not found for workflow '${c.req.param('id')}'.`,
            },
            404,
          );
        }
        return c.json({
          success: true,
          data: {
            workflowId: c.req.param('id'),
            checkpointId,
            detail: toCheckpointDetail(checkpoint),
          },
        });
      }
      return c.json({
        success: true,
        data: {
          workflowId: c.req.param('id'),
          items: checkpoints.map((checkpoint) => toCheckpointMetadata(checkpoint)),
          count: checkpoints.length,
        },
      });
    } finally {
      store.close();
    }
  });

  route.get('/:id', (c) => {
    const workflowId = c.req.param('id');
    const checkpointStore = openCheckpointStore(runtime);
    const guardStore = openGuardStore(runtime);
    try {
      const checkpoint = checkpointStore.loadLatest(workflowId);
      if (!checkpoint) {
        return c.json(
          {
            success: false,
            message: `Workflow '${workflowId}' was not found.`,
          },
          404,
        );
      }
      const checkpoints = checkpointStore.loadAll(workflowId);
      return c.json({
        success: true,
        data: toWorkflowDetail(checkpoint, guardStore.readWorkflowPermissionBudgetSummary(workflowId), checkpoints),
      });
    } finally {
      checkpointStore.close();
      guardStore.close();
    }
  });

  return route;
}

function openCheckpointStore(runtime: WebRuntime): CheckpointStore {
  return new CheckpointStore({
    root: runtime.root,
    dbFile: runtime.dbFile,
  });
}

function openGuardStore(runtime: WebRuntime): PermissionBudgetStore {
  return new PermissionBudgetStore({
    root: runtime.root,
    dbFile: runtime.dbFile,
  });
}

function listWorkflowIds(runtime: WebRuntime, limit: number): string[] {
  const opened = haroDb.initHaroDatabase({
    root: runtime.root,
    dbFile: runtime.dbFile,
    keepOpen: true,
  });
  const database = opened.database!;
  try {
    const rows = database
      .prepare(
        `SELECT workflow_id
           FROM workflow_checkpoints
       GROUP BY workflow_id
       ORDER BY MAX(created_at) DESC
          LIMIT ?`,
      )
      .all(limit) as Array<{ workflow_id: string }>;
    return rows.map((row) => row.workflow_id);
  } finally {
    database.close();
  }
}

function readLimit(value: string | undefined): number {
  if (!value) return 20;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, parsed));
}

function toCheckpointMetadata(checkpoint: WorkflowCheckpoint, options: { includeNodeType?: boolean } = {}) {
  return {
    checkpointId: checkpoint.id,
    workflowId: checkpoint.workflowId,
    nodeId: checkpoint.nodeId,
    ...(options.includeNodeType ? { nodeType: checkpoint.state.nodeType } : {}),
    status: readCheckpointStatus(checkpoint),
    createdAt: checkpoint.createdAt,
  };
}

function toCheckpointDetail(checkpoint: WorkflowCheckpoint) {
  return {
    ...toCheckpointMetadata(checkpoint),
    rawJson: checkpoint.state,
    sceneDescriptor: checkpoint.state.sceneDescriptor,
    routingDecision: checkpoint.state.routingDecision,
    rawContextRefs: checkpoint.state.rawContextRefs,
    branchState: checkpoint.state.branchState,
    leafSessionRefs: checkpoint.state.leafSessionRefs,
    budgetState: checkpoint.state.budget ?? null,
  };
}

function readCheckpointStatus(checkpoint: WorkflowCheckpoint): string | null {
  const branchState = checkpoint.state.branchState;
  if (typeof branchState.status === 'string') return branchState.status;
  if (typeof branchState.teamStatus === 'string') return branchState.teamStatus;
  return null;
}

function toWorkflowSummary(checkpoint: WorkflowCheckpoint, guardSummary: WorkflowPermissionBudgetSummary) {
  const branchState = checkpoint.state.branchState;
  const branchLedger = readBranchLedger(branchState);
  return {
    workflowId: checkpoint.workflowId,
    executionMode: checkpoint.state.routingDecision.executionMode,
    orchestrationMode: checkpoint.state.routingDecision.orchestrationMode,
    workflowTemplateId: checkpoint.state.routingDecision.workflowTemplateId,
    templateId: checkpoint.state.routingDecision.workflowTemplateId,
    status: readCheckpointStatus(checkpoint) ?? 'unknown',
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.createdAt,
    currentNodeId: checkpoint.nodeId,
    blockedReason: readBlockedReason(branchState, guardSummary),
    branchLedger,
    mergeEnvelope: readMergeEnvelope(branchState),
    leafSessionRefs: checkpoint.state.leafSessionRefs,
    rawContextRefs: checkpoint.state.rawContextRefs,
    latestCheckpointRef: checkpoint.id,
    recentCheckpointRef: checkpoint.id,
    stalledBranches: branchLedger.filter(isStalledBranch),
    ...(guardSummary.budget ? { budgetState: toBudgetState(guardSummary) } : {}),
    ...(hasPermissionEvents(guardSummary) ? { permissionState: toPermissionState(guardSummary) } : {}),
  };
}

function toWorkflowDetail(
  checkpoint: WorkflowCheckpoint,
  guardSummary: WorkflowPermissionBudgetSummary,
  checkpoints: WorkflowCheckpoint[],
) {
  const summary = toWorkflowSummary(checkpoint, guardSummary);
  return {
    ...summary,
    checkpoints: checkpoints.map((candidate) => toCheckpointMetadata(candidate, { includeNodeType: true })),
    budgetPermissionSummary: {
      ...(summary.budgetState ? { budget: summary.budgetState } : {}),
      permissions: {
        denied: guardSummary.permissions.denied,
        needsApproval: guardSummary.permissions.needsApproval,
      },
    },
  };
}

function readBranchLedger(branchState: Record<string, unknown>): Array<Record<string, unknown>> {
  const branches = branchState.branches;
  if (Array.isArray(branches)) {
    return branches.filter(isRecord);
  }
  if (isRecord(branches)) {
    return Object.values(branches).filter(isRecord);
  }
  return [];
}

function readMergeEnvelope(branchState: Record<string, unknown>): Record<string, unknown> | null {
  const merge = branchState.merge;
  if (!isRecord(merge)) return null;
  const envelope = merge.envelope;
  if (isRecord(envelope)) return envelope;
  return merge;
}

function readBlockedReason(
  branchState: Record<string, unknown>,
  guardSummary: WorkflowPermissionBudgetSummary,
): string | undefined {
  if (typeof guardSummary.blockedReason === 'string') return guardSummary.blockedReason;
  if (guardSummary.budget && guardSummary.budget.state !== 'ok') return 'budget';
  if (guardSummary.budgetExceeded) return 'budget';
  if (hasPermissionEvents(guardSummary)) return 'permission';
  if (typeof branchState.blockedReason === 'string') return branchState.blockedReason;
  const merge = branchState.merge;
  if (isRecord(merge) && typeof merge.blockedReason === 'string') return merge.blockedReason;
  return undefined;
}

function isStalledBranch(branch: Record<string, unknown>): boolean {
  return (
    typeof branch.lastError === 'string' ||
    branch.status === 'failed' ||
    branch.status === 'timed-out' ||
    branch.status === 'cancelled'
  );
}

function toBudgetState(summary: WorkflowPermissionBudgetSummary) {
  const budget = summary.budget!;
  return {
    budgetId: budget.budgetId,
    usedTokens: budget.usedTotalTokens,
    limitTokens: budget.limitTokens,
    state: budget.state,
  };
}

function toPermissionState(summary: WorkflowPermissionBudgetSummary) {
  const requiredClass = summary.permissions.events.find((event) => event.operationClass)?.operationClass;
  if (summary.permissions.denied > 0) return { ...(requiredClass ? { requiredClass } : {}), state: 'denied' };
  if (summary.permissions.needsApproval > 0) return { ...(requiredClass ? { requiredClass } : {}), state: 'needs-approval' };
  return { ...(requiredClass ? { requiredClass } : {}), state: 'allowed' };
}

function hasPermissionEvents(summary: WorkflowPermissionBudgetSummary): boolean {
  return summary.permissions.events.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
