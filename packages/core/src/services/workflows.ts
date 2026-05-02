import { initHaroDatabase } from '../db/index.js';
import { CheckpointStore } from '../scenario-router.js';
import {
  PermissionBudgetStore,
  type WorkflowPermissionBudgetSummary,
} from '../permission-budget.js';
import type { WorkflowCheckpoint } from '../scenario-router.js';
import { HaroError } from '../errors/index.js';
import type { ServiceContext } from './types.js';

export interface ListWorkflowsOptions {
  limit?: number;
}

export interface CheckpointMetadata {
  checkpointId: string;
  workflowId: string;
  nodeId: string;
  nodeType?: string;
  status: string | null;
  createdAt: string;
}

export interface CheckpointDetail extends CheckpointMetadata {
  rawJson: unknown;
  sceneDescriptor: unknown;
  routingDecision: unknown;
  rawContextRefs: unknown;
  branchState: unknown;
  leafSessionRefs: unknown;
  budgetState: unknown;
}

export interface WorkflowSummary {
  workflowId: string;
  executionMode: string;
  orchestrationMode?: string;
  workflowTemplateId: string | undefined;
  templateId: string | undefined;
  status: string;
  createdAt: string;
  updatedAt: string;
  currentNodeId: string;
  blockedReason?: string;
  branchLedger: Array<Record<string, unknown>>;
  mergeEnvelope: Record<string, unknown> | null;
  leafSessionRefs: unknown;
  rawContextRefs: unknown;
  latestCheckpointRef: string;
  recentCheckpointRef: string;
  stalledBranches: Array<Record<string, unknown>>;
  budgetState?: { budgetId: string; usedTokens: number; limitTokens: number; state: string };
  permissionState?: { state: string; requiredClass?: string };
}

export interface WorkflowDetail extends WorkflowSummary {
  checkpoints: CheckpointMetadata[];
  budgetPermissionSummary: {
    budget?: WorkflowSummary['budgetState'];
    permissions: { denied: number; needsApproval: number };
  };
}

export function listWorkflows(
  ctx: ServiceContext,
  options: ListWorkflowsOptions = {},
): { items: WorkflowSummary[]; limit: number; count: number } {
  const limit = clampLimit(options.limit, 20);
  const workflowIds = listWorkflowIds(ctx, limit);
  const checkpointStore = openCheckpointStore(ctx);
  const guardStore = openGuardStore(ctx);
  try {
    const items = workflowIds
      .map((workflowId) => {
        const checkpoint = checkpointStore.loadLatest(workflowId);
        return checkpoint
          ? toWorkflowSummary(checkpoint, guardStore.readWorkflowPermissionBudgetSummary(workflowId))
          : null;
      })
      .filter((item): item is WorkflowSummary => item !== null);
    return { items, limit, count: items.length };
  } finally {
    checkpointStore.close();
    guardStore.close();
  }
}

export function getWorkflow(ctx: ServiceContext, workflowId: string): WorkflowDetail {
  const checkpointStore = openCheckpointStore(ctx);
  const guardStore = openGuardStore(ctx);
  try {
    const checkpoint = checkpointStore.loadLatest(workflowId);
    if (!checkpoint) {
      throw new HaroError('WORKFLOW_NOT_FOUND', `Workflow '${workflowId}' was not found.`, {
        remediation: 'Run `haro workflow list` to discover known workflow ids',
      });
    }
    const checkpoints = checkpointStore.loadAll(workflowId);
    return toWorkflowDetail(checkpoint, guardStore.readWorkflowPermissionBudgetSummary(workflowId), checkpoints);
  } finally {
    checkpointStore.close();
    guardStore.close();
  }
}

export function listWorkflowCheckpoints(
  ctx: ServiceContext,
  workflowId: string,
): { workflowId: string; items: CheckpointMetadata[]; count: number } {
  const store = openCheckpointStore(ctx);
  try {
    const checkpoints = store.loadAll(workflowId);
    return {
      workflowId,
      items: checkpoints.map((checkpoint) => toCheckpointMetadata(checkpoint)),
      count: checkpoints.length,
    };
  } finally {
    store.close();
  }
}

