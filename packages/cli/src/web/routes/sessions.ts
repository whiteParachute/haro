import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { db as haroDb } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const SESSION_DELETE_ALLOW_ENV = 'HARO_WEB_ALLOW_SESSION_DELETE';

function isSessionDeleteAllowed(): boolean {
  return process.env[SESSION_DELETE_ALLOW_ENV] === 'true';
}

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
      const limit = clampNumber(c.req.query('limit'), 1, 100, 20);
      const offset = clampNumber(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
      const filters: string[] = [];
      const params: unknown[] = [];
      const status = c.req.query('status');
      if (status) {
        filters.push('status = ?');
        params.push(status);
      }
      const agentId = c.req.query('agentId');
      if (agentId) {
        filters.push('agent_id = ?');
        params.push(agentId);
      }
      const createdFrom = c.req.query('createdFrom');
      if (createdFrom) {
        filters.push('started_at >= ?');
        params.push(createdFrom);
      }
      const createdTo = c.req.query('createdTo');
      if (createdTo) {
        filters.push('started_at <= ?');
        params.push(createdTo);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT id, agent_id, provider, model, started_at, ended_at, status, context_ref
             FROM sessions
             ${where}
         ORDER BY started_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as SessionRow[];
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS count FROM sessions ${where}`)
        .get(...params) as { count: number };
      return c.json({
        success: true,
        data: {
          items: rows.map(toSessionSummary),
          total: totalRow.count,
          limit,
          offset,
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
    const allowed = isSessionDeleteAllowed();

    if (!allowed) {
      writeAudit(runtime, {
        sessionId,
        outcome: 'denied',
        reason: `${SESSION_DELETE_ALLOW_ENV} is not set to 'true'; FEAT-028 role/audit gating not yet implemented`,
      });
      return c.json(
        {
          error: 'Session deletion is disabled',
          reason: `Set ${SESSION_DELETE_ALLOW_ENV}=true to enable. Pending FEAT-028 role-based authorization, this endpoint hard-deletes session_events and is not safe for shared deployments.`,
        },
        403,
      );
    }

    const db = openDb(runtime);
    try {
      db.exec('BEGIN');
      try {
        db.prepare(`DELETE FROM session_events WHERE session_id = ?`).run(sessionId);
        const result = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        db.exec('COMMIT');
        if (result.changes === 0) {
          writeAudit(runtime, { sessionId, outcome: 'denied', reason: 'session not found' });
          return c.json({ error: 'Session not found' }, 404);
        }
        writeAudit(runtime, { sessionId, outcome: 'success' });
        return c.json({ success: true, data: { deleted: true, sessionId } });
      } catch (error) {
        db.exec('ROLLBACK');
        writeAudit(runtime, {
          sessionId,
          outcome: 'failure',
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
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

function writeAudit(
  runtime: WebRuntime,
  input: { sessionId: string; outcome: 'success' | 'denied' | 'failure'; reason?: string },
): void {
  let db: DatabaseLike | undefined;
  try {
    db = openDb(runtime);
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

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
