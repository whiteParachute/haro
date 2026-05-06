/**
 * FEAT-035 Memory Fabric v2 — file-backed entry store.
 *
 * Replaces the v1 SQLite read model (memory_entries / memory_entries_fts).
 * All authoritative state lives in scope-rooted Markdown files:
 *
 *   <root>/<scope-dir>/knowledge/<slug>.md         persistent / skill
 *   <root>/<scope-dir>/impressions/<date>_slug.md  session (post-wrapup)
 *   <root>/<scope-dir>/knowledge/.pending/*.md     session (deposit)
 *
 * Each file carries a YAML frontmatter that doubles as the entry record. We
 * hydrate an in-memory `Map<id, MemoryEntry>` lazily per scope and run all
 * filters in JS — D1 (no FTS / no vector) and D4 (≤ 1000 files / scope, sleep
 * compresses beyond that). MEMORY.md / index.md is human-facing only; we do
 * not parse it for queries.
 *
 * The store keeps the public surface of v1 `MemoryReadModel` so MemoryFabric
 * can swap implementations without touching callers (R4 keep API).
 */

import { existsSync, readFileSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { atomicWriteFile, ensureDir } from './atomic-io.js';
import { hashContent, tokenize } from './index-store.js';
import {
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from './frontmatter.js';
import { buildEntryScopeLayout, resolveEntryScopeRoot } from './paths.js';
import type {
  MemoryEntry,
  MemoryEntryScope,
  MemoryLayer,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  VerificationStatus,
} from './types.js';

const STATUS_ORDER: Record<VerificationStatus, number> = {
  verified: 0,
  unverified: 1,
  conflicted: 2,
  rejected: 9,
};

const LAYER_ORDER: Record<MemoryLayer, number> = {
  persistent: 0,
  skill: 1,
  session: 2,
};

/** Tier hint we pull off the on-disk path so we know which layer the file represents. */
type FileTier = 'knowledge' | 'impression' | 'pending' | 'archived';

interface FileEntryMeta {
  /** Absolute path to the file we hydrated this entry from. */
  file: string;
  /** Path-derived tier — used to decide layer when frontmatter omits it. */
  tier: FileTier;
  /**
   * True when this entry was hydrated from a file whose frontmatter is
   * "sparse" — missing the canonical FEAT-035 fields (`id`, `layer`, `scope`).
   * Such entries are produced by legacy `write()`/`deposit()` paths or by an
   * external aria-memory tool that didn't yet adopt the v2 schema. We use
   * this bit to decide whether `evictByFile` may drop the entry on a
   * legitimate same-path writeEntry (sparse: yes; canonical: no).
   */
  sparse: boolean;
}

/**
 * Canonical fields produced by frontmatterFromEntry. We use this list to
 * preserve unknown frontmatter (e.g. wrapup_id / hash / topic_slug emitted
 * by legacy deposit()) when rewriting a file's frontmatter.
 */
const CANONICAL_FRONTMATTER_FIELDS: readonly string[] = [
  'id',
  'topic',
  'summary',
  'layer',
  'scope',
  'source_ref',
  'content_hash',
  'verification_status',
  'tags',
  'created_at',
  'updated_at',
  'date',
  'agent_id',
  'asset_ref',
  'confidence',
  'verification_evidence_refs',
  'archived_at',
  'archived_reason',
];

export interface SearchMemoryFilesOptions {
  scopes?: readonly MemoryEntryScope[];
  agentId?: string;
  layer?: MemoryLayer | readonly MemoryLayer[];
  type?: MemoryFileType | readonly MemoryFileType[];
  verificationStatus?: VerificationStatus | readonly VerificationStatus[];
  since?: string;
  limit?: number;
  includeArchived?: boolean;
}

/** FEAT-035 R2: aria-memory style entry types — orthogonal to layer/scope. */
export type MemoryFileType = 'user' | 'feedback' | 'project' | 'reference';

const VALID_TYPES = new Set<MemoryFileType>(['user', 'feedback', 'project', 'reference']);

export class MemoryFileStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly meta = new Map<string, FileEntryMeta>();
  /** Tracks which scope directories we've already scanned to avoid re-hydration. */
  private readonly hydratedScopes = new Set<string>();

  constructor(private readonly root: string) {
    ensureDir(this.root);
  }

  close(): void {
    /* no-op: file store has no persistent connection. */
  }

  // ----- v1 ReadModel-compatible read API -----

  findById(id: string): MemoryEntry | null {
    this.hydrateAll();
    return this.entries.get(id) ?? null;
  }

  findByContentHash(layer: MemoryLayer, scope: MemoryEntryScope, contentHash: string): MemoryEntry | null {
    this.hydrateScope(scope);
    for (const entry of this.entries.values()) {
      if (entry.layer === layer && entry.scope === scope && entry.contentHash === contentHash) {
        return entry;
      }
    }
    return null;
  }

  findTopicConflicts(input: {
    layer: MemoryLayer;
    scope: MemoryEntryScope;
    topic: string;
    contentHash: string;
  }): MemoryEntry[] {
    this.hydrateScope(input.scope);
    const out: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.layer !== input.layer) continue;
      if (entry.scope !== input.scope) continue;
      if (entry.topic !== input.topic) continue;
      if (entry.contentHash === input.contentHash) continue;
      if (entry.archivedAt) continue;
      if (entry.verificationStatus === 'rejected') continue;
      out.push(entry);
    }
    return out;
  }

  /**
   * Insert is in-memory only; the canonical file is written by MemoryFabric.
   *
   * If a different entry id is already pointing at the same file (e.g. a
   * legacy `write()` produced a sparse-frontmatter copy that hydration
   * picked up under a derived id), drop it — the incoming entry is the
   * canonical record for that path and we must not let the duplicate trip
   * the topic-conflict path on the next writeEntry.
   */
  insert(entry: MemoryEntry, file: string): MemoryEntry {
    if (file) this.dropSparseEntriesAtFile(file, entry.id);
    this.entries.set(entry.id, entry);
    this.meta.set(entry.id, { file, tier: tierFromFile(file), sparse: false });
    return entry;
  }

  /** Drop entries hydrated from `file` whose meta.sparse is true (codex MUST-FIX #4). */
  private dropSparseEntriesAtFile(file: string, keepId: string): void {
    for (const [otherId, otherMeta] of Array.from(this.meta.entries())) {
      if (otherId === keepId) continue;
      if (otherMeta.file !== file) continue;
      if (!otherMeta.sparse) continue;
      this.entries.delete(otherId);
      this.meta.delete(otherId);
    }
  }

  /**
   * Public form used by writeEntry pre-conflict eviction. Only drops *sparse*
   * ghost hydrations (entries whose source file lacked canonical frontmatter)
   * so legitimate same-path different-content rewrites still surface as topic
   * conflicts (codex MUST-FIX #4).
   */
  evictByFile(file: string): void {
    if (!file) return;
    this.dropSparseEntriesAtFile(file, '');
  }

  /** Replace an existing in-memory entry (e.g. after rewriting its file). */
  upsert(entry: MemoryEntry, file: string): MemoryEntry {
    this.entries.set(entry.id, entry);
    this.meta.set(entry.id, { file, tier: tierFromFile(file), sparse: false });
    return entry;
  }

  attachAssetRef(id: string, assetRef: string, updatedAt: string): MemoryEntry {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`MemoryFabric.writeEntry: unknown entry id '${id}'`);
    }
    const next: MemoryEntry = { ...existing, assetRef, updatedAt };
    this.entries.set(id, next);
    this.rewriteFileFrontmatter(id);
    return next;
  }

  markConflicted(ids: readonly string[], evidenceRefs: readonly string[], updatedAt: string): void {
    for (const id of ids) {
      const existing = this.entries.get(id);
      if (!existing) continue;
      if (existing.verificationStatus === 'rejected') continue;
      const next: MemoryEntry = {
        ...existing,
        verificationStatus: 'conflicted',
        verificationEvidenceRefs: [...evidenceRefs],
        updatedAt,
      };
      this.entries.set(id, next);
      this.rewriteFileFrontmatter(id);
    }
  }

  markVerification(
    id: string,
    status: VerificationStatus,
    evidenceRefs: readonly string[],
    updatedAt: string,
  ): MemoryEntry {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`MemoryFabric.markVerification: unknown entry id '${id}'`);
    }
    const next: MemoryEntry = {
      ...existing,
      verificationStatus: status,
      verificationEvidenceRefs: [...evidenceRefs],
      updatedAt,
    };
    this.entries.set(id, next);
    this.rewriteFileFrontmatter(id);
    return next;
  }

  archive(id: string, reason: string, archivedAt: string): MemoryEntry {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`MemoryFabric.archiveEntry: unknown entry id '${id}'`);
    }
    const next: MemoryEntry = {
      ...existing,
      archivedAt,
      archivedReason: reason,
      updatedAt: archivedAt,
    };
    this.entries.set(id, next);
    this.rewriteFileFrontmatter(id);
    return next;
  }

  query(query: MemoryQuery): MemorySearchResult[] {
    const limit = Math.max(query.limit ?? 20, 1);
    const scopeHints = collectScopes(query);
    if (scopeHints.length === 0) {
      this.hydrateAll();
    } else {
      for (const scope of scopeHints) this.hydrateScope(scope);
    }

    const keyword = (query.keyword ?? query.query ?? '').trim();
    const tokens = keyword.length > 0 ? tokenize(keyword.toLowerCase()) : [];
    const matched: Array<{ entry: MemoryEntry; score: number; matched: string[] }> = [];

    for (const entry of this.entries.values()) {
      if (!filterEntry(entry, query)) continue;
      const matchInfo = scoreEntry(entry, tokens, query);
      if (tokens.length > 0 && matchInfo.keywordHits === 0) continue;
      matched.push({ entry, score: matchInfo.score, matched: matchInfo.matchedBy });
    }

    matched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
    });

    const sliced = matched.slice(0, limit);
    return sliced.map((item, index) => ({
      entry: item.entry,
      score: item.score,
      rank: index + 1,
      matchedBy: item.matched,
    }));
  }

  search(query: string, options: SearchMemoryFilesOptions = {}): MemorySearchResult[] {
    return this.query({
      keyword: query,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.layer ? { layer: options.layer } : {}),
      ...(options.verificationStatus ? { verificationStatus: options.verificationStatus } : {}),
      ...(options.since ? { since: options.since } : {}),
      includeArchived: options.includeArchived ?? false,
      limit: options.limit ?? 50,
    }).filter((result) => {
      if (!options.type) return true;
      const target = result.entry;
      const tagType = inferTypeFromEntry(target);
      const allowed = Array.isArray(options.type) ? options.type : [options.type as MemoryFileType];
      return allowed.includes(tagType);
    });
  }

  stats(): Pick<MemoryStats, 'totalEntries' | 'archivedEntries' | 'byLayer' | 'byScope' | 'byVerificationStatus'> {
    this.hydrateAll();
    const byLayer: Record<MemoryLayer, number> = { session: 0, persistent: 0, skill: 0 };
    const byScope: Record<string, number> = {};
    const byStatus: Record<VerificationStatus, number> = {
      unverified: 0,
      verified: 0,
      conflicted: 0,
      rejected: 0,
    };
    let total = 0;
    let archived = 0;
    for (const entry of this.entries.values()) {
      total += 1;
      if (entry.archivedAt) archived += 1;
      byLayer[entry.layer] += 1;
      byScope[entry.scope] = (byScope[entry.scope] ?? 0) + 1;
      byStatus[entry.verificationStatus] += 1;
    }
    return {
      totalEntries: total,
      archivedEntries: archived,
      byLayer,
      byScope,
      byVerificationStatus: byStatus,
    };
  }

  /** Drop hydration cache so callers can force a re-scan (used by repair/migrate). */
  reset(): void {
    this.entries.clear();
    this.meta.clear();
    this.hydratedScopes.clear();
  }

  /** Public: ensure every scope under root is hydrated. */
  hydrateAll(): void {
    const allScopes = enumerateScopes(this.root);
    for (const scope of allScopes) this.hydrateScope(scope);
  }

  /** Public: hydrate a single scope (idempotent). */
  hydrateScope(scope: MemoryEntryScope): void {
    if (this.hydratedScopes.has(scope)) return;
    this.hydratedScopes.add(scope);
    let scopeRoot: string;
    try {
      scopeRoot = resolveEntryScopeRoot(this.root, scope);
    } catch {
      return;
    }
    if (!existsSync(scopeRoot)) return;
    const layout = buildEntryScopeLayout(this.root, scope);
    this.scanDir(layout.knowledge, scope, 'knowledge');
    this.scanDir(layout.impressions, scope, 'impression');
    this.scanDir(layout.impressionsArchived, scope, 'archived');
    this.scanDir(layout.pending, scope, 'pending');
  }

  /** Public: rebuild MEMORY.md / index.md for a given scope. R6 atomicity. */
  rewriteIndex(scope: MemoryEntryScope, lastSleepAt: string | null = null): void {
    this.hydrateScope(scope);
    const layout = buildEntryScopeLayout(this.root, scope);
    const entries = Array.from(this.entries.values()).filter((entry) => entry.scope === scope);
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const lines: string[] = ['# 随身索引', ''];
    if (lastSleepAt) lines.push(`<!-- last-sleep-at: ${lastSleepAt} -->`, '');
    lines.push('<!-- 由 Memory Fabric 自动维护 — 手动编辑会在下次写入时合并保留 -->', '');
    for (const entry of entries.slice(0, 200)) {
      const meta = this.meta.get(entry.id);
      const file = meta ? toRelativePath(layout.scopeRoot, meta.file) : `${entry.id}.md`;
      const hook = sanitizeHook(entry.summary || entry.topic);
      lines.push(`- [${entry.topic}](${file}) — ${hook}`);
    }
    if (entries.length === 0) {
      lines.push('_(empty)_');
    }
    ensureDir(layout.scopeRoot);
    atomicWriteFile(layout.index, `${lines.join('\n')}\n`);
  }

  /** R7 repair() — rescan a scope's files and reconcile MEMORY.md. Idempotent. */
  repair(scope?: MemoryEntryScope): { scanned: number; recovered: number } {
    if (!scope) {
      let scanned = 0;
      let recovered = 0;
      for (const s of enumerateScopes(this.root)) {
        const r = this.repair(s);
        scanned += r.scanned;
        recovered += r.recovered;
      }
      return { scanned, recovered };
    }
    const before = this.entries.size;
    // Drop any cached entries for this scope, then re-hydrate.
    for (const [id, entry] of Array.from(this.entries.entries())) {
      if (entry.scope === scope) {
        this.entries.delete(id);
        this.meta.delete(id);
      }
    }
    this.hydratedScopes.delete(scope);
    this.hydrateScope(scope);
    const after = this.entries.size;
    this.rewriteIndex(scope);
    return { scanned: after - before + (this.entries.size - after), recovered: this.entries.size };
  }

  /** Used by MemoryFabric writeEntry: attach the on-disk file path post-write. */
  recordPath(id: string, file: string): void {
    if (!file) return;
    const prev = this.meta.get(id);
    this.meta.set(id, { file, tier: tierFromFile(file), sparse: prev?.sparse ?? false });
  }

  /**
   * Public form of {@link rewriteFileFrontmatter}. MemoryFabric calls this
   * after writeEntry so the on-disk frontmatter always reflects the canonical
   * MemoryEntry — even when a legacy `write()` / `deposit()` path produced
   * the file with sparse frontmatter (no id / asset_ref / verification_status
   * etc). Without this, a fresh fabric re-hydrating the directory would lose
   * fields that only existed in the in-memory MemoryEntry.
   */
  syncFrontmatter(id: string): void {
    this.rewriteFileFrontmatter(id);
  }

  /** Where do we keep the file backing this entry? */
  fileFor(id: string): string | undefined {
    return this.meta.get(id)?.file;
  }

  removeEntry(id: string, alsoUnlinkFile = false): void {
    const meta = this.meta.get(id);
    this.entries.delete(id);
    this.meta.delete(id);
    if (alsoUnlinkFile && meta) {
      try {
        unlinkSync(meta.file);
      } catch {
        /* best-effort */
      }
    }
  }

  // ----- internals -----

  private scanDir(dir: string, scope: MemoryEntryScope, tier: FileTier): void {
    if (!existsSync(dir)) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      if (name.startsWith('.')) continue;
      const file = join(dir, name);
      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const text = safeRead(file);
      if (text === null) continue;
      const hydrated = this.entryFromFile(file, text, scope, tier);
      if (!hydrated) continue;
      this.entries.set(hydrated.entry.id, hydrated.entry);
      this.meta.set(hydrated.entry.id, { file, tier, sparse: hydrated.sparse });
    }
  }

  private entryFromFile(
    file: string,
    text: string,
    scope: MemoryEntryScope,
    tier: FileTier,
  ): { entry: MemoryEntry; sparse: boolean } | null {
    const { frontmatter, body } = splitFrontmatter(text);
    const content = body.trim();
    if (content.length === 0) return null;

    // FEAT-035 codex MUST-FIX #4: a frontmatter that lacks the canonical
    // `id` / `layer` / `scope` triple is a "sparse" hydration (legacy
    // write()/deposit() output, or a hand-edited file). evictByFile is
    // allowed to drop sparse rows but must not touch canonical ones.
    const sparse =
      stringField(frontmatter.id) === undefined ||
      stringField(frontmatter.layer) === undefined ||
      stringField(frontmatter.scope) === undefined;

    const layer = layerFromFrontmatter(frontmatter, tier);
    const idGuess = stringField(frontmatter.id) ?? deterministicEntryId(layer, scope, frontmatter, content);
    const contentHash = stringField(frontmatter.content_hash) ?? hashContent(content);
    const topic = stringField(frontmatter.topic) ?? firstHeading(content) ?? deriveTopic(file);
    const summary = stringField(frontmatter.summary) ?? firstLine(content);
    const sourceRef = stringField(frontmatter.source_ref) ?? stringField(frontmatter.source) ?? `file:${file}`;
    const tags = arrayField(frontmatter.tags);
    const verificationStatus = verificationStatusField(frontmatter.verification_status);
    const agentId = scope.startsWith('agent:')
      ? scope.slice('agent:'.length)
      : stringField(frontmatter.agent_id);
    const date = stringField(frontmatter.date) ?? defaultDateFromStat(file);
    const createdAt = stringField(frontmatter.created_at) ?? `${date}T00:00:00.000Z`;
    const updatedAt = stringField(frontmatter.updated_at) ?? createdAt;
    let archivedAt = stringField(frontmatter.archived_at);
    // codex MUST-FIX #5: any file under impressions/archived/ is archived
    // by definition, even if frontmatter forgets to flag it.
    if (archivedAt === undefined && tier === 'archived') archivedAt = updatedAt;
    const archivedReason = stringField(frontmatter.archived_reason);
    const evidenceRefs = arrayField(frontmatter.verification_evidence_refs);
    const confidence = numberField(frontmatter.confidence);
    const assetRef = stringField(frontmatter.asset_ref);

    const entry: MemoryEntry = {
      id: idGuess,
      layer,
      scope,
      topic,
      summary,
      content,
      contentHash,
      sourceRef,
      verificationStatus,
      tags,
      createdAt,
      updatedAt,
      verificationEvidenceRefs: evidenceRefs,
    };
    if (agentId !== undefined) entry.agentId = agentId;
    entry.contentPath = file;
    if (assetRef !== undefined) entry.assetRef = assetRef;
    if (confidence !== undefined) entry.confidence = confidence;
    if (archivedAt !== undefined) entry.archivedAt = archivedAt;
    if (archivedReason !== undefined) entry.archivedReason = archivedReason;
    return { entry, sparse };
  }

  private rewriteFileFrontmatter(id: string): void {
    const entry = this.entries.get(id);
    const meta = this.meta.get(id);
    if (!entry || !meta) return;
    const existingText = existsSync(meta.file) ? safeRead(meta.file) : null;
    let preserved: Frontmatter = {};
    let body = '';
    if (existingText !== null) {
      const split = splitFrontmatter(existingText);
      preserved = split.frontmatter;
      body = split.body;
    } else {
      // First-time write for session-layer entries that came in without an
      // existing on-disk file (writeEntry called directly by callers that
      // bypass write()/deposit()/wrapupSession()).
      body = `# ${entry.topic}\n\n## Source: ${entry.sourceRef}\n\n${entry.content}\n`;
    }
    const fm = frontmatterFromEntry(entry);
    // codex MUST-FIX #1: preserve unknown frontmatter fields written by
    // legacy deposit() / wrapupSession() flows (wrapup_id / hash /
    // topic_slug). Without this, syncFrontmatter would erase them and
    // mergePendingForWrapup could no longer find pending records by id.
    for (const [key, value] of Object.entries(preserved)) {
      if (CANONICAL_FRONTMATTER_FIELDS.includes(key)) continue;
      if (value === undefined || value === null) continue;
      fm[key] = value;
    }
    ensureDir(dirname(meta.file));
    atomicWriteFile(meta.file, `${serializeFrontmatter(fm)}${body.trimEnd()}\n`);
  }
}

