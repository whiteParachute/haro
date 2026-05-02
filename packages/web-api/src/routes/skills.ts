import { Hono } from 'hono';
import {
  HaroError,
  buildHaroPaths,
  createEvolutionAssetRegistry,
  services,
  type EvolutionAssetRegistry,
} from '@haro/core';
import { SkillsManager } from '@haro/skills';
import { readPageQuery } from '../lib/route-query.js';
import { requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const SKILL_SORTS = ['id', 'installedAt', 'lastUsedAt', 'useCount', 'assetStatus', 'source'] as const;
type SkillSortKey = typeof SKILL_SORTS[number];

export function createSkillsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => {
    const page = services.normalizePageQuery(readPageQuery(c) as services.PageQuery, {
      allowedSort: SKILL_SORTS,
      defaultSort: 'installedAt',
      defaultOrder: 'desc',
    });
    return withSkillsCtx(runtime, (ctx) => {
      const skills = services.skills.listSkills(ctx);
      const filtered = filterSkills(skills, page.q);
      const sorted = sortSkills(filtered, page.sort as SkillSortKey, page.order);
      const total = sorted.length;
      const items = sorted.slice(page.offset, page.offset + page.pageSize);
      return c.json({
        success: true,
        data: {
          items,
          count: total,
          total,
          pageInfo: services.buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
          limit: page.pageSize,
          offset: page.offset,
        },
      });
    });
  });

  route.get('/:id', (c) => withSkillsCtx(runtime, (ctx) => {
    try {
      const detail = services.skills.getSkillDetail(ctx, c.req.param('id'));
      return c.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'SKILL_NOT_FOUND') {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }));

  route.post('/:id/enable', requireWebPermission('config-write'), (c) => withSkillsCtx(runtime, (ctx) => {
    try {
      return c.json({ success: true, data: services.skills.enableSkill(ctx, c.req.param('id')) });
    } catch (error) {
      const mapped = mapSkillError(c, error);
      if (mapped) return mapped;
      throw error;
    }
  }));

  route.post('/:id/disable', requireWebPermission('config-write'), (c) => withSkillsCtx(runtime, (ctx) => {
    try {
      return c.json({ success: true, data: services.skills.disableSkill(ctx, c.req.param('id')) });
    } catch (error) {
      const mapped = mapSkillError(c, error);
      if (mapped) return mapped;
      throw error;
    }
  }));

  route.post('/install', requireWebPermission('config-write'), async (c) => {
    if (runtime.skillAssetAuditSupported === false || runtime.evolutionAssetRegistry === false) {
      return c.json(unsupportedAuditPayload(), 501);
    }
    const body = await parseJsonObject(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const source = readRequiredString(body.value.source, 'source');
    if (!source.ok) return c.json({ error: source.error }, 400);
    try {
      return withSkillsCtx(runtime, (ctx) =>
        c.json({ success: true, data: services.skills.installSkill(ctx, source.value) }, 201),
      );
    } catch (error) {
      if (services.skills.isAssetAuditUnavailableError(error)) return c.json(unsupportedAuditPayload(error), 501);
      const mapped = mapSkillError(c, error);
      if (mapped) return mapped;
      throw error;
    }
  });

  route.delete('/:id', requireWebPermission('config-write'), (c) => {
    if (runtime.skillAssetAuditSupported === false || runtime.evolutionAssetRegistry === false) {
      return c.json(unsupportedAuditPayload(), 501);
    }
    try {
      return withSkillsCtx(runtime, (ctx) =>
        c.json({ success: true, data: services.skills.uninstallSkill(ctx, c.req.param('id')) }),
      );
    } catch (error) {
      if (services.skills.isAssetAuditUnavailableError(error)) return c.json(unsupportedAuditPayload(error), 501);
      const mapped = mapSkillError(c, error);
      if (mapped) return mapped;
      throw error;
    }
  });

  return route;
}

/** Open the skills service context bound to runtime registries. */
function withSkillsCtx<T>(runtime: WebRuntime, fn: (ctx: services.skills.SkillsServiceContext) => T): T {
  const registry = resolveRegistry(runtime);
  const ownsRegistry = !runtime.evolutionAssetRegistry;
  const manager = runtime.skillsManager
    ?? new SkillsManager({ root: buildHaroPaths(runtime.root).root, registry });
  const ownsManager = runtime.skillsManager === undefined;
  try {
    return fn({
      ...(runtime.root ? { root: runtime.root } : {}),
      ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
      logger: runtime.logger,
      skillsManager: manager,
      evolutionAssetRegistry: runtime.evolutionAssetRegistry === false ? false : registry,
      ...(runtime.skillAssetAuditSupported !== undefined
        ? { skillAssetAuditSupported: runtime.skillAssetAuditSupported }
        : {}),
    });
  } finally {
    if (ownsManager) manager.close();
    if (ownsRegistry) registry.close();
  }
}

function resolveRegistry(runtime: WebRuntime): EvolutionAssetRegistry {
  if (runtime.evolutionAssetRegistry) {
    return runtime.evolutionAssetRegistry;
  }
  return createEvolutionAssetRegistry({ ...(runtime.root ? { root: runtime.root } : {}) });
}

function mapSkillError(c: { json(value: unknown, status?: number): Response }, error: unknown): Response | null {
  if (!(error instanceof HaroError)) return null;
  if (error.code === 'SKILL_NOT_FOUND') return c.json({ error: error.message }, 404);
  if (error.code === 'SKILL_PREINSTALLED') return c.json({ error: error.message }, 403);
  if (error.code === 'SKILL_AUDIT_UNSUPPORTED') return c.json(unsupportedAuditPayload(error), 501);
  if (error.code === 'INVALID_INPUT') return c.json({ error: error.message }, 400);
  return null;
}

function filterSkills(items: readonly services.skills.SkillReadModel[], q: string): services.skills.SkillReadModel[] {
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

function sortSkills(
  items: readonly services.skills.SkillReadModel[],
  sort: SkillSortKey,
  order: 'asc' | 'desc',
): services.skills.SkillReadModel[] {
  return [...items].sort((left, right) => {
    const direction = order === 'asc' ? 1 : -1;
    const primary = compareSkill(left, right, sort) * direction;
    if (primary !== 0) return primary;
    return left.id.localeCompare(right.id) * direction;
  });
}

function compareSkill(
  left: services.skills.SkillReadModel,
  right: services.skills.SkillReadModel,
  sort: SkillSortKey,
): number {
  switch (sort) {
    case 'id': return left.id.localeCompare(right.id);
    case 'installedAt': return left.installedAt.localeCompare(right.installedAt);
    case 'lastUsedAt': return compareNullableString(left.lastUsedAt, right.lastUsedAt);
    case 'useCount': return left.useCount - right.useCount;
    case 'assetStatus': return left.assetStatus.localeCompare(right.assetStatus);
    case 'source': return left.source.localeCompare(right.source);
  }
}

function compareNullableString(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

async function parseJsonObject(c: { req: { json: () => Promise<unknown> } }): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }
> {
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
    ...(error ? { detail: error instanceof Error ? error.message : String(error) } : {}),
  };
}
