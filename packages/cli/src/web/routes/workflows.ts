import { Hono } from 'hono';
import { PermissionBudgetStore, db as haroDb, type WorkflowPermissionBudgetSummary } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

type JsonRecord = Record<string, unknown>;

type DatabaseLike = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

interface CheckpointRow {
  id: string;
  workflow_id: string;
  node_id: string;
  state: string;
  created_at: string;
}

interface WorkflowCheckpointDebug {
  checkpointId: string;
  workflowId: string;
  nodeId: string;
  nodeType?: string;
  createdAt: string;
  state: JsonRecord;
}

interface BranchLedgerDebug {
  branchId: string;
  memberKey: string;
  status: string;
  attempt: number;
  startedAt?: string;
  lastEventAt?: string;
  lastError?: string;
  leafSessionRef?: unknown;
  outputRef?: string;
  consumedByMerge: boolean;
}

type WorkflowDebugStatus = 'running' | 'merge-ready' | 'merged' | 'failed' | 'cancelled' | 'timed-out' | 'blocked';
type BlockedReason = 'permission' | 'budget' | 'validator' | 'tool-failure' | 'timeout' | 'unknown';

export function createWorkflowsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => {
    const db = openDb(runtime);
    const store = openStore(runtime);
    try {
      const limit = clampNumber(c.req.query('limit'), 1, 100, 20);
      const checkpoints = readLatestCheckpoints(db, limit);
      return c.json({
        success: true,
        data: {
          items: checkpoints.map((checkpoint) => toSummary(checkpoint, readPermissionBudget(store, checkpoint.workflowId))),
          total: countDistinctWorkflows(db),
          limit,
        },
      });
    } finally {
      store.close();
      db.close();
    }
  });

  route.get('/:workflowId', (c) => {
    const db = openDb(runtime);
    const store = openStore(runtime);
    try {
      const workflowId = c.req.param('workflowId');
      const latest = readLatestCheckpoint(db, workflowId);
      if (!latest) return c.json({ error: 'Workflow not found' }, 404);
      const checkpoints = readWorkflowCheckpoints(db, workflowId);
      const permissionBudget = readPermissionBudget(store, workflowId);
      return c.json({
        success: true,
        data: toDetail(latest, checkpoints, permissionBudget),
      });
    } finally {
      store.close();
      db.close();
    }
  });

  route.get('/:workflowId/checkpoints', (c) => {
    const db = openDb(runtime);
    try {
      const workflowId = c.req.param('workflowId');
      const checkpoints = readWorkflowCheckpoints(db, workflowId);
      if (checkpoints.length === 0) return c.json({ error: 'Workflow not found' }, 404);
      return c.json({
        success: true,
        data: {
          items: checkpoints.map((checkpoint) => ({
            checkpointId: checkpoint.checkpointId,
            workflowId: checkpoint.workflowId,
            nodeId: checkpoint.nodeId,
            nodeType: checkpoint.nodeType,
            createdAt: checkpoint.createdAt,
            state: checkpoint.state,
          })),
        },
      });
    } finally {
      db.close();
    }
  });

  route.get('/:workflowId/checkpoints/:checkpointId', (c) => {
    const db = openDb(runtime);
    try {
      const checkpoint = readCheckpoint(db, c.req.param('workflowId'), c.req.param('checkpointId'));
      if (!checkpoint) return c.json({ error: 'Checkpoint not found' }, 404);
      return c.json({ success: true, data: checkpoint });
    } finally {
      db.close();
    }
  });

  return route;
}

function openDb(runtime: WebRuntime): DatabaseLike {
  return haroDb.initHaroDatabase({ root: runtime.root, dbFile: runtime.dbFile, keepOpen: true }).database as unknown as DatabaseLike;
}

function openStore(runtime: WebRuntime): PermissionBudgetStore {
  return new PermissionBudgetStore({ root: runtime.root, dbFile: runtime.dbFile });
}

function readLatestCheckpoints(db: DatabaseLike, limit: number): WorkflowCheckpointDebug[] {
  const rows = db
    .prepare(
      `SELECT id, workflow_id, node_id, state, created_at
         FROM workflow_checkpoints
     ORDER BY created_at DESC, rowid DESC
        LIMIT ?`,
    )
    .all(Math.max(limit * 5, limit)) as CheckpointRow[];
  const seen = new Set<string>();
  const checkpoints: WorkflowCheckpointDebug[] = [];
  for (const row of rows) {
    if (seen.has(row.workflow_id)) continue;
    seen.add(row.workflow_id);
    checkpoints.push(toCheckpoint(row));
    if (checkpoints.length >= limit) break;
  }
  return checkpoints;
}

