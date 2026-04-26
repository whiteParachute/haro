import { Hono } from 'hono';
import { PermissionBudgetStore, db as haroDb, type WorkflowCheckpointState, type WorkflowPermissionBudgetSummary } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

interface WorkflowCheckpointRow {
  id: string;
  workflow_id: string;
  node_id: string;
  state: string;
  created_at: string;
}

interface ParsedCheckpoint {
  id: string;
  workflowId: string;
  nodeId: string;
  createdAt: string;
  state: WorkflowCheckpointState | null;
  parseError?: string;
}

type WorkflowStatus =
  | 'running'
  | 'merge-ready'
  | 'merged'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'blocked'
  | 'needs-human-intervention'
  | 'unknown';

type BlockedReason = 'permission' | 'budget' | 'validator' | 'tool-failure' | 'timeout' | 'unknown';

export interface WorkflowDebugSummary {
  workflowId: string;
  status: WorkflowStatus;
  executionMode: string;
  orchestrationMode?: string;
  templateId: string;
  workflowTemplateId: string;
  currentNodeId: string;
  latestCheckpointRef?: string;
  createdAt: string;
  updatedAt: string;
  blockedReason?: BlockedReason;
  budgetState?: {
    budgetId: string;
    usedTokens: number;
    limitTokens: number;
    state: 'ok' | 'near-limit' | 'exceeded';
  };
  permissionState?: {
    requiredClass?: string;
    state: 'allowed' | 'needs-approval' | 'denied';
  };
  stalledBranches: WorkflowBranchReadModel[];
  checkpointError?: {
    checkpointId: string;
    message: string;
  };
}

export interface WorkflowBranchReadModel {
  branchId: string;
  memberKey: string;
  status: string;
  attempt: number;
  nodeId?: string;
  startedAt?: string;
  lastEventAt?: string;
  finishedAt?: string;
  lastError?: string;
  leafSessionRef?: unknown;
  outputRef?: string;
  consumedByMerge: boolean;
  branchRole?: string;
}

export interface WorkflowDebugDetail extends WorkflowDebugSummary {
  branchLedger: WorkflowBranchReadModel[];
  mergeEnvelope?: unknown;
  mergeState?: unknown;
  leafSessionRefs: unknown[];
  rawContextRefs: unknown[];
  recentCheckpointRef?: string;
  checkpoints: Array<{
    checkpointId: string;
    nodeId: string;
    nodeType?: string;
    createdAt: string;
    parseError?: string;
  }>;
  budgetPermissionSummary: WorkflowPermissionBudgetSummary;
}

export function createWorkflowsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => {
    const limit = clampNumber(c.req.query('limit'), 1, 100, 20);
    const rows = readAllCheckpointRows(runtime);
    const store = openPermissionBudgetStore(runtime);
    try {
      const summaries = groupByWorkflow(rows)
        .map((workflowRows) => buildWorkflowSummary(workflowRows, store.readWorkflowPermissionBudgetSummary(workflowRows[0]!.workflow_id)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);

      return c.json({
        success: true,
        data: {
          items: summaries,
          limit,
        },
      });
    } finally {
      store.close();
    }
  });

  route.get('/:id', (c) => {
    const workflowId = c.req.param('id');
    const rows = readWorkflowCheckpointRows(runtime, workflowId);
    if (rows.length === 0) {
      return c.json({ error: 'Workflow not found' }, 404);
    }

    const store = openPermissionBudgetStore(runtime);
    try {
      const budgetPermissionSummary = store.readWorkflowPermissionBudgetSummary(workflowId);
      return c.json({
        success: true,
        data: buildWorkflowDetail(rows, budgetPermissionSummary),
      });
    } finally {
      store.close();
    }
  });

  return route;
}

function readAllCheckpointRows(runtime: WebRuntime): WorkflowCheckpointRow[] {
  const opened = haroDb.initHaroDatabase({
    root: runtime.root,
    dbFile: runtime.dbFile,
    keepOpen: true,
  });
  const db = opened.database!;
  try {
    return db
      .prepare(
        `SELECT id, workflow_id, node_id, state, created_at
           FROM workflow_checkpoints
       ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as WorkflowCheckpointRow[];
  } finally {
    db.close();
  }
}

function readWorkflowCheckpointRows(runtime: WebRuntime, workflowId: string): WorkflowCheckpointRow[] {
  const opened = haroDb.initHaroDatabase({
    root: runtime.root,
    dbFile: runtime.dbFile,
    keepOpen: true,
  });
  const db = opened.database!;
  try {
    return db
      .prepare(
        `SELECT id, workflow_id, node_id, state, created_at
           FROM workflow_checkpoints
          WHERE workflow_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      )
      .all(workflowId) as WorkflowCheckpointRow[];
  } finally {
    db.close();
  }
}

