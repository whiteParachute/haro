import { Hono } from 'hono';
import {
  buildHaroPaths,
  createEvolutionAssetRegistry,
  type EvolutionAsset,
  type EvolutionAssetEvent,
  type EvolutionAssetRegistry,
  type EvolutionAssetStatus,
  type EvolutionAssetWithEvents,
} from '@haro/core';
import { SkillsManager, type SkillManifestEntry } from '@haro/skills';
import { buildPageInfo, parsePageQuery } from '../lib/pagination.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const SKILL_SORTS = ['id', 'installedAt', 'lastUsedAt', 'useCount', 'assetStatus', 'source'] as const;
type SkillSortKey = typeof SKILL_SORTS[number];

interface SkillReadModel {
  id: string;
  source: SkillManifestEntry['source'];
  enabled: boolean;
  installedAt: string;
  isPreinstalled: boolean;
  originalSource: string;
  pinnedCommit: string;
  license: string;
  description?: string;
  assetStatus: EvolutionAssetStatus | 'missing';
  assetRef: string;
  lastUsedAt?: string;
  useCount: number;
}

interface SkillDetailReadModel extends SkillReadModel {
  descriptor: {
    id: string;
    description: string;
    content: string;
  };
  asset?: EvolutionAssetWithEvents;
}

interface SkillMutationReadModel {
  skill: SkillReadModel;
  audit?: {
    asset?: EvolutionAsset | EvolutionAssetWithEvents;
    event?: EvolutionAssetEvent;
    status: 'recorded' | 'missing';
  };
}

export function createSkillsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => withSkills(runtime, (manager, registry) => {
    const page = parsePageQuery(c, {
      allowedSort: SKILL_SORTS,
      defaultSort: 'installedAt',
      defaultOrder: 'desc',
    });
    const skills = manager.list().map((entry) => summarizeSkill(entry, manager, registry));
    const filtered = filterSkills(skills, page.q);
    const sorted = sortSkills(filtered, page.sort, page.order);
    const total = sorted.length;
    return c.json({
      success: true,
      data: {
        items: sorted.slice(page.offset, page.offset + page.pageSize),
        count: total,
        total,
        pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
        limit: page.pageSize,
        offset: page.offset,
      },
    });
  }));

  route.get('/:id', (c) => withSkills(runtime, (manager, registry) => {
    const id = c.req.param('id');
    try {
      const info = manager.info(id);
      return c.json({ success: true, data: detailSkill(info, manager, registry) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  }));

  route.post('/:id/enable', (c) => withSkills(runtime, (manager, registry) => {
    const id = c.req.param('id');
    const result = mutateSkill(() => manager.enable(id), manager, registry, id);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ success: true, data: result.value });
  }));

  route.post('/:id/disable', (c) => withSkills(runtime, (manager, registry) => {
    const id = c.req.param('id');
    const result = mutateSkill(() => manager.disable(id), manager, registry, id);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ success: true, data: result.value });
  }));

  route.post('/install', async (c) => {
    if (runtime.skillAssetAuditSupported === false || runtime.evolutionAssetRegistry === false) {
      return c.json(unsupportedAuditPayload(), 501);
    }
    const body = await parseJsonObject(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const source = readRequiredString(body.value.source, 'source');
    if (!source.ok) return c.json({ error: source.error }, 400);
    try {
      return withSkills(runtime, (manager, registry) => {
        const result = mutateSkill(() => manager.install(source.value), manager, registry);
        if (!result.ok) return c.json({ error: result.error }, result.status);
        return c.json({ success: true, data: result.value }, 201);
      });
    } catch (error) {
      if (isAuditUnavailableError(error)) return c.json(unsupportedAuditPayload(error), 501);
      throw error;
    }
  });

  route.delete('/:id', (c) => {
    if (runtime.skillAssetAuditSupported === false || runtime.evolutionAssetRegistry === false) {
      return c.json(unsupportedAuditPayload(), 501);
    }
    try {
      return withSkills(runtime, (manager, registry) => {
        const id = c.req.param('id');
        const entry = manager.list().find((item) => item.id === id);
        if (!entry) return c.json({ error: `Skill '${id}' not installed` }, 404);
        if (entry.isPreinstalled) return c.json({ error: 'Preinstalled skills cannot be uninstalled' }, 403);
        const beforeEvents = registry.listEvents(skillAssetId(id)).length;
        try {
          const removed = manager.uninstall(id);
          const afterEvents = registry.listEvents(skillAssetId(id)).length;
          const audit = readLatestAudit(registry, removed.id, afterEvents > beforeEvents);
          return c.json({
            success: true,
            data: {
              skill: {
                ...summarizeEntryAfterUninstall(removed, registry),
                enabled: false,
              },
              audit,
            },
          });
        } catch (error) {
          return c.json({ error: errorMessage(error) }, 400);
        }
      });
    } catch (error) {
      if (isAuditUnavailableError(error)) return c.json(unsupportedAuditPayload(error), 501);
      throw error;
    }
  });

  return route;
}

function withSkills<T>(
  runtime: WebRuntime,
  fn: (manager: SkillsManager, registry: EvolutionAssetRegistry) => T,
): T {
  const registry = resolveRegistry(runtime);
  const manager = runtime.skillsManager ?? new SkillsManager({ root: buildHaroPaths(runtime.root).root, registry });
  const ownsManager = runtime.skillsManager === undefined;
  const ownsRegistry = runtime.evolutionAssetRegistry === undefined;
  try {
    manager.ensureInitialized();
    return fn(manager, registry);
  } finally {
    if (ownsManager) manager.close();
    if (ownsRegistry) registry.close();
  }
}

