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
type WindowKey = '24h' | '7d' | 'all';

interface TerminalEventRow {
  session_provider: string;
  session_model: string;
  event_type: 'result' | 'error';
  event_data: string;
  latency_ms: number | null;
}

interface FallbackCountRow {
  provider: string;
  model: string;
  count: number;
}

interface LedgerRow {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number | null;
}

interface ProviderStatsAccumulator {
  provider: string;
  model: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  latencyTotal: number;
  latencyCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export function createProvidersRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/stats', (c) => {
    const db = openDb(runtime);
    try {
      const now = Date.now();
      const windows: Record<WindowKey, ReturnType<typeof toStats>[]> = {
        '24h': readWindowStats(db, new Date(now - 24 * 60 * 60 * 1000).toISOString()),
        '7d': readWindowStats(db, new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
        all: readWindowStats(db, null),
      };
      return c.json({ success: true, data: { windows, generatedAt: new Date(now).toISOString() } });
    } finally {
      db.close();
    }
  });

  return route;
}

function openDb(runtime: WebRuntime): DatabaseLike {
  return haroDb.initHaroDatabase({ root: runtime.root, dbFile: runtime.dbFile, keepOpen: true }).database as unknown as DatabaseLike;
}

function readWindowStats(db: DatabaseLike, since: string | null) {
  const stats = new Map<string, ProviderStatsAccumulator>();
  const sinceClause = since ? 'AND se.created_at >= ?' : '';
  const terminalRows = db.prepare(
    `SELECT s.provider AS session_provider,
            s.model AS session_model,
            se.event_type,
            se.event_data,
            se.latency_ms
       FROM session_events se
       JOIN sessions s ON s.id = se.session_id
      WHERE se.event_type IN ('result', 'error')
        ${sinceClause}`,
  ).all(...(since ? [since] : [])) as TerminalEventRow[];

  for (const row of terminalRows) {
    const payload = parseJson(row.event_data);
    const provider = stringValue(payload.provider) ?? row.session_provider;
    const model = stringValue(payload.model) ?? row.session_model;
    const entry = ensureStats(stats, provider, model);
    entry.callCount += 1;
    if (row.event_type === 'result') entry.successCount += 1;
    if (row.event_type === 'error') entry.failureCount += 1;
    const latencyMs = row.latency_ms ?? numberValue(payload.latencyMs) ?? numberValue(payload.latency);
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
      entry.latencyTotal += latencyMs;
      entry.latencyCount += 1;
    }
  }

  const fallbackRows = db.prepare(
    `SELECT original_provider AS provider,
            original_model AS model,
            COUNT(*) AS count
       FROM provider_fallback_log
      ${since ? 'WHERE created_at >= ?' : ''}
   GROUP BY original_provider, original_model`,
  ).all(...(since ? [since] : [])) as FallbackCountRow[];
  for (const row of fallbackRows) {
    ensureStats(stats, row.provider, row.model).fallbackCount += row.count;
  }

  const ledgerRows = db.prepare(
    `SELECT provider,
            model,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(COALESCE(estimated_cost, 0)) AS estimated_cost
       FROM token_budget_ledger
      ${since ? 'WHERE created_at >= ?' : ''}
   GROUP BY provider, model`,
  ).all(...(since ? [since] : [])) as LedgerRow[];
  for (const row of ledgerRows) {
    const entry = ensureStats(stats, row.provider, row.model);
    entry.inputTokens += normalizeNumber(row.input_tokens);
    entry.outputTokens += normalizeNumber(row.output_tokens);
    entry.estimatedCost += normalizeNumber(row.estimated_cost);
  }

  return Array.from(stats.values()).map(toStats).sort((left, right) => {
    const calls = right.callCount - left.callCount;
    return calls !== 0 ? calls : `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`);
  });
}

function ensureStats(map: Map<string, ProviderStatsAccumulator>, provider: string, model: string): ProviderStatsAccumulator {
  const key = `${provider}\u0000${model}`;
  const existing = map.get(key);
  if (existing) return existing;
  const created: ProviderStatsAccumulator = {
    provider,
    model,
    callCount: 0,
    successCount: 0,
    failureCount: 0,
    fallbackCount: 0,
    latencyTotal: 0,
    latencyCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  };
  map.set(key, created);
  return created;
}

function toStats(entry: ProviderStatsAccumulator) {
  return {
    provider: entry.provider,
    model: entry.model,
    callCount: entry.callCount,
    successCount: entry.successCount,
    failureCount: entry.failureCount,
    fallbackCount: entry.fallbackCount,
    avgLatencyMs: entry.latencyCount > 0 ? Math.round(entry.latencyTotal / entry.latencyCount) : null,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    estimatedCost: entry.estimatedCost,
  };
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
