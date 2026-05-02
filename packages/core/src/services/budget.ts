/**
 * Budget service (FEAT-039 R7) — thin wrapper around `PermissionBudgetStore`
 * exposing the read paths CLI/web both need.
 *
 * Note: per-agent default-budget *writes* (R7 `set --agent ...`) are not
 * implemented yet — there's no per-agent budget table today. Track in a
 * follow-up; the existing `ensureWorkflowBudget` is per-workflow only.
 */

import { initHaroDatabase } from '../db/index.js';
import {
  PermissionBudgetStore,
  type WorkflowPermissionBudgetSummary,
} from '../permission-budget.js';
import type { ServiceContext } from './types.js';

export interface BudgetAuditEvent {
  id: string;
  workflowId: string | null;
  branchId: string | null;
  agentId: string | null;
  eventType: string;
  operationClass: string;
  policy: string | null;
  outcome: string;
  targetScope: string | null;
  targetRef: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ListBudgetsOptions {
  limit?: number;
}

export interface AuditQueryOptions {
  /** ISO timestamp lower bound. */
  since?: string;
  /** Filter by outcome (denied / needs-approval / allowed / failure / success). */
  outcome?: string;
  /** Filter by event_type prefix (`budget.*`, `permission.*`, ...). */
  eventTypePrefix?: string;
  limit?: number;
}

interface AuditRow {
  id: string;
  workflow_id: string | null;
  branch_id: string | null;
  agent_id: string | null;
  event_type: string;
  operation_class: string;
  policy: string | null;
  outcome: string;
  target_scope: string | null;
  target_ref: string | null;
  reason: string | null;
  created_at: string;
}

export function listWorkflowBudgets(
  ctx: ServiceContext,
  options: ListBudgetsOptions = {},
): WorkflowPermissionBudgetSummary[] {
  const store = openStore(ctx);
  try {
    return store.listWorkflowPermissionBudgetSummaries(options.limit ?? 20);
  } finally {
    store.close();
  }
}

export function getWorkflowBudget(
  ctx: ServiceContext,
  workflowId: string,
): WorkflowPermissionBudgetSummary {
  const store = openStore(ctx);
  try {
    return store.readWorkflowPermissionBudgetSummary(workflowId);
  } finally {
    store.close();
  }
}

export function listAuditEvents(
  ctx: ServiceContext,
  options: AuditQueryOptions = {},
): BudgetAuditEvent[] {
  const limit = clampInt(options.limit, 1, 1000, 100);
  const opened = initHaroDatabase({ root: ctx.root, dbFile: ctx.dbFile, keepOpen: true });
  const db = opened.database!;
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.since) {
      clauses.push('created_at >= ?');
      params.push(options.since);
    }
    if (options.outcome) {
      clauses.push('outcome = ?');
      params.push(options.outcome);
    }
    if (options.eventTypePrefix) {
      clauses.push('event_type LIKE ?');
      params.push(`${options.eventTypePrefix}%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT id,
                workflow_id,
                branch_id,
                agent_id,
                event_type,
                operation_class,
                policy,
                outcome,
                target_scope,
                target_ref,
                reason,
                created_at
           FROM operation_audit_log
          ${where}
       ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(...params, limit) as AuditRow[];
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      branchId: row.branch_id,
      agentId: row.agent_id,
      eventType: row.event_type,
      operationClass: row.operation_class,
      policy: row.policy,
      outcome: row.outcome,
      targetScope: row.target_scope,
      targetRef: row.target_ref,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  } finally {
    db.close();
  }
}

function openStore(ctx: ServiceContext): PermissionBudgetStore {
  return new PermissionBudgetStore({
    ...(ctx.root ? { root: ctx.root } : {}),
    ...(ctx.dbFile ? { dbFile: ctx.dbFile } : {}),
  });
}

function clampInt(raw: number | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