function resolveRegistry(runtime: WebRuntime): EvolutionAssetRegistry {
  if (runtime.evolutionAssetRegistry) return runtime.evolutionAssetRegistry;
  return createEvolutionAssetRegistry({ root: runtime.root });
}

function mutateSkill(
  action: () => SkillManifestEntry,
  manager: SkillsManager,
  registry: EvolutionAssetRegistry,
  knownSkillId?: string,
): { ok: true; value: SkillMutationReadModel } | { ok: false; status: 400 | 404; error: string } {
  try {
    const beforeEvents = knownSkillId ? registry.listEvents(skillAssetId(knownSkillId)).length : registry.listEvents().length;
    const entry = action();
    const afterEvents = knownSkillId ? registry.listEvents(skillAssetId(entry.id)).length : registry.listEvents().length;
    const audit = readLatestAudit(registry, entry.id, afterEvents > beforeEvents);
    return {
      ok: true,
      value: {
        skill: summarizeSkill(entry, manager, registry),
        audit,
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    return { ok: false, status: message.includes('not installed') ? 404 : 400, error: message };
  }
}

function summarizeSkill(entry: SkillManifestEntry, manager: SkillsManager, registry: EvolutionAssetRegistry): SkillReadModel {
  const usage = manager.getUsage(entry.id);
  const asset = registry.getAsset(skillAssetId(entry.id));
  const model: SkillReadModel = {
    id: entry.id,
    source: entry.source,
    enabled: entry.enabled,
    installedAt: entry.installedAt,
    isPreinstalled: entry.isPreinstalled,
    originalSource: entry.originalSource,
    pinnedCommit: entry.pinnedCommit,
    license: entry.license,
    assetStatus: asset?.status ?? 'missing',
    assetRef: skillAssetId(entry.id),
    useCount: usage?.useCount ?? 0,
  };
  if (entry.description) model.description = entry.description;
  if (usage?.lastUsedAt) model.lastUsedAt = usage.lastUsedAt;
  return model;
}

function detailSkill(
  info: SkillManifestEntry & { descriptor: SkillDetailReadModel['descriptor'] },
  manager: SkillsManager,
  registry: EvolutionAssetRegistry,
): SkillDetailReadModel {
  const asset = registry.getAsset(skillAssetId(info.id), { includeEvents: true });
  return {
    ...summarizeSkill(info, manager, registry),
    descriptor: info.descriptor,
    ...(asset ? { asset } : {}),
  };
}

function summarizeEntryAfterUninstall(entry: SkillManifestEntry, registry: EvolutionAssetRegistry): SkillReadModel {
  const asset = registry.getAsset(skillAssetId(entry.id));
  return {
    id: entry.id,
    source: entry.source,
    enabled: false,
    installedAt: entry.installedAt,
    isPreinstalled: entry.isPreinstalled,
    originalSource: entry.originalSource,
    pinnedCommit: entry.pinnedCommit,
    license: entry.license,
    description: entry.description,
    assetStatus: asset?.status ?? 'archived',
    assetRef: skillAssetId(entry.id),
    useCount: 0,
  };
}

function readLatestAudit(registry: EvolutionAssetRegistry, skillId: string, didRecord: boolean): SkillMutationReadModel['audit'] {
  const assetId = skillAssetId(skillId);
  const events = registry.listEvents(assetId);
  const event = didRecord ? events.at(-1) : undefined;
  const asset = registry.getAsset(assetId, { includeEvents: true }) ?? undefined;
  return {
    status: didRecord && event ? 'recorded' : 'missing',
    ...(asset ? { asset } : {}),
    ...(event ? { event } : {}),
  };
}

function filterSkills(items: readonly SkillReadModel[], q: string): SkillReadModel[] {
  if (!q) return [...items];
  const needle = q.toLowerCase();
  return items.filter((item) => [
    item.id,
    item.description,
    item.originalSource,
    item.source,
    item.assetStatus,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)));
}

function sortSkills(items: readonly SkillReadModel[], sort: SkillSortKey, order: 'asc' | 'desc'): SkillReadModel[] {
  return [...items].sort((left, right) => {
    const direction = order === 'asc' ? 1 : -1;
    const primary = compareSkill(left, right, sort) * direction;
    if (primary !== 0) return primary;
    return left.id.localeCompare(right.id) * direction;
  });
}

function compareSkill(left: SkillReadModel, right: SkillReadModel, sort: SkillSortKey): number {
  switch (sort) {
    case 'id':
      return left.id.localeCompare(right.id);
    case 'installedAt':
      return left.installedAt.localeCompare(right.installedAt);
    case 'lastUsedAt':
      return compareNullableString(left.lastUsedAt, right.lastUsedAt);
    case 'useCount':
      return left.useCount - right.useCount;
    case 'assetStatus':
      return left.assetStatus.localeCompare(right.assetStatus);
    case 'source':
      return left.source.localeCompare(right.source);
  }
}

function compareNullableString(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

async function parseJsonObject(c: { req: { json: () => Promise<unknown> } }): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function readRequiredString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `Field '${field}' must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

function unsupportedAuditPayload(error?: unknown) {
  return {
    success: false,
    error: 'unsupported',
    code: 'asset-audit-unsupported',
    message: 'Skill install/uninstall requires Evolution Asset Registry audit support',
    ...(error ? { detail: errorMessage(error) } : {}),
  };
}

function skillAssetId(skillId: string): string {
  return `skill:${skillId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuditUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('EvolutionAssetRegistry') ||
    error.message.includes('better-sqlite3') ||
    error.message.includes('SQLITE') ||
    error.message.includes('read-only file system') ||
    error.message.includes('EROFS');
}
