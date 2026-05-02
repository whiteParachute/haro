/**
 * Skills service (FEAT-039 R9 + FEAT-022 evolution registry).
 *
 * Lives in core but accepts a pre-constructed `SkillsManager` (from
 * `@haro/skills`) and `EvolutionAssetRegistry` from the caller —
 * `@haro/skills` already depends on `@haro/core`, so to avoid a circular
 * runtime dep we don't import skills here; we duck-type the manager via
 * the minimal interface the service actually exercises.
 */

import {
  createEvolutionAssetRegistry,
  type EvolutionAsset,
  type EvolutionAssetEvent,
  type EvolutionAssetRegistry,
  type EvolutionAssetStatus,
  type EvolutionAssetWithEvents,
} from '../evolution/index.js';
import { HaroError } from '../errors/index.js';
import type { ServiceContext } from './types.js';

// Minimal subset of `SkillManifestEntry` (from @haro/skills) used here.
// `source` is opaque to keep this in lockstep with `SkillSourceKind`
// without re-importing it (avoids circular runtime dep).
export interface SkillManifestEntryShape {
  id: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  isPreinstalled: boolean;
  originalSource: string;
  pinnedCommit: string;
  license: string;
  description?: string;
}

// Minimal subset of `SkillsManager` API the service exercises.
export interface SkillsManagerShape {
  list(): SkillManifestEntryShape[];
  info(id: string): SkillManifestEntryShape & { descriptor: SkillDescriptorReadModel };
  enable(id: string): SkillManifestEntryShape;
  disable(id: string): SkillManifestEntryShape;
  install(source: string): SkillManifestEntryShape;
  uninstall(id: string): SkillManifestEntryShape;
  getUsage(id: string): { useCount: number; lastUsedAt?: string } | undefined;
  ensureInitialized(): void;
}