// ----- helpers -----

function tierFromFile(file: string): FileTier {
  if (file.includes(`${SEP}impressions${SEP}archived${SEP}`)) return 'archived';
  if (file.includes(`${SEP}impressions${SEP}`)) return 'impression';
  if (file.includes(`${SEP}.pending${SEP}`)) return 'pending';
  return 'knowledge';
}

const SEP = process.platform === 'win32' ? '\\' : '/';

function layerFromFrontmatter(frontmatter: Frontmatter, tier: FileTier): MemoryLayer {
  const fmLayer = stringField(frontmatter.layer);
  if (fmLayer === 'session' || fmLayer === 'persistent' || fmLayer === 'skill') return fmLayer;
  if (tier === 'pending' || tier === 'impression' || tier === 'archived') return 'session';
  return 'persistent';
}

function deterministicEntryId(
  layer: MemoryLayer,
  scope: MemoryEntryScope,
  frontmatter: Frontmatter,
  content: string,
): string {
  const seedHash = stringField(frontmatter.content_hash) ?? hashContent(content);
  const digest = hashContent(`${layer}:${scope}:${seedHash}`);
  return `mem_${digest.slice(0, 16)}`;
}

function frontmatterFromEntry(entry: MemoryEntry): Frontmatter {
  const fm: Frontmatter = {
    id: entry.id,
    topic: entry.topic,
    summary: entry.summary,
    layer: entry.layer,
    scope: entry.scope,
    source_ref: entry.sourceRef,
    content_hash: entry.contentHash,
    verification_status: entry.verificationStatus,
    tags: entry.tags,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    date: entry.createdAt.slice(0, 10),
  };
  if (entry.agentId) fm.agent_id = entry.agentId;
  if (entry.assetRef) fm.asset_ref = entry.assetRef;
  if (entry.confidence !== undefined) fm.confidence = entry.confidence;
  if (entry.verificationEvidenceRefs.length > 0) {
    fm.verification_evidence_refs = entry.verificationEvidenceRefs;
  }
  if (entry.archivedAt) fm.archived_at = entry.archivedAt;
  if (entry.archivedReason) fm.archived_reason = entry.archivedReason;
  return fm;
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function deriveTopic(file: string): string {
  const segments = file.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? file;
  return base.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}_/, '') || 'untitled';
}

