import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { buildHaroPaths } from '../paths.js';
import { EVOLUTION_ASSET_TABLES } from '../db/schema.js';
import {
  EVOLUTION_ASSET_CREATED_BY,
  EVOLUTION_ASSET_EVENT_ACTORS,
  EVOLUTION_ASSET_EVENT_TYPES,
  EVOLUTION_ASSET_KINDS,
  EVOLUTION_ASSET_STATUSES,
  type ExportEvolutionAssetManifestOptions,
  type EvolutionAsset,
  type EvolutionAssetCreatedBy,
  type EvolutionAssetDraft,
  type EvolutionAssetEvent,
  type EvolutionAssetEventActor,
  type EvolutionAssetEventType,
  type EvolutionAssetGepMetadata,
  type EvolutionAssetKind,
  type EvolutionAssetManifest,
  type EvolutionAssetRegistryOptions,
  type EvolutionAssetStatus,
  type EvolutionAssetWithEvents,
  type ListEvolutionAssetsQuery,
  type RecordEvolutionAssetEventInput,
  type ResolveEvolutionAssetByHashOptions,
} from './types.js';

interface EvolutionAssetRow {
  id: string;
  kind: EvolutionAssetKind;
  name: string;
  version: number;
  status: EvolutionAssetStatus;
  source_ref: string;
  content_ref: string;
  content_hash: string;
  created_by: EvolutionAssetCreatedBy;
  gep_json: string | null;
  created_at: string;
  updated_at: string;
}

interface EvolutionAssetEventRow {
  id: string;
  asset_id: string;
  type: EvolutionAssetEventType;
  actor: EvolutionAssetEventActor;
  evidence_refs_json: string;
  metadata_json: string | null;
  created_at: string;
}

interface AssetReadModelPatch {
  name: string;
  version: number;
  status: EvolutionAssetStatus;
  sourceRef: string;
  contentRef: string;
  contentHash: string;
  createdBy: EvolutionAssetCreatedBy;
  gep?: EvolutionAssetGepMetadata;
}

export function createEvolutionAssetRegistry(options: EvolutionAssetRegistryOptions = {}): EvolutionAssetRegistry {
  return new EvolutionAssetRegistry(options);
}

export function hashEvolutionAssetContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * FEAT-022 Evolution Asset Registry.
 *
 * The registry stores a mutable asset read model plus an append-only audit log.
 * Asset ids are lifecycle identities: callers may use stable ids such as
 * `skill:<id>` or let the registry generate a UUID-backed id. Content changes
 * advance `version` and update `contentHash`; previous hashes remain visible in
 * event metadata instead of becoming new identities.
 */
export class EvolutionAssetRegistry {
  private readonly db: Database.Database;
  private readonly now: () => Date;