function openPermissionBudgetStore(runtime: WebRuntime): PermissionBudgetStore {
  return new PermissionBudgetStore({
    root: runtime.root,
    dbFile: runtime.dbFile,
  });
}

function groupByWorkflow(rows: WorkflowCheckpointRow[]): WorkflowCheckpointRow[][] {
  const grouped = new Map<string, WorkflowCheckpointRow[]>();
  for (const row of rows) {
    const workflowRows = grouped.get(row.workflow_id) ?? [];
    workflowRows.push(row);
    grouped.set(row.workflow_id, workflowRows);
  }
  return [...grouped.values()];
}

function buildWorkflowSummary(
  rows: WorkflowCheckpointRow[],
  budgetPermissionSummary: WorkflowPermissionBudgetSummary,
): WorkflowDebugSummary {
  const parsed = rows.map(parseCheckpointRow);
  const latest = parsed.at(-1)!;
  const first = parsed[0]!;
  const state = latest.state;
  const branchLedger = extractBranchLedger(state?.branchState);
  const blockedReason = deriveBlockedReason(state, branchLedger, budgetPermissionSummary);
  const workflowTemplateId = state?.routingDecision?.workflowTemplateId ?? 'unknown';
  const summary: WorkflowDebugSummary = {
    workflowId: latest.workflowId,
    status: deriveWorkflowStatus(state, branchLedger, budgetPermissionSummary),
    executionMode: state?.routingDecision?.executionMode ?? 'unknown',
    ...(state?.routingDecision?.orchestrationMode ? { orchestrationMode: state.routingDecision.orchestrationMode } : {}),
    templateId: workflowTemplateId,
    workflowTemplateId,
    currentNodeId: state?.nodeId ?? latest.nodeId,
    latestCheckpointRef: latest.id,
    createdAt: first.createdAt,
    updatedAt: latest.createdAt,
    ...(blockedReason ? { blockedReason } : {}),
    ...deriveBudgetPermissionState(budgetPermissionSummary),
    stalledBranches: branchLedger.filter(isStalledBranch),
    ...(latest.parseError
      ? {
          checkpointError: {
            checkpointId: latest.id,
            message: latest.parseError,
          },
        }
      : {}),
  };
  return summary;
}

function buildWorkflowDetail(
  rows: WorkflowCheckpointRow[],
  budgetPermissionSummary: WorkflowPermissionBudgetSummary,
): WorkflowDebugDetail {
  const summary = buildWorkflowSummary(rows, budgetPermissionSummary);
  const parsed = rows.map(parseCheckpointRow);
  const latest = parsed.at(-1)!;
  const state = latest.state;
  const branchState = asRecord(state?.branchState);
  const mergeState = asRecord(branchState?.merge);
  const mergeEnvelope = mergeState?.envelope;
  return {
    ...summary,
    branchLedger: extractBranchLedger(state?.branchState),
    ...(mergeEnvelope ? { mergeEnvelope } : {}),
    ...(mergeState ? { mergeState } : {}),
    leafSessionRefs: Array.isArray(state?.leafSessionRefs) ? state.leafSessionRefs : [],
    rawContextRefs: Array.isArray(state?.rawContextRefs) ? state.rawContextRefs : [],
    recentCheckpointRef: latest.id,
    checkpoints: parsed.map((checkpoint) => ({
      checkpointId: checkpoint.id,
      nodeId: checkpoint.state?.nodeId ?? checkpoint.nodeId,
      ...(checkpoint.state?.nodeType ? { nodeType: checkpoint.state.nodeType } : {}),
      createdAt: checkpoint.createdAt,
      ...(checkpoint.parseError ? { parseError: checkpoint.parseError } : {}),
    })),
    budgetPermissionSummary,
  };
}

