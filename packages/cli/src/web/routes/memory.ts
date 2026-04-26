import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import {
  DEFAULT_AGENT_ID,
  buildHaroPaths,
  createMemoryFabric,
  type MemoryEntryScope,
  type MemoryLayer,
  type MemoryQuery,
  type MemoryScope,
  type VerificationStatus,
} from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const MEMORY_SCOPES = new Set(['platform', 'shared', 'agent']);
const MEMORY_LAYERS = new Set(['session', 'persistent', 'skill']);
const VERIFICATION_STATUSES = new Set(['unverified', 'verified', 'conflicted', 'rejected']);

type StrictRecord = Record<string, unknown>;

interface MemoryWriteBody {
  scope: 'shared' | 'agent' | 'platform';
  agentId?: string;
  layer: MemoryLayer;
  topic: string;
  summary?: string;
  content: string;
  sourceRef: string;
  assetRef?: string;
  verificationStatus?: VerificationStatus;
  tags: string[];
}

export function createMemoryRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/query', (c) => {
    const query = parseMemoryQuery(c.req.query());
    if (!query.ok) return c.json({ error: query.error }, 400);
    const fabric = createRouteMemoryFabric(runtime);
    const results = fabric.queryEntries(query.value);
    return c.json({
      success: true,
      data: {
        items: results.map((result) => ({
          ...result,
          entry: result.entry,
        })),
        count: results.length,
        limit: query.value.limit ?? 20,
      },
    });
  });

  route.post('/write', async (c) => {
    const parsed = await parseMemoryWriteBody(c);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (parsed.value.scope === 'platform') {
      return c.json({ error: 'Writing platform memory is forbidden from the web dashboard' }, 403);
    }

    const currentAgentId = resolveCurrentAgentId(runtime);
    if (parsed.value.scope === 'agent' && parsed.value.agentId !== currentAgentId) {
      return c.json({ error: `Agent-scope writes are limited to current agent '${currentAgentId}'` }, 403);
    }

    const fabric = createRouteMemoryFabric(runtime);
    const entry = await fabric.writeEntry({
      layer: parsed.value.layer,
      scope: parsed.value.scope === 'shared' ? 'shared' : `agent:${parsed.value.agentId}`,
      agentId: parsed.value.scope === 'agent' ? parsed.value.agentId : undefined,
      topic: parsed.value.topic,
      summary: parsed.value.summary,
      content: parsed.value.content,
      sourceRef: parsed.value.sourceRef,
      assetRef: parsed.value.assetRef,
      verificationStatus: parsed.value.verificationStatus,
      tags: parsed.value.tags,
    });
    return c.json({ success: true, data: entry }, 201);
  });

  route.get('/stats', (c) => {
    const fabric = createRouteMemoryFabric(runtime);
    return c.json({ success: true, data: fabric.stats() });
  });

  route.post('/maintenance', async (c) => {
    const body = await parseOptionalJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const scope = readEnum(body.value.scope, MEMORY_SCOPES, 'scope') as MemoryScope | undefined;
    if (scope === null) return c.json({ error: "Field 'scope' must be one of platform, shared, agent" }, 400);
    const agentId = readOptionalString(body.value.agentId);
    if (scope === 'agent' && !agentId) return c.json({ error: "Field 'agentId' is required when scope is agent" }, 400);
    if (scope !== 'agent' && agentId) return c.json({ error: "Field 'agentId' is only valid when scope is agent" }, 400);

    const taskId = `memory-maintenance-${randomUUID()}`;
    const fabric = createRouteMemoryFabric(runtime);
    void fabric.maintenance({ scope, agentId }).catch((error) => {
      runtime.logger.error?.({ taskId, err: error instanceof Error ? error.message : String(error) }, 'memory maintenance failed');
    });
    return c.json({
      success: true,
      data: {
        taskId,
        status: 'accepted',
        async: true,
      },
    }, 202);
  });

  return route;
}

function createRouteMemoryFabric(runtime: WebRuntime) {
  const paths = buildHaroPaths(runtime.root);
  return createMemoryFabric({ root: paths.dirs.memory, dbFile: runtime.dbFile ?? paths.dbFile });
}

