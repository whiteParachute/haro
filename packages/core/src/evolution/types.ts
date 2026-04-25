export const EVOLUTION_ASSET_KINDS = [
  'skill',
  'prompt',
  'routing-rule',
  'memory',
  'mcp',
  'archive',
] as const;

export const EVOLUTION_ASSET_STATUSES = [
  'proposed',
  'active',
  'archived',
  'rejected',
  'superseded',
] as const;

export const EVOLUTION_ASSET_EVENT_TYPES = [
  'proposed',
  'promoted',
  'used',
  'modified',
  'enabled',
  'disabled',
  'archived',
  'rollback',
  'rejected',
  'superseded',
  'conflict',
] as const;

export const EVOLUTION_ASSET_CREATED_BY = [
  'user',
  'agent',
  'eat',
  'shit',
  'migration',
] as const;

export const EVOLUTION_ASSET_EVENT_ACTORS = ['user', 'agent', 'system'] as const;

export type EvolutionAssetKind = (typeof EVOLUTION_ASSET_KINDS)[number];
export type EvolutionAssetStatus = (typeof EVOLUTION_ASSET_STATUSES)[number];
export type EvolutionAssetEventType = (typeof EVOLUTION_ASSET_EVENT_TYPES)[number];
export type EvolutionAssetCreatedBy = (typeof EVOLUTION_ASSET_CREATED_BY)[number];
export type EvolutionAssetEventActor = (typeof EVOLUTION_ASSET_EVENT_ACTORS)[number];

export interface EvolutionAssetGepMetadata {
  signalRef?: string;
  geneRef?: string;
  promptRef?: string;
  eventRef?: string;
}

export interface EvolutionAsset {
  id: string;
  kind: EvolutionAssetKind;
  name: string;
  version: number;
  status: EvolutionAssetStatus;
  sourceRef: string;
  contentRef: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  createdBy: EvolutionAssetCreatedBy;
  gep?: EvolutionAssetGepMetadata;
}

export interface EvolutionAssetEvent {
  id: string;
  assetId: string;
  type: EvolutionAssetEventType;
  actor: EvolutionAssetEventActor;
  evidenceRefs: readonly string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface EvolutionAssetWithEvents extends EvolutionAsset {
  events: readonly EvolutionAssetEvent[];
}

export interface EvolutionAssetDraft {
  id?: string;
  kind: EvolutionAssetKind;
  name: string;
  version?: number;
  status?: EvolutionAssetStatus;
  sourceRef: string;
  contentRef: string;
  contentHash: string;
  createdBy: EvolutionAssetCreatedBy;
  gep?: EvolutionAssetGepMetadata;
}

export interface RecordEvolutionAssetEventInput {
  /** Existing asset id. Required unless `asset` describes a new asset. */
  assetId?: string;
  /** New-asset draft, or current fields to materialize an unknown asset id. */
  asset?: EvolutionAssetDraft;
  type: EvolutionAssetEventType;
  actor?: EvolutionAssetEventActor;
  evidenceRefs?: readonly string[];
  metadata?: Record<string, unknown>;
  /** Optional read-model override applied with the event. */
  status?: EvolutionAssetStatus;
  name?: string;
  sourceRef?: string;
  contentRef?: string;
  contentHash?: string;
  createdBy?: EvolutionAssetCreatedBy;
  gep?: EvolutionAssetGepMetadata;
}

export interface ListEvolutionAssetsQuery {
  kind?: EvolutionAssetKind;
  kinds?: readonly EvolutionAssetKind[];
  status?: EvolutionAssetStatus;
  statuses?: readonly EvolutionAssetStatus[];
  name?: string;
  contentHash?: string;
  sourceRef?: string;
  createdBy?: EvolutionAssetCreatedBy;
  includeArchived?: boolean;
  limit?: number;
}

export interface ResolveEvolutionAssetByHashOptions {
  kind?: EvolutionAssetKind;
  name?: string;
  statuses?: readonly EvolutionAssetStatus[];
  includeArchived?: boolean;
}

export interface ExportEvolutionAssetManifestOptions extends ListEvolutionAssetsQuery {
  includeEvents?: boolean;
  outputFile?: string;
}

export interface EvolutionAssetManifest {
  version: 1;
  exportedAt: string;
  assets: readonly EvolutionAsset[];
  events?: readonly EvolutionAssetEvent[];
}

export interface EvolutionAssetRegistryOptions {
  root?: string;
  dbFile?: string;
  now?: () => Date;
}