function countDistinctWorkflows(db: DatabaseLike): number {
  const row = db.prepare('SELECT COUNT(DISTINCT workflow_id) AS count FROM workflow_checkpoints').get() as { count: number };
  return row.count;
}

function readLatestCheckpoint(db: DatabaseLike, workflowId: string): WorkflowCheckpointDebug | null {
  const row = db
    .prepare(
      `SELECT id, workflow_id, node_id, state, created_at
         FROM workflow_checkpoints
        WHERE workflow_id = ?
     ORDER BY created_at DESC, rowid DESC
        LIMIT 1`,
    )
    .get(workflowId) as CheckpointRow | undefined;
  return row ? toCheckpoint(row) : null;
}

function readWorkflowCheckpoints(db: DatabaseLike, workflowId: string): WorkflowCheckpointDebug[] {
  const rows = db
    .prepare(
      `SELECT id, workflow_id, node_id, state, created_at
         FROM workflow_checkpoints
        WHERE workflow_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    )
    .all(workflowId) as CheckpointRow[];
  return rows.map(toCheckpoint);
}

function readCheckpoint(db: DatabaseLike, workflowId: string, checkpointId: string): WorkflowCheckpointDebug | null {
  const row = db
    .prepare(
      `SELECT id, workflow_id, node_id, state, created_at
         FROM workflow_checkpoints
        WHERE workflow_id = ? AND id = ?
        LIMIT 1`,
    )
    .get(workflowId, checkpointId) as CheckpointRow | undefined;
  return row ? toCheckpoint(row) : null;
}

function readPermissionBudget(store: PermissionBudgetStore, workflowId: string): WorkflowPermissionBudgetSummary | undefined {
  const summary = store.readWorkflowPermissionBudgetSummary(workflowId);
  if (!summary.budget && summary.ledger.entries.length === 0 && summary.audit.events.length === 0) return undefined;
  return summary;
}

function toCheckpoint(row: CheckpointRow): WorkflowCheckpointDebug {
  const state = parseState(row.state);
  return {
    checkpointId: row.id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    nodeType: stringValue(state.nodeType),
    createdAt: row.created_at,
    state,
  };
}

function toSummary(checkpoint: WorkflowCheckpointDebug, permissionBudget?: WorkflowPermissionBudgetSummary) {
  const state = checkpoint.state;
  const branchState = recordValue(state.branchState);
  const workflow = recordValue(branchState.workflow);
  const decision = recordValue(state.routingDecision);
  const branchLedger = readBranchLedger(state);
  return {
    workflowId: checkpoint.workflowId,
    executionMode: stringValue(workflow.executionMode) ?? stringValue(decision.executionMode) ?? 'team',
    orchestrationMode: stringValue(workflow.orchestrationMode) ?? stringValue(decision.orchestrationMode),
    templateId: stringValue(workflow.workflowTemplateId) ?? stringValue(decision.workflowTemplateId) ?? 'unknown',
    workflowTemplateId: stringValue(workflow.workflowTemplateId) ?? stringValue(decision.workflowTemplateId) ?? 'unknown',
    status: deriveStatus(branchState, branchLedger),
    createdAt: stringValue(workflow.createdAt) ?? checkpoint.createdAt,
    updatedAt: checkpoint.createdAt,
    currentNodeId: checkpoint.nodeId,
    latestCheckpointRef: checkpoint.checkpointId,
    blockedReason: deriveBlockedReason(branchState, branchLedger, permissionBudget),
    budgetState: toBudgetState(permissionBudget),
    permissionState: toPermissionState(permissionBudget),
  };
}

function toDetail(
  latest: WorkflowCheckpointDebug,
  checkpoints: WorkflowCheckpointDebug[],
  permissionBudget?: WorkflowPermissionBudgetSummary,
) {
  const state = latest.state;
  const branchState = recordValue(state.branchState);
  const summary = toSummary(latest, permissionBudget);
  const branchLedger = readBranchLedger(state);
  return {
    ...summary,
    latestCheckpointRef: latest.checkpointId,
    latestCheckpoint: latest,
    branchLedger,
    stalledBranches: branchLedger.filter(isStalledBranch),
    mergeEnvelope: readMergeEnvelope(state),
    leafSessionRefs: arrayValue(state.leafSessionRefs),
    rawContextRefs: arrayValue(state.rawContextRefs),
    branchState,
    checkpointTimeline: checkpoints.map((checkpoint) => ({
      checkpointId: checkpoint.checkpointId,
      workflowId: checkpoint.workflowId,
      nodeId: checkpoint.nodeId,
      nodeType: checkpoint.nodeType,
      createdAt: checkpoint.createdAt,
      state: checkpoint.state,
    })),
    permissionBudget,
  };
}

function readBranchLedger(state: JsonRecord): BranchLedgerDebug[] {
  const branches = recordValue(recordValue(state.branchState).branches);
  return Object.entries(branches).map(([fallbackId, value]) => {
    const branch = recordValue(value);
    return {
      branchId: stringValue(branch.branchId) ?? fallbackId,
      memberKey: stringValue(branch.memberKey) ?? fallbackId,
      status: stringValue(branch.status) ?? 'unknown',
      attempt: numberValue(branch.attempt) ?? 0,
      startedAt: stringValue(branch.startedAt),
      lastEventAt: stringValue(branch.lastEventAt),
      lastError: stringValue(branch.lastError),
      leafSessionRef: branch.leafSessionRef,
      outputRef: stringValue(branch.outputRef),
      consumedByMerge: booleanValue(branch.consumedByMerge) ?? stringValue(branch.status) === 'merge-consumed',
    };
  });
}

function readMergeEnvelope(state: JsonRecord): unknown {
  const merge = recordValue(recordValue(state.branchState).merge);
  return merge.envelope ?? merge;
}

function deriveStatus(branchState: JsonRecord, branches: BranchLedgerDebug[]): WorkflowDebugStatus {
  const teamStatus = stringValue(branchState.teamStatus);
  const merge = recordValue(branchState.merge);
  const mergeStatus = stringValue(merge.status);
  if (mergeStatus === 'completed' || teamStatus === 'merged') return 'merged';
  if (mergeStatus === 'ready') return 'merge-ready';
  if (mergeStatus === 'blocked' || teamStatus === 'blocked') return 'blocked';
  if (branches.some((branch) => branch.status === 'timed-out')) return 'timed-out';
  if (branches.some((branch) => branch.status === 'failed')) return 'failed';
  if (branches.some((branch) => branch.status === 'cancelled')) return 'cancelled';
  if (teamStatus === 'failed' || teamStatus === 'cancelled' || teamStatus === 'timed-out') return teamStatus;
  return 'running';
}

function deriveBlockedReason(
  branchState: JsonRecord,
  branches: BranchLedgerDebug[],
  permissionBudget?: WorkflowPermissionBudgetSummary,
): BlockedReason | undefined {
  if (permissionBudget?.budgetExceeded || permissionBudget?.budget?.state === 'exceeded') return 'budget';
  if (permissionBudget?.permissions.denied || permissionBudget?.permissions.needsApproval) return 'permission';
  const merge = recordValue(branchState.merge);
  const errors = [stringValue(merge.blockedReason), stringValue(permissionBudget?.blockedReason), ...branches.map((branch) => branch.lastError)]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  if (!errors && merge.status !== 'blocked' && !branches.some(isStalledBranch)) return undefined;
  if (errors.includes('budget') || errors.includes('token')) return 'budget';
  if (errors.includes('permission') || errors.includes('approval') || errors.includes('denied')) return 'permission';
  if (errors.includes('validator') || errors.includes('validation')) return 'validator';
  if (errors.includes('tool')) return 'tool-failure';
  if (errors.includes('timeout') || branches.some((branch) => branch.status === 'timed-out')) return 'timeout';
  return 'unknown';
}

function isStalledBranch(branch: BranchLedgerDebug): boolean {
  return !branch.consumedByMerge && ['failed', 'timed-out', 'blocked'].includes(branch.status);
}

function toBudgetState(summary?: WorkflowPermissionBudgetSummary) {
  if (!summary?.budget) return undefined;
  return {
    budgetId: summary.budget.budgetId,
    usedTokens: summary.budget.usedTotalTokens,
    limitTokens: summary.budget.limitTokens,
    state: summary.budget.state,
  };
}

function toPermissionState(summary?: WorkflowPermissionBudgetSummary) {
  if (!summary) return undefined;
  const requiredClass = summary.permissions.events.find((event) => event.operationClass)?.operationClass;
  const state = summary.permissions.denied > 0 ? 'denied' : summary.permissions.needsApproval > 0 ? 'needs-approval' : 'allowed';
  return { requiredClass, state };
}

function parseState(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return recordValue(parsed);
  } catch {
    return { parseError: value };
  }
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