function parseMemoryQuery(raw: Record<string, string>): { ok: true; value: MemoryQuery } | { ok: false; error: string } {
  const limit = parseLimit(raw.limit);
  if (!limit.ok) return limit;
  const scope = parseQueryScope(raw.scope, raw.agentId);
  if (!scope.ok) return scope;
  const layer = raw.layer ? readEnum(raw.layer, MEMORY_LAYERS, 'layer') as MemoryLayer | null : undefined;
  if (layer === null) return { ok: false, error: "Query 'layer' must be one of session, persistent, skill" };
  const verificationStatus = raw.verificationStatus
    ? readEnum(raw.verificationStatus, VERIFICATION_STATUSES, 'verificationStatus') as VerificationStatus | null
    : undefined;
  if (verificationStatus === null) {
    return { ok: false, error: "Query 'verificationStatus' must be one of unverified, verified, conflicted, rejected" };
  }
  const query: MemoryQuery = {
    includeArchived: false,
    limit: limit.value,
  };
  if (raw.keyword) query.keyword = raw.keyword;
  if (scope.value) query.scope = scope.value;
  if (raw.agentId) query.agentId = raw.agentId;
  if (layer) query.layer = layer;
  if (verificationStatus) query.verificationStatus = verificationStatus;
  return { ok: true, value: query };
}

function parseQueryScope(scope: string | undefined, agentId: string | undefined): { ok: true; value?: MemoryEntryScope } | { ok: false; error: string } {
  if (!scope) return { ok: true };
  if (!MEMORY_SCOPES.has(scope)) return { ok: false, error: "Query 'scope' must be one of platform, shared, agent" };
  if (scope === 'agent') {
    if (!agentId) return { ok: false, error: "Query 'agentId' is required when scope is agent" };
    return { ok: true, value: `agent:${agentId}` };
  }
  return { ok: true, value: scope as 'platform' | 'shared' };
}

async function parseMemoryWriteBody(c: Context<ApiKeyAuthEnv>): Promise<{ ok: true; value: MemoryWriteBody } | { ok: false; error: string }> {
  const parsed = await parseRequiredJson(c);
  if (!parsed.ok) return parsed;
  const body = parsed.value;
  const scope = readEnum(body.scope, MEMORY_SCOPES, 'scope') as MemoryWriteBody['scope'] | null | undefined;
  if (!scope) return { ok: false, error: "Field 'scope' must be one of platform, shared, agent" };
  const agentId = readOptionalString(body.agentId);
  if (scope === 'agent' && !agentId) return { ok: false, error: "Field 'agentId' is required when scope is agent" };
  if (scope !== 'agent' && agentId) return { ok: false, error: "Field 'agentId' is only valid when scope is agent" };
  const layer = body.layer === undefined ? 'persistent' : readEnum(body.layer, MEMORY_LAYERS, 'layer') as MemoryLayer | null;
  if (!layer) return { ok: false, error: "Field 'layer' must be one of session, persistent, skill" };
  const topic = readRequiredString(body.topic, 'topic');
  if (!topic.ok) return topic;
  const content = readRequiredString(body.content, 'content');
  if (!content.ok) return content;
  const sourceRef = readOptionalString(body.sourceRef) ?? readOptionalString(body.source) ?? 'web-dashboard';
  const verificationStatus = body.verificationStatus === undefined
    ? undefined
    : readEnum(body.verificationStatus, VERIFICATION_STATUSES, 'verificationStatus') as VerificationStatus | null;
  if (verificationStatus === null) {
    return { ok: false, error: "Field 'verificationStatus' must be one of unverified, verified, conflicted, rejected" };
  }
  const tags = readStringArray(body.tags, 'tags');
  if (!tags.ok) return tags;
  return {
    ok: true,
    value: {
      scope,
      agentId,
      layer,
      topic: topic.value,
      summary: readOptionalString(body.summary),
      content: content.value,
      sourceRef,
      assetRef: readOptionalString(body.assetRef),
      verificationStatus,
      tags: tags.value,
    },
  };
}

async function parseRequiredJson(c: { req: { json: () => Promise<unknown> } }): Promise<{ ok: true; value: StrictRecord } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };
  return { ok: true, value: body };
}

async function parseOptionalJson(c: { req: { json: () => Promise<unknown> } }): Promise<{ ok: true; value: StrictRecord } | { ok: false; error: string }> {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };
  return { ok: true, value: body };
}

function parseLimit(value: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: 20 };
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, error: "Query 'limit' must be an integer between 1 and 100" };
  }
  return { ok: true, value: limit };
}

function readEnum(value: unknown, allowed: Set<string>, _field: string): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && allowed.has(value) ? value : null;
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
  return { ok: true, value: value };
}

function resolveCurrentAgentId(runtime: WebRuntime): string {
  return runtime.loaded?.config.defaultAgent ?? DEFAULT_AGENT_ID;
}

function isRecord(value: unknown): value is StrictRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