export interface SkillReadModel {
  id: string;
  source: SkillManifestEntryShape['source'];
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

export interface SkillDescriptorReadModel {
  id: string;
  description: string;
  content: string;
}

export interface SkillDetailReadModel extends SkillReadModel {
  descriptor: SkillDescriptorReadModel;
  asset?: EvolutionAssetWithEvents;
}

export interface SkillMutationReadModel {
  skill: SkillReadModel;
  audit?: {
    asset?: EvolutionAsset | EvolutionAssetWithEvents;
    event?: EvolutionAssetEvent;
    status: 'recorded' | 'missing';
  };
}

export interface SkillsServiceContext extends ServiceContext {
  /** Required: pre-constructed manager from @haro/skills. */
  skillsManager: SkillsManagerShape;
  /** Optional registry; `false` means audit recording is disabled. */
  evolutionAssetRegistry?: EvolutionAssetRegistry | false;
  /** Whether the host platform supports asset audit (FEAT-022). */
  skillAssetAuditSupported?: boolean;
}

/**
 * Run `fn(manager, registry)` ensuring the manager is initialised. Owns
 * a freshly-created registry; closes it on the way out.
 */
export function withSkills<T>(
  ctx: SkillsServiceContext,
  fn: (manager: SkillsManagerShape, registry: EvolutionAssetRegistry) => T,
): T {
  const registry = resolveRegistry(ctx);
  const ownsRegistry = ctx.evolutionAssetRegistry === undefined;
  try {
    ctx.skillsManager.ensureInitialized();
    return fn(ctx.skillsManager, registry);
  } finally {
    if (ownsRegistry) registry.close();
  }
}

export function listSkills(ctx: SkillsServiceContext): SkillReadModel[] {
  return withSkills(ctx, (manager, registry) =>
    manager.list().map((entry) => summarizeSkill(entry, manager, registry)),
  );
}

export function getSkillDetail(ctx: SkillsServiceContext, id: string): SkillDetailReadModel {
  return withSkills(ctx, (manager, registry) => {
    try {
      const info = manager.info(id);
      return detailSkill(info, manager, registry);
    } catch (error) {
      throw new HaroError('SKILL_NOT_FOUND', errorMessage(error), {
        remediation: 'Run `haro skills list` to see installed skills',
      });
    }
  });
}

export function enableSkill(ctx: SkillsServiceContext, id: string): SkillMutationReadModel {
  return withSkills(ctx, (manager, registry) => {
    const result = mutateSkill(() => manager.enable(id), manager, registry, id);
    if (!result.ok) throw skillMutationError(result, id);
    return result.value;
  });
}

export function disableSkill(ctx: SkillsServiceContext, id: string): SkillMutationReadModel {
  return withSkills(ctx, (manager, registry) => {
    const result = mutateSkill(() => manager.disable(id), manager, registry, id);
    if (!result.ok) throw skillMutationError(result, id);
    return result.value;
  });
}

export function installSkill(ctx: SkillsServiceContext, source: string): SkillMutationReadModel {
  ensureAssetAuditSupported(ctx);
  return withSkills(ctx, (manager, registry) => {
    const result = mutateSkill(() => manager.install(source), manager, registry);
    if (!result.ok) throw skillMutationError(result);
    return result.value;
  });
}

export function uninstallSkill(ctx: SkillsServiceContext, id: string): SkillMutationReadModel {
  ensureAssetAuditSupported(ctx);
  return withSkills(ctx, (manager, registry) => {
    const entry = manager.list().find((item) => item.id === id);
    if (!entry) throw new HaroError('SKILL_NOT_FOUND', `Skill '${id}' not installed`);
    if (entry.isPreinstalled) {
      throw new HaroError('SKILL_PREINSTALLED', 'Preinstalled skills cannot be uninstalled');
    }
    const beforeEvents = registry.listEvents(skillAssetId(id)).length;
    try {
      const removed = manager.uninstall(id);
      const afterEvents = registry.listEvents(skillAssetId(id)).length;
      const audit = readLatestAudit(registry, removed.id, afterEvents > beforeEvents);
      return {
        skill: { ...summarizeEntryAfterUninstall(removed, registry), enabled: false },
        ...(audit ? { audit } : {}),
      };
    } catch (error) {
      throw new HaroError('INVALID_INPUT', errorMessage(error));
    }
  });
}

export function getSkillUsageEvents(ctx: SkillsServiceContext, id: string): EvolutionAssetEvent[] {
  return withSkills(ctx, (_manager, registry) => registry.listEvents(skillAssetId(id)));
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function ensureAssetAuditSupported(ctx: SkillsServiceContext): void {
  if (ctx.skillAssetAuditSupported === false || ctx.evolutionAssetRegistry === false) {
    throw new HaroError(
      'SKILL_AUDIT_UNSUPPORTED',
      'Skill install/uninstall requires Evolution Asset Registry audit support',
      { remediation: 'Run on a platform with SQLite write access; check `haro doctor`' },
    );
  }
}

function resolveRegistry(ctx: SkillsServiceContext): EvolutionAssetRegistry {
  if (ctx.evolutionAssetRegistry) return ctx.evolutionAssetRegistry;
  return createEvolutionAssetRegistry({ ...(ctx.root ? { root: ctx.root } : {}) });
}

export function summarizeSkill(
  entry: SkillManifestEntryShape,
  manager: SkillsManagerShape,
  registry: EvolutionAssetRegistry,
): SkillReadModel {
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
  info: SkillManifestEntryShape & { descriptor: SkillDescriptorReadModel },
  manager: SkillsManagerShape,
  registry: EvolutionAssetRegistry,
): SkillDetailReadModel {
  const asset = registry.getAsset(skillAssetId(info.id), { includeEvents: true });
  return {
    ...summarizeSkill(info, manager, registry),
    descriptor: info.descriptor,
    ...(asset ? { asset } : {}),
  };
}

function summarizeEntryAfterUninstall(
  entry: SkillManifestEntryShape,
  registry: EvolutionAssetRegistry,
): SkillReadModel {
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
    ...(entry.description ? { description: entry.description } : {}),
    assetStatus: asset?.status ?? 'archived',
    assetRef: skillAssetId(entry.id),
    useCount: 0,
  };
}

interface MutationOk {
  ok: true;
  value: SkillMutationReadModel;
}
interface MutationErr {
  ok: false;
  status: 400 | 404;
  error: string;
}

function mutateSkill(
  action: () => SkillManifestEntryShape,
  manager: SkillsManagerShape,
  registry: EvolutionAssetRegistry,
  knownSkillId?: string,
): MutationOk | MutationErr {
  try {
    const beforeEvents = knownSkillId
      ? registry.listEvents(skillAssetId(knownSkillId)).length
      : registry.listEvents().length;
    const entry = action();
    const afterEvents = knownSkillId
      ? registry.listEvents(skillAssetId(entry.id)).length
      : registry.listEvents().length;
    const audit = readLatestAudit(registry, entry.id, afterEvents > beforeEvents);
    return {
      ok: true,
      value: {
        skill: summarizeSkill(entry, manager, registry),
        ...(audit ? { audit } : {}),
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    return { ok: false, status: message.includes('not installed') ? 404 : 400, error: message };
  }
}

function readLatestAudit(
  registry: EvolutionAssetRegistry,
  skillId: string,
  didRecord: boolean,
): SkillMutationReadModel['audit'] {
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

function skillMutationError(result: MutationErr, id?: string): HaroError {
  if (result.status === 404) {
    return new HaroError('SKILL_NOT_FOUND', result.error, {
      ...(id ? { remediation: `Run \`haro skills install <source>\` to install '${id}'` } : {}),
    });
  }
  return new HaroError('INVALID_INPUT', result.error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skillAssetId(skillId: string): string {
  return `skill:${skillId}`;
}

export function isAssetAuditUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('EvolutionAssetRegistry') ||
    error.message.includes('better-sqlite3') ||
    error.message.includes('SQLITE') ||
    error.message.includes('read-only file system') ||
    error.message.includes('EROFS')
  );
}
