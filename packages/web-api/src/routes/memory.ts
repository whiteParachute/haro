import { Hono, type Context } from 'hono';
import {
  DEFAULT_AGENT_ID,
  HaroError,
  services,
  type MemoryLayer,
  type VerificationStatus,
} from '@haro/core';
import { readPageQuery, readStringFilter } from '../lib/route-query.js';
import { requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const VALID_LAYERS = new Set<MemoryLayer>(['session', 'persistent', 'skill']);
const VALID_VERIFICATION = new Set<VerificationStatus>(['unverified', 'verified', 'conflicted', 'rejected']);

export function createMemoryRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/query', (c) => {
    const layer = readStringFilter(c, 'layer');
    if (layer && !VALID_LAYERS.has(layer as MemoryLayer)) {
      return c.json({ error: "Query 'layer' must be one of session, persistent, skill" }, 400);
    }
    const verificationStatus = readStringFilter(c, 'verificationStatus');
    if (verificationStatus && !VALID_VERIFICATION.has(verificationStatus as VerificationStatus)) {
      return c.json({ error: "Query 'verificationStatus' must be one of unverified, verified, conflicted, rejected" }, 400);
    }
    const scope = readStringFilter(c, 'scope');
    if (scope && !['platform', 'shared', 'agent'].includes(scope)) {
      return c.json({ error: "Query 'scope' must be one of platform, shared, agent" }, 400);
    }
    const agentId = readStringFilter(c, 'agentId');
    if (scope === 'agent' && !agentId) {
      return c.json({ error: "Query 'agentId' is required when scope is agent" }, 400);
    }
    try {
      const result = services.memory.queryMemory(ctx(), {
        ...(scope ? { scope: scope as 'platform' | 'shared' | 'agent' } : {}),
        ...(agentId ? { agentId } : {}),
        ...(layer ? { layer: layer as MemoryLayer } : {}),
        ...(verificationStatus ? { verificationStatus: verificationStatus as VerificationStatus } : {}),
        ...(readStringFilter(c, 'keyword') ? { keyword: readStringFilter(c, 'keyword')! } : {}),
        ...readPageQuery(c),
      });
      return c.json({
        success: true,
        data: {
          ...result,
          count: result.total,
        },
      });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'MEMORY_QUERY_INVALID') {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  route.post('/write', requireWebPermission('local-write'), async (c) => {
    const parsed = await parseRequiredJson(c);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;

    const scope = body.scope;
    if (scope !== 'shared' && scope !== 'agent' && scope !== 'platform') {
      return c.json({ error: "Field 'scope' must be one of platform, shared, agent" }, 400);
    }
    if (scope === 'platform') {
      return c.json({ error: 'Writing platform memory is forbidden from the web dashboard' }, 403);
    }
    const agentId = readOptionalString(body.agentId);
    if (scope === 'agent' && !agentId) {
      return c.json({ error: "Field 'agentId' is required when scope is agent" }, 400);
    }
    if (scope !== 'agent' && agentId) {
      return c.json({ error: "Field 'agentId' is only valid when scope is agent" }, 400);
    }
    const layer = body.layer === undefined ? 'persistent' : body.layer;
    if (!VALID_LAYERS.has(layer as MemoryLayer)) {
      return c.json({ error: "Field 'layer' must be one of session, persistent, skill" }, 400);
    }
    const topic = readRequiredString(body.topic, 'topic');
    if (!topic.ok) return c.json({ error: topic.error }, 400);
    const content = readRequiredString(body.content, 'content');
    if (!content.ok) return c.json({ error: content.error }, 400);
    const verificationStatus = body.verificationStatus === undefined ? undefined : body.verificationStatus;
    if (verificationStatus !== undefined && !VALID_VERIFICATION.has(verificationStatus as VerificationStatus)) {
      return c.json({ error: "Field 'verificationStatus' must be one of unverified, verified, conflicted, rejected" }, 400);
    }
    const tags = readStringArray(body.tags, 'tags');
    if (!tags.ok) return c.json({ error: tags.error }, 400);

    const sourceRef = readOptionalString(body.sourceRef) ?? readOptionalString(body.source) ?? 'web-dashboard';
    const summary = readOptionalString(body.summary);
    const assetRef = readOptionalString(body.assetRef);

    try {
      const entry = await services.memory.writeMemoryEntry(
        ctx(),
        {
          scope: scope as 'shared' | 'agent',
          ...(scope === 'agent' && agentId ? { agentId } : {}),
          layer: layer as MemoryLayer,
          topic: topic.value,
          ...(summary ? { summary } : {}),
          content: content.value,
          sourceRef,
          ...(assetRef ? { assetRef } : {}),
          ...(verificationStatus ? { verificationStatus: verificationStatus as VerificationStatus } : {}),
          tags: tags.value,
        },
        { currentAgentId: resolveCurrentAgentId(runtime) },
      );
      return c.json({ success: true, data: entry }, 201);
    } catch (error) {
      if (error instanceof HaroError) {
        if (error.code === 'MEMORY_PLATFORM_FORBIDDEN') return c.json({ error: error.message }, 403);
        if (error.code === 'MEMORY_AGENT_SCOPE_LIMIT') return c.json({ error: error.message }, 403);
        if (error.code === 'INVALID_INPUT') return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  route.get('/stats', (c) => c.json({ success: true, data: services.memory.memoryStats(ctx()) }));

  route.post('/maintenance', requireWebPermission('config-write'), async (c) => {
    const body = await parseOptionalJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const scope = body.value.scope;
    if (scope !== undefined && !['platform', 'shared', 'agent'].includes(String(scope))) {
      return c.json({ error: "Field 'scope' must be one of platform, shared, agent" }, 400);
    }
    const agentId = readOptionalString(body.value.agentId);
    try {
      const result = services.memory.startMemoryMaintenance(ctx(), {
        ...(scope ? { scope: scope as 'platform' | 'shared' | 'agent' } : {}),
        ...(agentId ? { agentId } : {}),
      });
      return c.json({ success: true, data: result }, 202);
    } catch (error) {
      if (error instanceof HaroError && error.code === 'INVALID_INPUT') {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return route;
}

function resolveCurrentAgentId(runtime: WebRuntime): string {
  return runtime.loaded?.config.defaultAgent ?? DEFAULT_AGENT_ID;
}

async function parseRequiredJson(c: Context<ApiKeyAuthEnv>): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };
  return { ok: true, value: body };
}

async function parseOptionalJson(c: Context<ApiKeyAuthEnv>): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }
> {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };
  return { ok: true, value: body };
}

function readRequiredString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `Field '${field}' must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown, field: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { ok: false, error: `Field '${field}' must be an array of strings` };
  }
  return { ok: true, value: value as string[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