  constructor(options: EvolutionAssetRegistryOptions = {}) {
    const paths = buildHaroPaths(options.root);
    const dbFile = options.dbFile ?? paths.dbFile;
    mkdirSync(dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.now = options.now ?? (() => new Date());
    this.ensureSchema();
  }

  listAssets(query: ListEvolutionAssetsQuery = {}): EvolutionAsset[] {
    const params: unknown[] = [];
    const where: string[] = [];
    const kinds = uniqueValues([...(query.kind ? [query.kind] : []), ...(query.kinds ?? [])]);
    if (kinds.length > 0) {
      kinds.forEach(assertKind);
      where.push(`kind IN (${placeholders(kinds)})`);
      params.push(...kinds);
    }
    const statuses = uniqueValues([...(query.status ? [query.status] : []), ...(query.statuses ?? [])]);
    if (statuses.length > 0) {
      statuses.forEach(assertStatus);
      where.push(`status IN (${placeholders(statuses)})`);
      params.push(...statuses);
    } else if (!query.includeArchived) {
      where.push(`status <> 'archived'`);
    }
    if (query.name) {
      where.push('name = ?');
      params.push(query.name);
    }
    if (query.contentHash) {
      where.push('content_hash = ?');
      params.push(query.contentHash);
    }
    if (query.sourceRef) {
      where.push('source_ref = ?');
      params.push(query.sourceRef);
    }
    if (query.createdBy) {
      assertCreatedBy(query.createdBy);
      where.push('created_by = ?');
      params.push(query.createdBy);
    }
    let sql = 'SELECT * FROM evolution_assets';
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY kind ASC, name ASC, updated_at DESC LIMIT ?';
    params.push(Math.max(query.limit ?? 100, 1));
    const rows = this.db.prepare(sql).all(...params) as EvolutionAssetRow[];
    return rows.map(rowToAsset);
  }

  getAsset(id: string, options: { includeEvents: true }): EvolutionAssetWithEvents | null;
  getAsset(id: string, options?: { includeEvents?: false }): EvolutionAsset | null;
  getAsset(id: string, options: { includeEvents?: boolean } = {}): EvolutionAsset | EvolutionAssetWithEvents | null {
    const asset = this.findAsset(id);
    if (!asset) return null;
    if (options.includeEvents === true) {
      return { ...asset, events: this.listEvents(id) };
    }
    return asset;
  }

  listEvents(assetId?: string): EvolutionAssetEvent[] {
    const rows = assetId
      ? (this.db
          .prepare('SELECT * FROM evolution_asset_events WHERE asset_id = ? ORDER BY created_at ASC, rowid ASC')
          .all(assetId) as EvolutionAssetEventRow[])
      : (this.db
          .prepare('SELECT * FROM evolution_asset_events ORDER BY created_at ASC, rowid ASC')
          .all() as EvolutionAssetEventRow[]);
    return rows.map(rowToEvent);
  }

  resolveByContentHash(contentHash: string, options: ResolveEvolutionAssetByHashOptions = {}): EvolutionAsset[] {
    if (!contentHash || contentHash.trim().length === 0) {
      throw new Error('EvolutionAssetRegistry.resolveByContentHash: contentHash is required');
    }
    const params: unknown[] = [contentHash];
    const where = ['content_hash = ?'];
    if (options.kind) {
      assertKind(options.kind);
      where.push('kind = ?');
      params.push(options.kind);
    }
    if (options.name) {
      where.push('name = ?');
      params.push(options.name);
    }
    if (options.statuses && options.statuses.length > 0) {
      options.statuses.forEach(assertStatus);
      where.push(`status IN (${placeholders(options.statuses)})`);
      params.push(...options.statuses);
    } else if (!options.includeArchived) {
      where.push(`status <> 'archived'`);
    }
    const rows = this.db
      .prepare(`SELECT * FROM evolution_assets WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id ASC`)
      .all(...params) as EvolutionAssetRow[];
    return rows.map(rowToAsset);
  }

  recordEvent(input: RecordEvolutionAssetEventInput): EvolutionAssetEvent {
    assertEventType(input.type);
    const actor = input.actor ?? 'agent';
    assertActor(actor);
    const evidenceRefs = input.evidenceRefs ?? [];
    const timestamp = this.now().toISOString();
    let written!: EvolutionAssetEvent;

    const tx = this.db.transaction(() => {
      const target = this.resolveRecordTarget(input, timestamp);
      written = this.insertEvent({
        assetId: target.asset.id,
        type: target.eventType,
        actor,
        evidenceRefs,
        metadata: enrichMetadata(input.metadata, target.before, target.after, target.reason),
        createdAt: timestamp,
      });
      if (target.shouldUpdateReadModel) {
        this.updateAssetReadModel(target.asset.id, target.after, timestamp);
      }
    });
    tx();
    return written;
  }

  exportManifest(options: ExportEvolutionAssetManifestOptions = {}): EvolutionAssetManifest {
    const { includeEvents = true, outputFile, ...query } = options;
    const exportedAt = this.now().toISOString();
    const assets = this.listAssets({ ...query, includeArchived: query.includeArchived ?? true, limit: query.limit ?? 10_000 });
    const assetIds = new Set(assets.map((asset) => asset.id));
    const manifest: EvolutionAssetManifest = {
      version: 1,
      exportedAt,
      assets,
    };
    if (includeEvents) {
      manifest.events = this.listEvents().filter((event) => assetIds.has(event.assetId));
    }
    if (outputFile) {
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    return manifest;
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec('BEGIN');
    try {
      for (const table of EVOLUTION_ASSET_TABLES) {
        this.db.exec(table.ddl);
        if (table.supportingDdl) {
          for (const ddl of table.supportingDdl) this.db.exec(ddl);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private resolveRecordTarget(input: RecordEvolutionAssetEventInput, timestamp: string): {
    asset: EvolutionAsset;
    before: EvolutionAsset | null;
    after: AssetReadModelPatch;
    eventType: EvolutionAssetEventType;
    shouldUpdateReadModel: boolean;
    reason?: string;
  } {
    const explicitId = input.assetId ?? input.asset?.id;
    const before = explicitId ? this.findAsset(explicitId) : null;
    if (!before && !input.asset) {
      throw new Error(`EvolutionAssetRegistry.recordEvent: unknown asset '${input.assetId ?? ''}' and no asset draft provided`);
    }

    if (!before && input.asset && input.type === 'proposed' && !input.asset.id) {
      const duplicate = this.resolveByContentHash(input.asset.contentHash, {
        kind: input.asset.kind,
        name: input.asset.name,
        includeArchived: true,
      })[0];
      if (duplicate) {
        const after = assetToPatch(duplicate);
        return {
          asset: duplicate,
          before: duplicate,
          after,
          eventType: 'conflict',
          shouldUpdateReadModel: false,
          reason: 'duplicate-contentHash-proposal',
        };
      }
    }

    const draft = input.asset && explicitId && !input.asset.id ? { ...input.asset, id: explicitId } : input.asset;
    const asset = before ?? this.insertAsset(draft!, input, timestamp);
    const after = buildPatch(asset, input);
    const versionShouldAdvance = before !== null && shouldAdvanceVersion(input.type, before.contentHash, after.contentHash);
    if (versionShouldAdvance) after.version = before.version + 1;
    if (input.status) after.status = input.status;
    else after.status = defaultStatusFor(input.type, before?.status ?? after.status);
    return {
      asset,
      before,
      after,
      eventType: input.type,
      shouldUpdateReadModel: before !== null || patchDiffers(asset, after),
    };
  }

  private insertAsset(draft: EvolutionAssetDraft, input: RecordEvolutionAssetEventInput, timestamp: string): EvolutionAsset {
    validateDraft(draft);
    const id = draft.id ?? generateAssetId(draft.kind, draft.name);
    const status = input.status ?? defaultStatusFor(input.type, draft.status ?? 'proposed');
    const version = Math.max(draft.version ?? 1, 1);
    this.db
      .prepare(
        `INSERT INTO evolution_assets (
          id,
          kind,
          name,
          version,
          status,
          source_ref,
          content_ref,
          content_hash,
          created_by,
          gep_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        draft.kind,
        draft.name,
        version,
        status,
        draft.sourceRef,
        draft.contentRef,
        draft.contentHash,
        input.createdBy ?? draft.createdBy,
        stringifyOptional(input.gep ?? draft.gep),
        timestamp,
        timestamp,
      );
    return {
      id,
      kind: draft.kind,
      name: draft.name,
      version,
      status,
      sourceRef: draft.sourceRef,
      contentRef: draft.contentRef,
      contentHash: draft.contentHash,
      createdBy: input.createdBy ?? draft.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.gep ?? draft.gep ? { gep: input.gep ?? draft.gep } : {}),
    };
  }

  private updateAssetReadModel(id: string, patch: AssetReadModelPatch, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE evolution_assets
            SET name = ?,
                version = ?,
                status = ?,
                source_ref = ?,
                content_ref = ?,
                content_hash = ?,
                created_by = ?,
                gep_json = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        patch.name,
        patch.version,
        patch.status,
        patch.sourceRef,
        patch.contentRef,
        patch.contentHash,
        patch.createdBy,
        stringifyOptional(patch.gep),
        updatedAt,
        id,
      );
  }

  private insertEvent(input: {
    assetId: string;
    type: EvolutionAssetEventType;
    actor: EvolutionAssetEventActor;
    evidenceRefs: readonly string[];
    metadata?: Record<string, unknown>;
    createdAt: string;
  }): EvolutionAssetEvent {
    const id = `asset_evt_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO evolution_asset_events (
          id,
          asset_id,
          type,
          actor,
          evidence_refs_json,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.assetId,
        input.type,
        input.actor,
        JSON.stringify(input.evidenceRefs),
        stringifyOptional(input.metadata),
        input.createdAt,
      );
    const event: EvolutionAssetEvent = {
      id,
      assetId: input.assetId,
      type: input.type,
      actor: input.actor,
      evidenceRefs: input.evidenceRefs,
      createdAt: input.createdAt,
    };
    if (input.metadata) event.metadata = input.metadata;
    return event;
  }

  private findAsset(id: string): EvolutionAsset | null {
    const row = this.db.prepare('SELECT * FROM evolution_assets WHERE id = ?').get(id) as EvolutionAssetRow | undefined;
    return row ? rowToAsset(row) : null;
  }
}

function buildPatch(asset: EvolutionAsset, input: RecordEvolutionAssetEventInput): AssetReadModelPatch {
  return {
    name: input.name ?? input.asset?.name ?? asset.name,
    version: input.asset?.version ?? asset.version,
    status: input.status ?? input.asset?.status ?? asset.status,
    sourceRef: input.sourceRef ?? input.asset?.sourceRef ?? asset.sourceRef,
    contentRef: input.contentRef ?? input.asset?.contentRef ?? asset.contentRef,
    contentHash: input.contentHash ?? input.asset?.contentHash ?? asset.contentHash,
    createdBy: input.createdBy ?? input.asset?.createdBy ?? asset.createdBy,
    gep: input.gep ?? input.asset?.gep ?? asset.gep,
  };
}

function assetToPatch(asset: EvolutionAsset): AssetReadModelPatch {
  return {
    name: asset.name,
    version: asset.version,
    status: asset.status,
    sourceRef: asset.sourceRef,
    contentRef: asset.contentRef,
    contentHash: asset.contentHash,
    createdBy: asset.createdBy,
    gep: asset.gep,
  };
}

function shouldAdvanceVersion(type: EvolutionAssetEventType, beforeHash: string, afterHash: string): boolean {
  if (type === 'promoted' || type === 'rollback') return true;
  if (type === 'modified') return beforeHash !== afterHash;
  return false;
}

function defaultStatusFor(type: EvolutionAssetEventType, current: EvolutionAssetStatus): EvolutionAssetStatus {
  switch (type) {
    case 'proposed':
      return 'proposed';
    case 'promoted':
    case 'enabled':
    case 'rollback':
      return 'active';
    case 'archived':
      return 'archived';
    case 'rejected':
      return 'rejected';
    case 'superseded':
      return 'superseded';
    case 'used':
    case 'modified':
    case 'disabled':
    case 'conflict':
      return current;
  }
}

function enrichMetadata(
  metadata: Record<string, unknown> | undefined,
  before: EvolutionAsset | null,
  after: AssetReadModelPatch,
  reason?: string,
): Record<string, unknown> | undefined {
  const enriched: Record<string, unknown> = {
    ...(metadata ?? {}),
    before: before
      ? {
          status: before.status,
          version: before.version,
          contentHash: before.contentHash,
          contentRef: before.contentRef,
        }
      : null,
    after: {
      status: after.status,
      version: after.version,
      contentHash: after.contentHash,
      contentRef: after.contentRef,
    },
  };
  if (reason) enriched.reason = reason;
  return enriched;
}

function patchDiffers(asset: EvolutionAsset, patch: AssetReadModelPatch): boolean {
  return (
    asset.name !== patch.name ||
    asset.version !== patch.version ||
    asset.status !== patch.status ||
    asset.sourceRef !== patch.sourceRef ||
    asset.contentRef !== patch.contentRef ||
    asset.contentHash !== patch.contentHash ||
    asset.createdBy !== patch.createdBy ||
    JSON.stringify(asset.gep ?? null) !== JSON.stringify(patch.gep ?? null)
  );
}

function rowToAsset(row: EvolutionAssetRow): EvolutionAsset {
  const asset: EvolutionAsset = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    version: row.version,
    status: row.status,
    sourceRef: row.source_ref,
    contentRef: row.content_ref,
    contentHash: row.content_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const gep = parseOptionalObject(row.gep_json) as EvolutionAssetGepMetadata | undefined;
  if (gep) asset.gep = gep;
  return asset;
}

function rowToEvent(row: EvolutionAssetEventRow): EvolutionAssetEvent {
  const event: EvolutionAssetEvent = {
    id: row.id,
    assetId: row.asset_id,
    type: row.type,
    actor: row.actor,
    evidenceRefs: parseStringArray(row.evidence_refs_json),
    createdAt: row.created_at,
  };
  const metadata = parseOptionalObject(row.metadata_json);
  if (metadata) event.metadata = metadata;
  return event;
}

function validateDraft(draft: EvolutionAssetDraft): void {
  assertKind(draft.kind);
  assertStatus(draft.status ?? 'proposed');
  assertCreatedBy(draft.createdBy);
  for (const [field, value] of [
    ['name', draft.name],
    ['sourceRef', draft.sourceRef],
    ['contentRef', draft.contentRef],
    ['contentHash', draft.contentHash],
  ] as const) {
    if (!value || value.trim().length === 0) {
      throw new Error(`EvolutionAssetRegistry.recordEvent: asset.${field} is required`);
    }
  }
}

function assertKind(value: string): asserts value is EvolutionAssetKind {
  if (!(EVOLUTION_ASSET_KINDS as readonly string[]).includes(value)) {
    throw new Error(`EvolutionAssetRegistry: unsupported asset kind '${value}'`);
  }
}

function assertStatus(value: string): asserts value is EvolutionAssetStatus {
  if (!(EVOLUTION_ASSET_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`EvolutionAssetRegistry: unsupported asset status '${value}'`);
  }
}

function assertEventType(value: string): asserts value is EvolutionAssetEventType {
  if (!(EVOLUTION_ASSET_EVENT_TYPES as readonly string[]).includes(value)) {
    throw new Error(`EvolutionAssetRegistry: unsupported event type '${value}'`);
  }
}

function assertActor(value: string): asserts value is EvolutionAssetEventActor {
  if (!(EVOLUTION_ASSET_EVENT_ACTORS as readonly string[]).includes(value)) {
    throw new Error(`EvolutionAssetRegistry: unsupported actor '${value}'`);
  }
}

function assertCreatedBy(value: string): asserts value is EvolutionAssetCreatedBy {
  if (!(EVOLUTION_ASSET_CREATED_BY as readonly string[]).includes(value)) {
    throw new Error(`EvolutionAssetRegistry: unsupported createdBy '${value}'`);
  }
}

function generateAssetId(kind: EvolutionAssetKind, name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset';
  return `${kind}:${safeName}:${randomUUID()}`;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function stringifyOptional(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseOptionalObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