export function getWorkflowCheckpoint(
  ctx: ServiceContext,
  workflowId: string,
  checkpointId: string,
): { workflowId: string; checkpointId: string; detail: CheckpointDetail } {
  const store = openCheckpointStore(ctx);
  try {
    const checkpoints = store.loadAll(workflowId);
    const checkpoint = checkpoints.find((candidate) => candidate.id === checkpointId);
    if (!checkpoint) {
      throw new HaroError(
        'WORKFLOW_CHECKPOINT_NOT_FOUND',
        `Checkpoint '${checkpointId}' was not found for workflow '${workflowId}'.`,
        { remediation: 'Run `haro workflow checkpoints <id>` to list available checkpoints' },
      );
    }
    return { workflowId, checkpointId, detail: toCheckpointDetail(checkpoint) };
  } finally {
    store.close();
  }
}

function openCheckpointStore(ctx: ServiceContext): CheckpointStore {
  return new CheckpointStore({ ...(ctx.root ? { root: ctx.root } : {}), ...(ctx.dbFile ? { dbFile: ctx.dbFile } : {}) });
}

function openGuardStore(ctx: ServiceContext): PermissionBudgetStore {
  return new PermissionBudgetStore({ ...(ctx.root ? { root: ctx.root } : {}), ...(ctx.dbFile ? { dbFile: ctx.dbFile } : {}) });
}

function listWorkflowIds(ctx: ServiceContext, limit: number): string[] {
  const opened = initHaroDatabase({ root: ctx.root, dbFile: ctx.dbFile, keepOpen: true });
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

function clampLimit(raw: number | undefined, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
}

function toCheckpointMetadata(
  checkpoint: WorkflowCheckpoint,
  options: { includeNodeType?: boolean } = {},
): CheckpointMetadata {
  return {
    checkpointId: checkpoint.id,
    workflowId: checkpoint.workflowId,
    nodeId: checkpoint.nodeId,
    ...(options.includeNodeType ? { nodeType: checkpoint.state.nodeType } : {}),
    status: readCheckpointStatus(checkpoint),
    createdAt: checkpoint.createdAt,
  };
}

function toCheckpointDetail(checkpoint: WorkflowCheckpoint): CheckpointDetail {
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
  const branchState = checkpoint.state.branchState as Record<string, unknown>;
  if (typeof branchState.status === 'string') return branchState.status;
  if (typeof branchState.teamStatus === 'string') return branchState.teamStatus;
  return null;
}

function toWorkflowSummary(
  checkpoint: WorkflowCheckpoint,
  guardSummary: WorkflowPermissionBudgetSummary,
): WorkflowSummary {
  const branchState = checkpoint.state.branchState as Record<string, unknown>;
  const branchLedger = readBranchLedger(branchState);
  const summary: WorkflowSummary = {
    workflowId: checkpoint.workflowId,
    executionMode: checkpoint.state.routingDecision.executionMode,
    ...(checkpoint.state.routingDecision.orchestrationMode
      ? { orchestrationMode: checkpoint.state.routingDecision.orchestrationMode }
      : {}),
    workflowTemplateId: checkpoint.state.routingDecision.workflowTemplateId,
    templateId: checkpoint.state.routingDecision.workflowTemplateId,
    status: readCheckpointStatus(checkpoint) ?? 'unknown',
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.createdAt,
    currentNodeId: checkpoint.nodeId,
    branchLedger,
    mergeEnvelope: readMergeEnvelope(branchState),
    leafSessionRefs: checkpoint.state.leafSessionRefs,
    rawContextRefs: checkpoint.state.rawContextRefs,
    latestCheckpointRef: checkpoint.id,
    recentCheckpointRef: checkpoint.id,
    stalledBranches: branchLedger.filter(isStalledBranch),
  };
  const blockedReason = readBlockedReason(branchState, guardSummary);
  if (blockedReason) summary.blockedReason = blockedReason;
  if (guardSummary.budget) summary.budgetState = toBudgetState(guardSummary);
  if (hasPermissionEvents(guardSummary)) summary.permissionState = toPermissionState(guardSummary);
  return summary;
}

function toWorkflowDetail(
  checkpoint: WorkflowCheckpoint,
  guardSummary: WorkflowPermissionBudgetSummary,
  checkpoints: WorkflowCheckpoint[],
): WorkflowDetail {
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
  if (Array.isArray(branches)) return branches.filter(isRecord);
  if (isRecord(branches)) return Object.values(branches).filter(isRecord);
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

function toBudgetState(summary: WorkflowPermissionBudgetSummary): NonNullable<WorkflowSummary['budgetState']> {
  const budget = summary.budget!;
  return {
    budgetId: budget.budgetId,
    usedTokens: budget.usedTotalTokens,
    limitTokens: budget.limitTokens,
    state: budget.state,
  };
}

function toPermissionState(summary: WorkflowPermissionBudgetSummary): NonNullable<WorkflowSummary['permissionState']> {
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
