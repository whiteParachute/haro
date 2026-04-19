/**
 * Public types for FEAT-007 Memory Fabric. The public surface is intentionally
 * small: spec §4 forbids callers from reading the memory directory directly
 * (R11), so any consumer-facing abstraction must route through these types.
 */

export type MemoryScope = 'platform' | 'agent' | 'shared';

export type MemorySource = string;

export interface MemoryWriteInput {
  scope: MemoryScope;
  /** Required when scope === 'agent'. */
  agentId?: string;
  /** Target knowledge topic (stored as `knowledge/<topic>.md`). */
  topic: string;
  content: string;
  /**
   * Optional summary (shown in index.md). Defaults to the first line of
   * `content`. The summary is truncated for the index display.
   */
  summary?: string;
  tags?: readonly string[];
  source?: MemorySource;
}

export interface MemoryDepositInput {
  scope: MemoryScope;
  agentId?: string;
  content: string;
  summary?: string;
  tags?: readonly string[];
  source: MemorySource;
  /**
   * Groups deposits that belong to the same agent/session wrapup. Required for
   * the multi-endpoint merge logic (R5).
   */
  wrapupId: string;
  /**
   * Optional grouping key used when memory-sleep merges pending deposits into
   * knowledge files. Callers that know the topic in advance should pass it
   * explicitly — otherwise we fall back to a summary-derived slug which can
   * alias across prefix-sharing topics (see FEAT-007 §5.4 and codex review).
   */
  topic?: string;
}

export interface MemoryQueryInput {
  scope?: MemoryScope;
  agentId?: string;
  query: string;
  limit?: number;
  /** When true, also scan impressions/archived. Defaults to false (R1 §4). */
  includeArchived?: boolean;
}

export interface MemoryQueryHit {
  /** Matched memory record (truncated where sensible). */
  content: string;
  summary: string;
  source: MemorySource;
  /** File path (index / impressions / knowledge / pending / session). */
  sourceFile: string;
  /** Path tier that produced the hit (used by `contextFor` ranking). */
  tier: 'session' | 'index' | 'impressions' | 'knowledge' | 'pending' | 'archived';
  /** ISO date (YYYY-MM-DD) of the record when available. */
  date?: string;
  tags?: readonly string[];
  /** Simple keyword score (count of query terms appearing in content). */
  score: number;
}

export interface MemoryQueryResult {
  hits: readonly MemoryQueryHit[];
  /** Indicates whether the query was served entirely from the in-memory
   *  index (i.e. fully served by R4 "same-session injection"). */
  servedFromIndex: boolean;
}

export interface MemoryContextInput {
  agentId: string;
  query: string;
  limit?: number;
}

export interface MemoryContextItem {
  summary: string;
  source: string;
  sourceFile: string;
  date?: string;
  tier: MemoryQueryHit['tier'];
}

export interface MemoryContextResult {
  items: readonly MemoryContextItem[];
}

export interface MemoryWrapupInput {
  scope: MemoryScope;
  agentId?: string;
  wrapupId: string;
  topic: string;
  transcript: string;
  summary?: string;
  tags?: readonly string[];
  source?: MemorySource;
  /**
   * When true, also triggers a lightweight pending merge for this wrapup's
   * deposits (see R3 T3). Defaults to true.
   */
  mergePending?: boolean;
}

export interface MemoryStats {
  root: string;
  scopes: readonly MemoryScopeStats[];
  lastMaintenanceAt?: string;
}

export interface MemoryScopeStats {
  scope: MemoryScope;
  agentId?: string;
  knowledgeCount: number;
  impressionCount: number;
  pendingCount: number;
  indexEntries: number;
}

export interface MemoryMaintenanceStepReport {
  step: string;
  status: 'ok' | 'skipped' | 'error';
  detail?: string;
}

export interface MemoryMaintenanceReport {
  scope: MemoryScope;
  agentId?: string;
  steps: readonly MemoryMaintenanceStepReport[];
  ranAt: string;
  changelogEntry: string;
}
