import { Hono } from 'hono';
import { db as haroDb } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

interface DatabaseLike {
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  close(): void;
}

interface SessionEventRow {
  id: number;
  session_id: string;
  agent_id: string;
  provider: string;
  model: string;
  event_type: string;
  event_data: string;
  created_at: string;
  latency_ms: number | null;
}

interface FallbackRow {
  id: number;
  session_id: string;
  original_provider: string;
  original_model: string;
  fallback_provider: string;
  fallback_model: string;
  trigger: string;
  rule_id: string | null;
  created_at: string;
}

export function createLogsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/session-events', (c) => {
    const db = openDb(runtime);
    try {
      const filters = buildEventFilters({
        sessionId: c.req.query('sessionId'),
        agentId: c.req.query('agentId'),
        eventType: c.req.query('eventType'),
        from: c.req.query('from'),
        to: c.req.query('to'),
      });
      const limit = clampNumber(c.req.query('limit'), 1, 1000, 100);
      const rows = db.prepare(
        `SELECT se.id,
                se.session_id,
                s.agent_id,
                s.provider,
                s.model,
                se.event_type,
                se.event_data,
                se.created_at,
                se.latency_ms
           FROM session_events se
           JOIN sessions s ON s.id = se.session_id
          ${filters.where}
       ORDER BY se.created_at DESC, se.id DESC
          LIMIT ?`,
      ).all(...filters.params, limit) as SessionEventRow[];

      return c.json({
        success: true,
        data: {
          items: rows.map(toSessionEvent),
          limit,
        },
      });
    } finally {
      db.close();
    }
  });

  route.get('/provider-fallbacks', (c) => {
    const db = openDb(runtime);
    try {
      const filters = buildFallbackFilters({
        sessionId: c.req.query('sessionId'),
        from: c.req.query('from'),
        to: c.req.query('to'),
      });
      const limit = clampNumber(c.req.query('limit'), 1, 1000, 100);
      const rows = db.prepare(
        `SELECT id,
                session_id,
                original_provider,
                original_model,
                fallback_provider,
                fallback_model,
                trigger,
                rule_id,
                created_at
           FROM provider_fallback_log
          ${filters.where}
       ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      ).all(...filters.params, limit) as FallbackRow[];

      return c.json({
        success: true,
        data: {
          items: rows.map(toFallback),
          limit,
        },
      });
    } finally {
      db.close();
    }
  });

  return route;
}

function openDb(runtime: WebRuntime): DatabaseLike {
  return haroDb.initHaroDatabase({ root: runtime.root, dbFile: runtime.dbFile, keepOpen: true }).database as unknown as DatabaseLike;
}

function buildEventFilters(filters: {
  sessionId?: string;
  agentId?: string;
  eventType?: string;
  from?: string;
  to?: string;
}): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.sessionId) {
    clauses.push('se.session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.agentId) {
    clauses.push('s.agent_id = ?');
    params.push(filters.agentId);
  }
  if (filters.eventType) {
    clauses.push('se.event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.from) {
    clauses.push('se.created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('se.created_at <= ?');
    params.push(filters.to);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function buildFallbackFilters(filters: { sessionId?: string; from?: string; to?: string }): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.sessionId) {
    clauses.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.from) {
    clauses.push('created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('created_at <= ?');
    params.push(filters.to);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function toSessionEvent(row: SessionEventRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    eventType: row.event_type,
    payload: parseJson(row.event_data),
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

function toFallback(row: FallbackRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    originalProvider: row.original_provider,
    originalModel: row.original_model,
    fallbackProvider: row.fallback_provider,
    fallbackModel: row.fallback_model,
    trigger: row.trigger,
    ruleId: row.rule_id,
    createdAt: row.created_at,
  };
}

function parseJson(value: string): unknown {
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
