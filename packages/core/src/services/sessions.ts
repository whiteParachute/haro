import { randomUUID } from 'node:crypto';
import { initHaroDatabase } from '../db/index.js';
import { HaroError } from '../errors/index.js';
import {
  buildPageInfo,
  normalizePageQuery,
  type PageQuery,
  type PaginatedResult,
  type ServiceContext,
} from './types.js';

const SESSION_SORTS = {
  createdAt: 'started_at',
  endedAt: 'ended_at',
  status: 'status',
  agentId: 'agent_id',
  provider: 'provider',
  model: 'model',
} as const;
const SESSION_ALLOWED_SORTS = Object.keys(SESSION_SORTS) as Array<keyof typeof SESSION_SORTS>;

export interface SessionSummary {
  sessionId: string;
  agentId: string;
  status: string;
  createdAt: string;
  provider: string;
  model: string;
  endedAt: string | null;
}

export interface SessionDetail extends SessionSummary {
  contextRef: unknown;
}

export interface SessionEvent {
  id: number;
  sessionId: string;
  eventType: string;
  event: unknown;
  createdAt: string;
}

export interface ListSessionsQuery extends PageQuery {
  status?: string;
  agentId?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface ListSessionEventsOptions {
  limit?: number;
  offset?: number;
}

export interface DeleteSessionOptions {
  /**
   * Audit row event_type written into operation_audit_log inside the delete
   * transaction. Defaults to `session.delete`; web-api overrides with
   * `web.session.delete` to preserve its existing audit identity.
   */
  auditEventType?: string;
  /** Caller-side observer for the audit outcome (used for CLI-side echoing). */
  audit?: (event: { outcome: 'success' | 'denied' | 'failure'; reason?: string }) => void;
}

interface SessionRow {
  id: string;
  agent_id: string;
  provider: string;
  model: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  context_ref: string | null;
}

interface EventRow {
  id: number;
  session_id: string;
  event_type: string;
  event_data: string;
  created_at: string;
}

interface DatabaseLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
  exec(sql: string): void;
}

export function listSessions(ctx: ServiceContext, query: ListSessionsQuery = {}): PaginatedResult<SessionSummary> {
  const page = normalizePageQuery(query, {
    allowedSort: SESSION_ALLOWED_SORTS,
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
  });
  const filters = buildSessionFilters({
    status: query.status,
    agentId: query.agentId,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    q: page.q,
  });
  const orderBy = SESSION_SORTS[page.sort as keyof typeof SESSION_SORTS];
  const db = openDb(ctx);
  try {
    const rows = db
      .prepare(
        `SELECT id, agent_id, provider, model, started_at, ended_at, status, context_ref
           FROM sessions
           ${filters.where}
       ORDER BY ${orderBy} ${toSqlOrder(page.order)}, id ${toSqlOrder(page.order)}
          LIMIT ? OFFSET ?`,
      )
      .all(...filters.params, page.pageSize, page.offset) as SessionRow[];
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM sessions ${filters.where}`).get(...filters.params) as { count: number }
    ).count;
    return {
      items: rows.map(toSessionSummary),
      pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
      total,
      limit: page.pageSize,
      offset: page.offset,
    };
  } finally {
    db.close();
  }
}

export function getSession(ctx: ServiceContext, sessionId: string): SessionDetail {
  const db = openDb(ctx);
  try {
    const row = db
      .prepare(
        `SELECT id, agent_id, provider, model, started_at, ended_at, status, context_ref
           FROM sessions
          WHERE id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new HaroError('SESSION_NOT_FOUND', `Session '${sessionId}' not found`, {
        remediation: 'Run `haro session list` to see available sessions',
      });
    }
    return toSessionDetail(row);
  } finally {
    db.close();
  }
}

export function tryGetSession(ctx: ServiceContext, sessionId: string): SessionDetail | null {
  try {
    return getSession(ctx, sessionId);
  } catch (error) {
    if (error instanceof HaroError && error.code === 'SESSION_NOT_FOUND') return null;
    throw error;
  }
}

