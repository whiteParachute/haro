import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { db as haroDb } from '@haro/core';
import { buildPageInfo, parsePageQuery } from '../lib/pagination.js';
import { canPerform, readWebAuth } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const SESSION_SORTS = {
  createdAt: 'started_at',
  endedAt: 'ended_at',
  status: 'status',
  agentId: 'agent_id',
  provider: 'provider',
  model: 'model',
} as const;
const SESSION_ALLOWED_SORTS = Object.keys(SESSION_SORTS) as Array<keyof typeof SESSION_SORTS>;

type DatabaseLike = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
  exec(sql: string): void;
};

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

export function createSessionsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => {
    const db = openDb(runtime);
    try {
      const page = parsePageQuery(c, {
        allowedSort: SESSION_ALLOWED_SORTS,
        defaultSort: 'createdAt',
        defaultOrder: 'desc',
      });
      const filters = buildSessionFilters({
        status: c.req.query('status'),
        agentId: c.req.query('agentId'),
        createdFrom: c.req.query('createdFrom'),
        createdTo: c.req.query('createdTo'),
        q: page.q,
      });
      const orderBy = SESSION_SORTS[page.sort];
      const rows = db
        .prepare(
          `SELECT id, agent_id, provider, model, started_at, ended_at, status, context_ref
             FROM sessions
             ${filters.where}
         ORDER BY ${orderBy} ${toSqlOrder(page.order)}, id ${toSqlOrder(page.order)}
            LIMIT ? OFFSET ?`,
        )
        .all(...filters.params, page.pageSize, page.offset) as SessionRow[];
      const total = (db
        .prepare(`SELECT COUNT(*) AS count FROM sessions ${filters.where}`)
        .get(...filters.params) as { count: number }).count;
      return c.json({
        success: true,
        data: {
          items: rows.map(toSessionSummary),
          pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
          total,
          limit: page.pageSize,
          offset: page.offset,
        },
      });
    } finally {
      db.close();
    }
  });

  route.get('/:id', (c) => {
    const db = openDb(runtime);
    try {
      const row = db
        .prepare(
          `SELECT id, agent_id, provider, model, started_at, ended_at, status, context_ref
             FROM sessions
            WHERE id = ?`,
        )
        .get(c.req.param('id')) as SessionRow | undefined;
      if (!row) return c.json({ error: 'Session not found' }, 404);
      return c.json({ success: true, data: toSessionDetail(row) });
    } finally {
      db.close();
    }
  });

  route.get('/:id/events', (c) => {
    const db = openDb(runtime);
    try {
      const exists = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(c.req.param('id'));
      if (!exists) return c.json({ error: 'Session not found' }, 404);
      const limit = clampNumber(c.req.query('limit'), 1, 500, 100);
      const offset = clampNumber(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
      const rows = db
        .prepare(
          `SELECT id, session_id, event_type, event_data, created_at
             FROM session_events
            WHERE session_id = ?
         ORDER BY id ASC
            LIMIT ? OFFSET ?`,
        )
        .all(c.req.param('id'), limit, offset) as EventRow[];
      return c.json({
        success: true,
        data: {
          items: rows.map(toEvent),
          limit,
          offset,
        },
      });
    } finally {
      db.close();
    }
  });

  route.delete('/:id', (c) => {
    const sessionId = c.req.param('id');
    const auth = readWebAuth(c);
    if (!auth || !canPerform(auth.role, 'local-write')) {
      // RBAC denial — caller never reached the DB, audit on a separate
      // connection is acceptable (no tx to roll back). Failures here are
      // logged but do not block the 403 response.
      writeAuditSeparateConnection(runtime, {
        sessionId,
        outcome: 'denied',
        reason: `requires operator role or higher; current role is ${auth?.role ?? 'anonymous'}`,
      });
      return c.json({ error: 'Forbidden', operationClass: 'local-write', minimumRole: 'operator' }, 403);
    }

    // FEAT-028 critical fix — keep delete + success/failure audit in the same
    // transaction so a successful response is never returned without an
    // audit row, and a failed audit insert rolls the delete back.
    const db = openDb(runtime);
    try {
      db.exec('BEGIN');
      try {
        db.prepare(`DELETE FROM session_events WHERE session_id = ?`).run(sessionId);
        const result = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        if (result.changes === 0) {
          // Session not found — record denied audit in the same tx and commit.
          insertSessionDeleteAudit(db, { sessionId, outcome: 'denied', reason: 'session not found' });
          db.exec('COMMIT');
          return c.json({ error: 'Session not found' }, 404);
        }
        insertSessionDeleteAudit(db, { sessionId, outcome: 'success' });
        db.exec('COMMIT');
        return c.json({ success: true, data: { deleted: true, sessionId } });
      } catch (error) {
        db.exec('ROLLBACK');
        // Audit the failure on a fresh connection (the original tx is gone).
        // If this also fails, log only — but the delete itself was already
        // rolled back so observable state is consistent.
        writeAuditSeparateConnection(runtime, {
          sessionId,
          outcome: 'failure',
          reason: error instanceof Error ? error.message : String(error),
        });
        return c.json({ error: 'Session delete failed', code: 'SESSION_DELETE_FAILED' }, 500);
      }
    } finally {
      db.close();
    }
  });

  return route;
}

function openDb(runtime: WebRuntime): DatabaseLike {
  return haroDb.initHaroDatabase({ root: runtime.root, dbFile: runtime.dbFile, keepOpen: true }).database as unknown as DatabaseLike;
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

/**
 * FEAT-028 critical fix — insert audit row on the *same* DB connection so it
 * participates in the caller's transaction. If this throws the caller's
 * outer catch will roll back the delete, guaranteeing audit-or-no-state.
 */
function insertSessionDeleteAudit(
  db: DatabaseLike,
  input: { sessionId: string; outcome: 'success' | 'denied' | 'failure'; reason?: string },
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
    'web.session.delete',
    'delete',
    input.outcome,
    'haro-state',
    input.sessionId,
    input.reason ?? null,
    new Date().toISOString(),
  );
}

/**
 * Last-resort audit on a fresh connection — used only when the original tx
 * is gone (RBAC denial before any writes; rollback already happened).
 */
function writeAuditSeparateConnection(
  runtime: WebRuntime,
  input: { sessionId: string; outcome: 'success' | 'denied' | 'failure'; reason?: string },
): void {
  let db: DatabaseLike | undefined;
  try {
    db = openDb(runtime);
    insertSessionDeleteAudit(db, input);
  } catch (error) {
    runtime.logger.warn?.(
      { sessionId: input.sessionId, outcome: input.outcome, error: error instanceof Error ? error.message : String(error) },
      'failed to record session delete audit event',
    );
  } finally {
    db?.close();
  }
}

function toSessionSummary(row: SessionRow) {
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

function toSessionDetail(row: SessionRow) {
  return {
    ...toSessionSummary(row),
    contextRef: parseJson(row.context_ref),
  };
}

function toEvent(row: EventRow) {
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

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