function parseCheckpointRow(row: WorkflowCheckpointRow): ParsedCheckpoint {
  try {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      createdAt: row.created_at,
      state: JSON.parse(row.state) as WorkflowCheckpointState,
    };
  } catch (error) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      createdAt: row.created_at,
      state: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractBranchLedger(branchState: unknown): WorkflowBranchReadModel[] {
  const branches = asRecord(asRecord(branchState)?.branches);
  if (!branches) return [];
  return Object.entries(branches).map(([branchId, value]) => {
    const branch = asRecord(value) ?? {};
    const lastEventAt = stringValue(branch.finishedAt) ?? stringValue(branch.startedAt);
    return {
      branchId: stringValue(branch.branchId) ?? branchId,
      memberKey: stringValue(branch.memberKey) ?? 'unknown',
      status: stringValue(branch.status) ?? 'unknown',
      attempt: numberValue(branch.attempt) ?? 0,
      ...(stringValue(branch.nodeId) ? { nodeId: stringValue(branch.nodeId) } : {}),
      ...(stringValue(branch.startedAt) ? { startedAt: stringValue(branch.startedAt) } : {}),
      ...(lastEventAt ? { lastEventAt } : {}),
      ...(stringValue(branch.finishedAt) ? { finishedAt: stringValue(branch.finishedAt) } : {}),
      ...(stringValue(branch.lastError) ? { lastError: stringValue(branch.lastError) } : {}),
      ...(branch.leafSessionRef ? { leafSessionRef: branch.leafSessionRef } : {}),
      ...(stringValue(branch.outputRef) ? { outputRef: stringValue(branch.outputRef) } : {}),
      consumedByMerge: Boolean(branch.consumedByMerge),
      ...(stringValue(branch.branchRole) ? { branchRole: stringValue(branch.branchRole) } : {}),
    };
  });
}

function deriveWorkflowStatus(
  state: WorkflowCheckpointState | null,
  branches: WorkflowBranchReadModel[],
  summary: WorkflowPermissionBudgetSummary,
): WorkflowStatus {
  if (!state) return 'unknown';
  const branchState = asRecord(state.branchState);
  const teamStatus = stringValue(branchState?.teamStatus);
  if (isWorkflowStatus(teamStatus)) return teamStatus;
  if (summary.budget?.state === 'near-limit' || summary.permissions.needsApproval > 0) return 'needs-human-intervention';
  if (summary.budget?.state === 'exceeded' || summary.permissions.denied > 0) return 'blocked';
  const mergeStatus = stringValue(asRecord(branchState?.merge)?.status);
  if (mergeStatus === 'ready') return 'merge-ready';
  if (mergeStatus === 'completed') return 'merged';
  if (mergeStatus === 'blocked') return 'blocked';
  if (branches.some((branch) => branch.status === 'timed-out')) return 'timed-out';
  if (branches.some((branch) => branch.status === 'failed')) return 'failed';
  return 'running';
}

function deriveBlockedReason(
  state: WorkflowCheckpointState | null,
  branches: WorkflowBranchReadModel[],
  summary: WorkflowPermissionBudgetSummary,
): BlockedReason | undefined {
  if (summary.budgetExceeded || summary.budget?.state === 'exceeded' || summary.budget?.state === 'near-limit') return 'budget';
  if (summary.permissions.denied > 0 || summary.permissions.needsApproval > 0) return 'permission';
  const branchState = asRecord(state?.branchState);
  const explicit = stringValue(branchState?.blockedReason);
  if (isBlockedReason(explicit)) return explicit;
  if (branches.some((branch) => branch.status === 'timed-out' || branch.lastError?.toLowerCase().includes('timeout'))) {
    return 'timeout';
  }
  if (branches.some((branch) => branch.lastError)) return 'tool-failure';
  if (stringValue(asRecord(branchState?.merge)?.status) === 'blocked') return 'validator';
  return undefined;
}

function deriveBudgetPermissionState(summary: WorkflowPermissionBudgetSummary): Pick<WorkflowDebugSummary, 'budgetState' | 'permissionState'> {
  const latestPermissionEvent = summary.permissions.events.at(-1);
  return {
    ...(summary.budget
      ? {
          budgetState: {
            budgetId: summary.budget.budgetId,
            usedTokens: summary.budget.usedTotalTokens,
            limitTokens: summary.budget.limitTokens,
            state: summary.budget.state,
          },
        }
      : {}),
    permissionState: {
      ...(latestPermissionEvent?.operationClass ? { requiredClass: latestPermissionEvent.operationClass } : {}),
      state: summary.permissions.denied > 0 ? 'denied' : summary.permissions.needsApproval > 0 ? 'needs-approval' : 'allowed',
    },
  };
}

function isStalledBranch(branch: WorkflowBranchReadModel): boolean {
  return (
    branch.status === 'failed' ||
    branch.status === 'timed-out' ||
    branch.status === 'cancelled' ||
    branch.status === 'blocked' ||
    Boolean(branch.lastError)
  );
}

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isWorkflowStatus(value: string | undefined): value is WorkflowStatus {
  return (
    value === 'running' ||
    value === 'merge-ready' ||
    value === 'merged' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'timed-out' ||
    value === 'blocked' ||
    value === 'needs-human-intervention'
  );
}

function isBlockedReason(value: string | undefined): value is BlockedReason {
  return (
    value === 'permission' ||
    value === 'budget' ||
    value === 'validator' ||
    value === 'tool-failure' ||
    value === 'timeout' ||
    value === 'unknown'
  );
}
