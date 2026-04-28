import { Hono } from 'hono';
import { db as haroDb } from '@haro/core';
import { buildPageInfo, parsePageQuery } from '../lib/pagination.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const SESSION_EVENT_SORTS = {
  createdAt: 'se.created_at',
  sessionId: 'se.session_id',
  agentId: 's.agent_id',
  eventType: 'se.event_type',
  provider: 's.provider',
  model: 's.model',
  latencyMs: 'se.latency_ms',
} as const;
const PROVIDER_FALLBACK_SORTS = {
  createdAt: 'created_at',
  sessionId: 'session_id',
  originalProvider: 'original_provider',
  originalModel: 'original_model',
  fallbackProvider: 'fallback_provider',
  fallbackModel: 'fallback_model',
  trigger: 'trigger',
} as const;
const SESSION_EVENT_ALLOWED_SORTS = Object.keys(SESSION_EVENT_SORTS) as Array<keyof typeof SESSION_EVENT_SORTS>;
const PROVIDER_FALLBACK_ALLOWED_SORTS = Object.keys(PROVIDER_FALLBACK_SORTS) as Array<keyof typeof PROVIDER_FALLBACK_SORTS>;

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
      const page = parsePageQuery(c, {
        allowedSort: SESSION_EVENT_ALLOWED_SORTS,
        defaultSort: 'createdAt',
        defaultOrder: 'desc',
      });
      const filters = buildEventFilters({
        sessionId: c.req.query('sessionId'),
        agentId: c.req.query('agentId'),
        eventType: c.req.query('eventType'),
        from: c.req.query('from'),
        to: c.req.query('to'),
        q: page.q,
      });
      const orderBy = SESSION_EVENT_SORTS[page.sort];
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
       ORDER BY ${orderBy} ${toSqlOrder(page.order)}, se.id ${toSqlOrder(page.order)}
          LIMIT ? OFFSET ?`,
      ).all(...filters.params, page.pageSize, page.offset) as SessionEventRow[];
      const total = (db.prepare(
        `SELECT COUNT(*) AS count
           FROM session_events se
           JOIN sessions s ON s.id = se.session_id
          ${filters.where}`,
      ).get(...filters.params) as { count: number }).count;

      return c.json({
        success: true,
        data: {
          items: rows.map(toSessionEvent),
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

  route.get('/provider-fallbacks', (c) => {
    const db = openDb(runtime);
    try {
      const page = parsePageQuery(c, {
        allowedSort: PROVIDER_FALLBACK_ALLOWED_SORTS,
        defaultSort: 'createdAt',
        defaultOrder: 'desc',
      });
      const filters = buildFallbackFilters({
        sessionId: c.req.query('sessionId'),
        from: c.req.query('from'),
        to: c.req.query('to'),
        q: page.q,
      });
      const orderBy = PROVIDER_FALLBACK_SORTS[page.sort];
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
       ORDER BY ${orderBy} ${toSqlOrder(page.order)}, id ${toSqlOrder(page.order)}
          LIMIT ? OFFSET ?`,
      ).all(...filters.params, page.pageSize, page.offset) as FallbackRow[];
      const total = (db.prepare(
        `SELECT COUNT(*) AS count
           FROM provider_fallback_log
          ${filters.where}`,
      ).get(...filters.params) as { count: number }).count;

      return c.json({
        success: true,
        data: {
          items: rows.map(toFallback),
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
  q?: string;
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
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push('(se.session_id LIKE ? OR s.agent_id LIKE ? OR s.provider LIKE ? OR s.model LIKE ? OR se.event_type LIKE ? OR se.event_data LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function buildFallbackFilters(filters: { sessionId?: string; from?: string; to?: string; q?: string }): { where: string; params: string[] } {
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
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push("(session_id LIKE ? OR original_provider LIKE ? OR original_model LIKE ? OR fallback_provider LIKE ? OR fallback_model LIKE ? OR trigger LIKE ? OR COALESCE(rule_id, '') LIKE ?)");
    params.push(like, like, like, like, like, like, like);
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

function toSqlOrder(order: 'asc' | 'desc'): 'ASC' | 'DESC' {
  return order === 'asc' ? 'ASC' : 'DESC';
}
