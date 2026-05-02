import { randomUUID } from 'node:crypto';
import {
  createMemoryFabric,
  type MemoryEntry,
  type MemoryEntryScope,
  type MemoryFabric,
  type MemoryLayer,
  type MemoryQuery,
  type MemoryScope,
  type MemorySearchResult,
  type MemoryStats,
  type VerificationStatus,
} from '../memory/index.js';
import { buildHaroPaths } from '../paths.js';
import { HaroError } from '../errors/index.js';
import {
  buildPageInfo,
  normalizePageQuery,
  type PageQuery,
  type PaginatedResult,
  type ServiceContext,
} from './types.js';

const MEMORY_SCOPES = new Set(['platform', 'shared', 'agent']);
const MEMORY_LAYERS = new Set(['session', 'persistent', 'skill']);
const VERIFICATION_STATUSES = new Set(['unverified', 'verified', 'conflicted', 'rejected']);
const MEMORY_SORTS = ['updatedAt', 'createdAt', 'topic', 'layer', 'verificationStatus', 'score'] as const;
type MemorySortKey = typeof MEMORY_SORTS[number];

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

export interface MemoryQueryRequest extends PageQuery {
  scope?: 'platform' | 'shared' | 'agent';
  agentId?: string;
  layer?: MemoryLayer;
  verificationStatus?: VerificationStatus;
  keyword?: string;
}

export interface MemoryWriteRequest {
  scope: 'shared' | 'agent';
  agentId?: string;
  layer?: MemoryLayer;
  topic: string;
  summary?: string;
  content: string;
  sourceRef?: string;
  assetRef?: string;
  verificationStatus?: VerificationStatus;
  tags?: string[];
}

export interface MemoryMaintenanceRequest {
  scope?: MemoryScope;
  agentId?: string;
}

export interface MemoryMaintenanceResult {
  taskId: string;
  status: 'accepted';
  async: true;
}

export type MemoryQueryResultItem = MemorySearchResult;

export function queryMemory(
  ctx: ServiceContext,
  request: MemoryQueryRequest = {},
): PaginatedResult<MemoryQueryResultItem> {
  const page = normalizePageQuery(request, {
    allowedSort: MEMORY_SORTS,
    defaultSort: 'updatedAt',
    defaultOrder: 'desc',
  });
  const query = buildMemoryQueryInput(request, page.q);
  const fabric = openFabric(ctx);
  try {
    const results = sortMemoryResults(
      fabric.queryEntries({
        ...query,
        limit: Math.max(MEMORY_QUERY_SCAN_LIMIT, page.page * page.pageSize),
      }),
      page.sort as MemorySortKey,
      page.order,
    );
    const total = results.length;
    const items = results.slice(page.offset, page.offset + page.pageSize);
    return {
      items,
      pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
      total,
      limit: page.pageSize,
      offset: page.offset,
    };
  } finally {
    closeFabric(fabric);
  }
}

export interface WriteMemoryOptions {
  /** Caller-provided current agent id (services can't infer it). */
  currentAgentId: string;
}

export async function writeMemoryEntry(
  ctx: ServiceContext,
  request: MemoryWriteRequest,
  options: WriteMemoryOptions,
): Promise<MemoryEntry> {
  if ((request.scope as string) === 'platform') {
    throw new HaroError('MEMORY_PLATFORM_FORBIDDEN', 'Writing platform memory is forbidden from CLI/web', {
      remediation: 'Platform-scope memory is reserved for system metabolism (eat/shit)',
    });
  }
  if (request.scope === 'agent') {
    if (!request.agentId) {
      throw new HaroError('INVALID_INPUT', "Field 'agentId' is required when scope is agent", {
        remediation: 'Pass --agent <id> or include agentId in the request body',
      });
    }
    if (request.agentId !== options.currentAgentId) {
      throw new HaroError(
        'MEMORY_AGENT_SCOPE_LIMIT',
        `Agent-scope writes are limited to current agent '${options.currentAgentId}'`,
        { remediation: 'Run with --agent matching the active agent, or use --scope shared' },
      );
    }
  }
  if (request.scope !== 'agent' && request.agentId) {
    throw new HaroError('INVALID_INPUT', "Field 'agentId' is only valid when scope is agent");
  }

  const fabric = openFabric(ctx);
  try {
    return await fabric.writeEntry({
      layer: request.layer ?? 'persistent',
      scope: request.scope === 'shared' ? 'shared' : `agent:${request.agentId}`,
      ...(request.scope === 'agent' && request.agentId ? { agentId: request.agentId } : {}),
      topic: request.topic,
      ...(request.summary ? { summary: request.summary } : {}),
      content: request.content,
      sourceRef: request.sourceRef ?? 'cli',
      ...(request.assetRef ? { assetRef: request.assetRef } : {}),
      ...(request.verificationStatus ? { verificationStatus: request.verificationStatus } : {}),
      tags: request.tags ?? [],
    });
  } finally {
    closeFabric(fabric);
  }
}

