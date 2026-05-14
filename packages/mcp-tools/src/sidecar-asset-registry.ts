/**
 * Sidecar asset registry adapter (FEAT-046).
 *
 * This adapter stores AgentDock-facing Haro evolution assets under the sidecar
 * data directory (`$HARO_HOME/assets`) instead of the historical core
 * EvolutionAssetRegistry SQLite read model. It is intentionally file-backed for
 * the first sidecar slice so MCP `haro_asset_query` can run without importing
 * AgentDock internals or creating Haro-owned memory state.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AssetEventSchema,
  AssetKindSchema,
  AssetStatusSchema,
  IsoDateTimeSchema,
  RefSchema,
  RollbackMetadataSchema,
  type AssetEvent,
} from '@haro/agentdock-contract';

export const SidecarAssetManifestSchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  version: z.string().min(1),
  sourceRef: RefSchema,
  contentRef: RefSchema,
  contentHash: z.string().min(1),
  status: AssetStatusSchema,
  latestEventRef: RefSchema,
  proposalRef: RefSchema.optional(),
  validationRef: RefSchema.optional(),
  rollbackMetadata: RollbackMetadataSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type SidecarAssetManifest = z.infer<typeof SidecarAssetManifestSchema>;

export interface SidecarAssetQuery {
  kind?: z.infer<typeof AssetKindSchema>;
  status?: z.infer<typeof AssetStatusSchema>;
  query?: string;
  limit?: number;
}

export interface SidecarAssetRegistryOptions {
  root: string;
}

export class SidecarAssetRegistry {
  readonly root: string;
  readonly assetsDir: string;
  readonly manifestsDir: string;
  readonly eventsDir: string;

  constructor(options: SidecarAssetRegistryOptions) {
    this.root = options.root;
    this.assetsDir = join(options.root, 'assets');
    this.manifestsDir = join(this.assetsDir, 'manifests');
    this.eventsDir = join(this.assetsDir, 'events');
  }

  recordEvent(rawEvent: AssetEvent): {
    event: AssetEvent;
    manifest: SidecarAssetManifest;
    eventPath: string;
    manifestPath: string;
  } {
    const event = AssetEventSchema.parse(rawEvent);
    const eventPath = this.eventPath(event);
    const manifestPath = this.manifestPath(event.assetId);
    const existingManifest = this.readManifest(event.assetId);
    const shouldUpdateManifest = !existingManifest ||
      Date.parse(event.createdAt) >= Date.parse(existingManifest.updatedAt);
    const manifest = shouldUpdateManifest
      ? SidecarAssetManifestSchema.parse({
          id: event.assetId,
          kind: event.kind,
          version: event.version,
          sourceRef: event.sourceRef,
          contentRef: event.contentRef,
          contentHash: event.contentHash,
          status: event.status,
          latestEventRef: {
            id: event.id,
            kind: 'asset-event',
            uri: `haro-sidecar://assets/events/${encodeURIComponent(event.id)}`,
          },
          ...(event.proposalRef ? { proposalRef: event.proposalRef } : {}),
          ...(event.validationRef ? { validationRef: event.validationRef } : {}),
          ...(event.rollbackMetadata ? { rollbackMetadata: event.rollbackMetadata } : {}),
          createdAt: existingManifest?.createdAt ?? event.createdAt,
          updatedAt: event.createdAt,
        })
      : existingManifest;

    writeJsonFile(eventPath, event);
    if (shouldUpdateManifest) writeJsonFile(manifestPath, manifest);
    return { event, manifest, eventPath, manifestPath };
  }

  query(params: SidecarAssetQuery = {}): AssetEvent[] {
    const limit = params.limit ?? 100;
    const eventsById = new Map(this.listEvents().map((event) => [event.id, event]));
    const latestEvents = this.listManifests()
      .map((manifest) => eventsById.get(manifest.latestEventRef.id) ?? manifestToEvent(manifest))
      .filter((event) => (params.kind ? event.kind === params.kind : true))
      .filter((event) => (params.status ? event.status === params.status : true))
      .filter((event) => (params.query ? eventMatchesText(event, params.query) : true))
      .sort(compareAssetEventsDesc);
    return latestEvents.slice(0, limit);
  }

  listEvents(): AssetEvent[] {
    if (!existsSync(this.eventsDir)) return [];
    const events: AssetEvent[] = [];
    for (const name of readdirSync(this.eventsDir).sort()) {
      if (!name.endsWith('.json')) continue;
      try {
        events.push(AssetEventSchema.parse(JSON.parse(readFileSync(join(this.eventsDir, name), 'utf8'))));
      } catch {
        // Corrupt event files are intentionally ignored by the query adapter.
        // Doctor/status can grow explicit corrupt-file reporting later without
        // making read-only MCP calls fail closed on a single bad artifact.
      }
    }
    return events;
  }

  listManifests(): SidecarAssetManifest[] {
    if (!existsSync(this.manifestsDir)) return [];
    const manifests: SidecarAssetManifest[] = [];
    for (const name of readdirSync(this.manifestsDir).sort()) {
      if (!name.endsWith('.json')) continue;
      try {
        manifests.push(SidecarAssetManifestSchema.parse(JSON.parse(readFileSync(join(this.manifestsDir, name), 'utf8'))));
      } catch {
        // Keep read-only query resilient to a single corrupt manifest.
      }
    }
    return manifests;
  }

  readManifest(assetId: string): SidecarAssetManifest | undefined {
    const path = this.manifestPath(assetId);
    if (!existsSync(path)) return undefined;
    return SidecarAssetManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }

  manifestPath(assetId: string): string {
    return join(this.manifestsDir, `${encodedPathSegment(assetId)}.json`);
  }

  eventPath(event: AssetEvent): string {
    return join(
      this.eventsDir,
      `${safePathSegment(event.createdAt)}-${encodedPathSegment(event.assetId)}-${encodedPathSegment(event.id)}.json`,
    );
  }
}

export function createSidecarAssetRegistry(root: string): SidecarAssetRegistry {
  return new SidecarAssetRegistry({ root });
}

function manifestToEvent(manifest: SidecarAssetManifest): AssetEvent {
  return AssetEventSchema.parse({
    id: manifest.latestEventRef.id,
    assetId: manifest.id,
    kind: manifest.kind,
    version: manifest.version,
    sourceRef: manifest.sourceRef,
    contentRef: manifest.contentRef,
    contentHash: manifest.contentHash,
    status: manifest.status,
    eventType: eventTypeForStatus(manifest.status),
    actor: 'haro',
    ...(manifest.proposalRef ? { proposalRef: manifest.proposalRef } : {}),
    ...(manifest.validationRef ? { validationRef: manifest.validationRef } : {}),
    ...(manifest.rollbackMetadata ? { rollbackMetadata: manifest.rollbackMetadata } : {}),
    createdAt: manifest.updatedAt,
  });
}

function eventTypeForStatus(status: SidecarAssetManifest['status']): AssetEvent['eventType'] {
  switch (status) {
    case 'proposed':
    case 'validated':
    case 'applied':
    case 'rolled-back':
    case 'archived':
    case 'rejected':
    case 'superseded':
      return status;
  }
}

function eventMatchesText(event: AssetEvent, query: string): boolean {
  return eventSearchText(event).toLowerCase().includes(query.toLowerCase());
}

function eventSearchText(event: AssetEvent): string {
  return [
    event.id,
    event.assetId,
    event.kind,
    event.version,
    event.contentHash,
    event.status,
    event.eventType,
    event.actor,
    ...refSearchFields(event.sourceRef),
    ...refSearchFields(event.contentRef),
    ...(event.proposalRef ? refSearchFields(event.proposalRef) : []),
    ...(event.validationRef ? refSearchFields(event.validationRef) : []),
    ...(event.rollbackMetadata?.rollbackRef ? refSearchFields(event.rollbackMetadata.rollbackRef) : []),
    ...(event.rollbackMetadata?.snapshotRef ? refSearchFields(event.rollbackMetadata.snapshotRef) : []),
  ].join('\n');
}

function refSearchFields(ref: z.infer<typeof RefSchema>): string[] {
  return [ref.id, ref.kind, ref.uri ?? ''];
}

function compareAssetEventsDesc(a: AssetEvent, b: AssetEvent): number {
  const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byDate !== 0) return byDate;
  return a.id.localeCompare(b.id);
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function encodedPathSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}
