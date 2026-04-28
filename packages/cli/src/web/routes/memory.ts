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
import { buildPageInfo, parsePageQuery } from '../lib/pagination.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const MEMORY_SCOPES = new Set(['platform', 'shared', 'agent']);
const MEMORY_LAYERS = new Set(['session', 'persistent', 'skill']);
const VERIFICATION_STATUSES = new Set(['unverified', 'verified', 'conflicted', 'rejected']);
const MEMORY_SORTS = ['updatedAt', 'createdAt', 'topic', 'layer', 'verificationStatus', 'score'] as const;
const MEMORY_VERIFICATION_ORDER: Record<VerificationStatus, number> = {
  verified: 0,
  unverified: 1,
  conflicted: 2,
  rejected: 3,
};
const MEMORY_LAYER_ORDER: Record<MemoryLayer, number> = {
  persistent: 0,
  skill: 1,
  session: 2,
};
const MEMORY_QUERY_SCAN_LIMIT = 5000;

type StrictRecord = Record<string, unknown>;
type MemorySortKey = typeof MEMORY_SORTS[number];
type MemorySearchResultLike = ReturnType<ReturnType<typeof createRouteMemoryFabric>['queryEntries']>[number];

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
    const page = parsePageQuery(c, {
      allowedSort: MEMORY_SORTS,
      defaultSort: 'updatedAt',
      defaultOrder: 'desc',
    });
    const rawQuery = c.req.query();
    const query = parseMemoryQuery(rawQuery, page.q);
    if (!query.ok) return c.json({ error: query.error }, 400);
    const fabric = createRouteMemoryFabric(runtime);
    const results = sortMemoryResults(
      fabric.queryEntries({
        ...query.value,
        limit: Math.max(MEMORY_QUERY_SCAN_LIMIT, page.page * page.pageSize),
      }),
      page.sort,
      page.order,
    );
    const total = results.length;
    const items = results
      .slice(page.offset, page.offset + page.pageSize)
      .map((result) => ({
        ...result,
        entry: result.entry,
      }));
    return c.json({
      success: true,
      data: {
        items,
        count: total,
        total,
        pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
        limit: page.pageSize,
        offset: page.offset,
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

function parseMemoryQuery(raw: Record<string, string>, q: string): { ok: true; value: MemoryQuery } | { ok: false; error: string } {
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
  };
  const keyword = q || raw.keyword || raw.query;
  if (keyword) query.keyword = keyword;
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

function sortMemoryResults(
  results: readonly MemorySearchResultLike[],
  sort: MemorySortKey,
  order: 'asc' | 'desc',
): MemorySearchResultLike[] {
  return [...results].sort((left, right) => {
    const direction = order === 'asc' ? 1 : -1;
    const primary = compareMemoryResult(left, right, sort) * direction;
    if (primary !== 0) return primary;
    return left.entry.id.localeCompare(right.entry.id) * direction;
  });
}

function compareMemoryResult(left: MemorySearchResultLike, right: MemorySearchResultLike, sort: MemorySortKey): number {
  switch (sort) {
    case 'score':
      return left.score - right.score;
    case 'createdAt':
      return left.entry.createdAt.localeCompare(right.entry.createdAt);
    case 'updatedAt':
      return left.entry.updatedAt.localeCompare(right.entry.updatedAt);
    case 'topic':
      return left.entry.topic.localeCompare(right.entry.topic);
    case 'layer':
      return MEMORY_LAYER_ORDER[left.entry.layer] - MEMORY_LAYER_ORDER[right.entry.layer];
    case 'verificationStatus':
      return MEMORY_VERIFICATION_ORDER[left.entry.verificationStatus] - MEMORY_VERIFICATION_ORDER[right.entry.verificationStatus];
  }
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