export function memoryStats(ctx: ServiceContext): MemoryStats {
  const fabric = openFabric(ctx);
  try {
    return fabric.stats();
  } finally {
    closeFabric(fabric);
  }
}

export function startMemoryMaintenance(
  ctx: ServiceContext,
  request: MemoryMaintenanceRequest,
): MemoryMaintenanceResult {
  if (request.scope === 'agent' && !request.agentId) {
    throw new HaroError('INVALID_INPUT', "Field 'agentId' is required when scope is agent");
  }
  if (request.scope !== 'agent' && request.agentId) {
    throw new HaroError('INVALID_INPUT', "Field 'agentId' is only valid when scope is agent");
  }

  const taskId = `memory-maintenance-${randomUUID()}`;
  const fabric = openFabric(ctx);
  void fabric
    .maintenance({
      ...(request.scope ? { scope: request.scope } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    })
    .catch((error) => {
      ctx.logger?.error?.(
        { taskId, err: error instanceof Error ? error.message : String(error) },
        'memory maintenance failed',
      );
    })
    .finally(() => closeFabric(fabric));
  return { taskId, status: 'accepted', async: true };
}

export function buildMemoryQueryInput(request: MemoryQueryRequest, q?: string): MemoryQuery {
  const query: MemoryQuery = { includeArchived: false };
  const keyword = q || request.keyword;
  if (keyword) query.keyword = keyword;
  if (request.scope) query.scope = parseScope(request.scope, request.agentId);
  if (request.agentId) query.agentId = request.agentId;
  if (request.layer) {
    if (!MEMORY_LAYERS.has(request.layer)) {
      throw new HaroError('MEMORY_QUERY_INVALID', "layer must be one of session, persistent, skill");
    }
    query.layer = request.layer;
  }
  if (request.verificationStatus) {
    if (!VERIFICATION_STATUSES.has(request.verificationStatus)) {
      throw new HaroError(
        'MEMORY_QUERY_INVALID',
        "verificationStatus must be one of unverified, verified, conflicted, rejected",
      );
    }
    query.verificationStatus = request.verificationStatus;
  }
  return query;
}

function parseScope(scope: string, agentId?: string): MemoryEntryScope {
  if (!MEMORY_SCOPES.has(scope)) {
    throw new HaroError('MEMORY_QUERY_INVALID', "scope must be one of platform, shared, agent");
  }
  if (scope === 'agent') {
    if (!agentId) {
      throw new HaroError('MEMORY_QUERY_INVALID', "agentId is required when scope is agent");
    }
    return `agent:${agentId}`;
  }
  return scope as 'platform' | 'shared';
}

function sortMemoryResults(
  results: readonly MemoryQueryResultItem[],
  sort: MemorySortKey,
  order: 'asc' | 'desc',
): MemoryQueryResultItem[] {
  return [...results].sort((left, right) => {
    const direction = order === 'asc' ? 1 : -1;
    const primary = compareMemoryResult(left, right, sort) * direction;
    if (primary !== 0) return primary;
    return left.entry.id.localeCompare(right.entry.id) * direction;
  });
}

function compareMemoryResult(
  left: MemoryQueryResultItem,
  right: MemoryQueryResultItem,
  sort: MemorySortKey,
): number {
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

function openFabric(ctx: ServiceContext): MemoryFabric {
  const paths = buildHaroPaths(ctx.root);
  return createMemoryFabric({ root: paths.dirs.memory, dbFile: ctx.dbFile ?? paths.dbFile });
}

function closeFabric(fabric: MemoryFabric): void {
  const closer = (fabric as unknown as { close?: () => void }).close;
  if (typeof closer === 'function') closer.call(fabric);
}