export function listSessionEvents(
  ctx: ServiceContext,
  sessionId: string,
  options: ListSessionEventsOptions = {},
): { items: SessionEvent[]; limit: number; offset: number } {
  const limit = clampNumber(options.limit, 1, 500, 100);
  const offset = clampNumber(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const db = openDb(ctx);
  try {
    const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId);
    if (!exists) {
      throw new HaroError('SESSION_NOT_FOUND', `Session '${sessionId}' not found`, {
        remediation: 'Run `haro session list` to see available sessions',
      });
    }
    const rows = db
      .prepare(
        `SELECT id, session_id, event_type, event_data, created_at
           FROM session_events
          WHERE session_id = ?
       ORDER BY id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit, offset) as EventRow[];
    return { items: rows.map(toEvent), limit, offset };
  } finally {
    db.close();
  }
}

export interface DeleteSessionResult {
  outcome: 'success' | 'not-found' | 'failure';
  sessionId: string;
}

/**
 * Delete a session + its events in one transaction. Caller-provided `audit`
 * runs inside the same transaction so a successful return is never observed
 * without an audit row.
 *
 * The web-api wraps this with RBAC denial handling on a separate connection;
 * CLI wraps it with a confirm-prompt and a CLI-side audit record.
 */
export function deleteSession(
  ctx: ServiceContext,
  sessionId: string,
  options: DeleteSessionOptions = {},
): DeleteSessionResult {
  const eventType = options.auditEventType ?? 'session.delete';
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM session_events WHERE session_id = ?`).run(sessionId);
      const result = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
      if (result.changes === 0) {
        insertSessionDeleteAudit(db, { eventType, sessionId, outcome: 'denied', reason: 'session not found' });
        options.audit?.({ outcome: 'denied', reason: 'session not found' });
        db.exec('COMMIT');
        return { outcome: 'not-found', sessionId };
      }
      insertSessionDeleteAudit(db, { eventType, sessionId, outcome: 'success' });
      options.audit?.({ outcome: 'success' });
      db.exec('COMMIT');
      return { outcome: 'success', sessionId };
    } catch (error) {
      db.exec('ROLLBACK');
      const reason = error instanceof Error ? error.message : String(error);
      throw new HaroError('SESSION_DELETE_FAILED', `Session delete failed: ${reason}`, {
        remediation: 'Check Haro DB integrity with `haro doctor --component database`',
        cause: error,
      });
    }
  } finally {
    db.close();
  }
}

function openDb(ctx: ServiceContext): DatabaseLike {
  return initHaroDatabase({ root: ctx.root, dbFile: ctx.dbFile, keepOpen: true })
    .database as unknown as DatabaseLike;
}

function buildSessionFilters(filters: {
  status?: string;
  agentId?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
}): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.agentId) {
    clauses.push('agent_id = ?');
    params.push(filters.agentId);
  }
  if (filters.createdFrom) {
    clauses.push('started_at >= ?');
    params.push(filters.createdFrom);
  }
  if (filters.createdTo) {
    clauses.push('started_at <= ?');
    params.push(filters.createdTo);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push('(id LIKE ? OR agent_id LIKE ? OR provider LIKE ? OR model LIKE ? OR status LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function insertSessionDeleteAudit(
  db: DatabaseLike,
  input: { eventType: string; sessionId: string; outcome: 'success' | 'denied' | 'failure'; reason?: string },
): void {
  db.prepare(
    `INSERT INTO operation_audit_log (
      id,
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
      approval_ref,
      metadata_json,
      created_at
    ) VALUES (?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    randomUUID(),
    input.eventType,
    'delete',
    input.outcome,
    'haro-state',
    input.sessionId,
    input.reason ?? null,
    new Date().toISOString(),
  );
}

/**
 * Last-resort audit on a fresh connection — used by web-api when the original
 * tx is gone (RBAC denial before any writes).
 */
export function writeSessionAuditOnFreshConnection(
  ctx: ServiceContext,
  input: { eventType?: string; sessionId: string; outcome: 'success' | 'denied' | 'failure'; reason?: string },
): void {
  let db: DatabaseLike | undefined;
  try {
    db = openDb(ctx);
    insertSessionDeleteAudit(db, { ...input, eventType: input.eventType ?? 'session.delete' });
  } catch (error) {
    ctx.logger?.warn?.(
      {
        sessionId: input.sessionId,
        outcome: input.outcome,
        error: error instanceof Error ? error.message : String(error),
      },
      'failed to record session delete audit event',
    );
  } finally {
    db?.close();
  }
}

function toSessionSummary(row: SessionRow): SessionSummary {
  return {
    sessionId: row.id,
    agentId: row.agent_id,
    status: row.status,
    createdAt: row.started_at,
    provider: row.provider,
    model: row.model,
    endedAt: row.ended_at,
  };
}

function toSessionDetail(row: SessionRow): SessionDetail {
  return { ...toSessionSummary(row), contextRef: parseJson(row.context_ref) };
}

function toEvent(row: EventRow): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    event: parseJson(row.event_data),
    createdAt: row.created_at,
  };
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toSqlOrder(order: 'asc' | 'desc'): 'ASC' | 'DESC' {
  return order === 'asc' ? 'ASC' : 'DESC';
}

function clampNumber(raw: number | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