function firstHeading(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    if (/^#\s+/.test(line)) return line.replace(/^#\s+/, '').trim();
  }
  return undefined;
}

function firstLine(content: string): string {
  const line = content.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

function stringField(value: Frontmatter[string]): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function arrayField(value: Frontmatter[string]): readonly string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

function numberField(value: Frontmatter[string]): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function verificationStatusField(value: Frontmatter[string]): VerificationStatus {
  if (
    value === 'unverified' ||
    value === 'verified' ||
    value === 'conflicted' ||
    value === 'rejected'
  ) {
    return value;
  }
  return 'unverified';
}

function defaultDateFromStat(file: string): string {
  try {
    return statSync(file).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function collectScopes(query: MemoryQuery): MemoryEntryScope[] {
  const scopes: MemoryEntryScope[] = [];
  if (query.scope) scopes.push(query.scope);
  if (query.scopes) for (const s of query.scopes) scopes.push(s);
  if (query.agentId && scopes.length === 0) {
    scopes.push(`agent:${query.agentId}` as MemoryEntryScope);
    scopes.push('shared');
    scopes.push('platform');
  }
  return Array.from(new Set(scopes));
}

function filterEntry(entry: MemoryEntry, query: MemoryQuery): boolean {
  if (!query.includeArchived && entry.archivedAt) return false;
  const statuses = normalize(query.verificationStatus);
  if (statuses.length > 0) {
    if (!statuses.includes(entry.verificationStatus)) return false;
  } else if (entry.verificationStatus === 'rejected') {
    return false;
  }

  const scopeFilters = collectScopes(query);
  if (scopeFilters.length > 0 && !scopeFilters.includes(entry.scope)) return false;

  const layers = normalize(query.layer);
  if (layers.length > 0 && !layers.includes(entry.layer)) return false;

  if (query.agentId && scopeFilters.length === 0) {
    const entryAgent = entry.agentId ?? (entry.scope.startsWith('agent:') ? entry.scope.slice('agent:'.length) : null);
    if (entryAgent !== query.agentId && entry.scope !== `agent:${query.agentId}`) return false;
  }

  if (query.assetRef && entry.assetRef !== query.assetRef) return false;

  if (query.skillId) {
    const wanted = query.skillId;
    const matchesAsset = entry.assetRef === wanted || entry.assetRef === `skill:${wanted}`;
    const matchesTags = entry.tags.includes(wanted);
    const matchesSource = entry.sourceRef.includes(wanted);
    if (!matchesAsset && !matchesTags && !matchesSource) return false;
  }

  if (query.tags && query.tags.length > 0) {
    for (const tag of query.tags) {
      if (!entry.tags.includes(tag)) return false;
    }
  }

  if (query.since) {
    if (entry.createdAt.localeCompare(query.since) < 0) return false;
  }

  return true;
}

function scoreEntry(
  entry: MemoryEntry,
  tokens: readonly string[],
  query: MemoryQuery,
): { score: number; keywordHits: number; matchedBy: string[] } {
  let score = 0;
  let keywordHits = 0;
  const matched: string[] = [];

  if (tokens.length > 0) {
    const haystack = `${entry.topic}\n${entry.summary}\n${entry.content}\n${entry.tags.join(' ')}\n${entry.sourceRef}`.toLowerCase();
    let hits = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) hits += 1;
    }
    if (hits === 0) {
      return { score: -1, keywordHits: 0, matchedBy: [] };
    }
    keywordHits = hits;
    score += 30 + Math.min(hits * 10, 40);
    matched.push('keyword');
  }

  score += 25 - STATUS_ORDER[entry.verificationStatus] * 7;
  score += 12 - LAYER_ORDER[entry.layer] * 3;
  if (query.agentId && entry.scope === `agent:${query.agentId}`) score += 14;
  else if (entry.scope === 'shared') score += 10;
  else if (entry.scope.startsWith('project:')) score += 8;
  else if (entry.scope === 'platform') score += 6;

  if (entry.confidence !== undefined) score += Math.round(entry.confidence * 5);
  if (query.scope || (query.scopes && query.scopes.length > 0)) matched.push('scope');
  if (query.layer) matched.push('layer');
  if (query.verificationStatus) matched.push('verificationStatus');
  if (query.agentId) matched.push('agentId');
  if (query.assetRef) matched.push('assetRef');
  if (query.skillId) matched.push('skillId');
  if (query.tags && query.tags.length > 0) matched.push('tags');

  return { score, keywordHits, matchedBy: matched };
}

function normalize<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? Array.from(value) : [value as T];
}

function enumerateScopes(root: string): MemoryEntryScope[] {
  const out: MemoryEntryScope[] = [];
  if (existsSync(join(root, 'platform'))) out.push('platform');
  if (existsSync(join(root, 'shared'))) out.push('shared');
  const agentsDir = join(root, 'agents');
  if (existsSync(agentsDir)) {
    for (const name of readdirSafe(agentsDir)) {
      const full = join(agentsDir, name);
      if (!isDir(full)) continue;
      out.push(`agent:${name}` as MemoryEntryScope);
    }
  }
  const projectsDir = join(root, 'projects');
  if (existsSync(projectsDir)) {
    for (const name of readdirSafe(projectsDir)) {
      const full = join(projectsDir, name);
      if (!isDir(full)) continue;
      out.push(`project:${name}` as MemoryEntryScope);
    }
  }
  return out;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function toRelativePath(scopeRoot: string, file: string): string {
  return relative(scopeRoot, file).split(SEP).join('/');
}

function sanitizeHook(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function inferTypeFromEntry(entry: MemoryEntry): MemoryFileType {
  for (const tag of entry.tags) {
    if (VALID_TYPES.has(tag as MemoryFileType)) return tag as MemoryFileType;
  }
  return 'project';
}
