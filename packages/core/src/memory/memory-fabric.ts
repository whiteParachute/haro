import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildScopeLayout } from './paths.js';
import {
  SerialWriter,
  atomicWriteFile,
  ensureDir,
  readFileIfExists,
} from './atomic-io.js';
import {
  MemoryIndex,
  hashContent,
  tokenize,
  type IndexRecord,
} from './index-store.js';
import {
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from './frontmatter.js';
import type {
  MemoryContextInput,
  MemoryContextItem,
  MemoryContextResult,
  MemoryDepositInput,
  MemoryMaintenanceReport,
  MemoryMaintenanceStepReport,
  MemoryQueryHit,
  MemoryQueryInput,
  MemoryQueryResult,
  MemoryScope,
  MemoryScopeStats,
  MemoryStats,
  MemoryWrapupInput,
  MemoryWriteInput,
} from './types.js';

export interface MemoryFabricOptions {
  /** Root of the memory tree. Must exist. */
  root: string;
  /** Optional secondary root (R10 primary/backup). */
  backupRoot?: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** Optional debug logger. */
  onEvent?: (event: MemoryFabricEvent) => void;
}

export type MemoryFabricEvent =
  | { kind: 'write'; scope: MemoryScope; agentId?: string; file: string }
  | { kind: 'deposit'; scope: MemoryScope; agentId?: string; file: string }
  | { kind: 'wrapup'; scope: MemoryScope; agentId?: string; file: string }
  | { kind: 'maintenance-step'; scope: MemoryScope; agentId?: string; step: string; status: string }
  | { kind: 'backup-write'; file: string };

interface ScopeKey {
  scope: MemoryScope;
  agentId?: string;
}

const INDEX_HEADER = [
  '# 随身索引',
  '',
  '<!-- 由 Memory Fabric 自动维护 — 手动编辑会在下次写入时合并保留 -->',
  '',
].join('\n');

const INDEX_MAX_ENTRIES = 200;

export function createMemoryFabric(options: MemoryFabricOptions): MemoryFabric {
  return new MemoryFabric(options);
}

/**
 * FEAT-007 Memory Fabric. See `specs/phase-0/FEAT-007-memory-fabric-independent.md`
 * for the authoritative spec. Deliberate design notes worth flagging to future
 * readers:
 *
 *  - Everything that touches the filesystem routes through `SerialWriter`. Do
 *    not call atomicWriteFile directly from the public methods — the chain is
 *    what lets R6 "concurrent writes are safe" hold without OS-level locks.
 *
 *  - The in-memory `MemoryIndex` is the real source of truth for R4
 *    "same-session visibility": T1 and T2 writes both update it before any
 *    deferred side effects fire. The on-disk index.md is recomputed from the
 *    in-memory structure, not the other way round.
 *
 *  - Backup mirroring is opt-in and best-effort (R10). Failures are surfaced
 *    through `onEvent` but never block primary writes.
 */
export class MemoryFabric {
  private readonly root: string;
  private readonly backupRoot: string | null;
  private readonly now: () => Date;
  private readonly onEvent: NonNullable<MemoryFabricOptions['onEvent']>;
  private readonly writer = new SerialWriter();
  private readonly index = new MemoryIndex();
  private readonly loadedScopes = new Set<string>();
  private readonly pendingBackups = new Set<Promise<void>>();
  private lastMaintenanceAt?: string;

  constructor(options: MemoryFabricOptions) {
    if (!options.root || options.root.length === 0) {
      throw new Error('MemoryFabric: options.root is required');
    }
    this.root = options.root;
    this.backupRoot = options.backupRoot ?? null;
    this.now = options.now ?? (() => new Date());
    this.onEvent = options.onEvent ?? (() => undefined);
    ensureDir(this.root);
  }

  /* --------------------------- R3 T1 synchronous --------------------------- */

  async write(input: MemoryWriteInput): Promise<{ file: string; key: string }> {
    const { scope, agentId, topic, content } = this.validateWrite(input);
    const layout = buildScopeLayout(this.root, scope, agentId);
    this.loadScope({ scope, agentId });
    const summary = input.summary ?? firstLine(content);
    const tags = input.tags ?? [];
    const source = input.source ?? 'haro-runtime';
    const now = this.now();
    const date = formatDate(now);
    const slug = slugify(topic);
    const file = join(layout.knowledge, `${slug}.md`);
    const key = `k:${scope}:${agentId ?? ''}:${slug}`;

    const writeResult = await this.writer.run(async () => {
      ensureDir(layout.knowledge);
      const existing = readFileIfExists(file);
      const merged = existing
        ? mergeKnowledgeAppend(existing, { content, summary, source, date })
        : renderKnowledgeFile({ topic, summary, content, tags, source, date });
      atomicWriteFile(file, merged);
      const record: IndexRecord = {
        key,
        scope,
        content,
        summary,
        sourceFile: file,
        source,
        tier: 'knowledge',
        date,
        tags,
        writtenAt: now.getTime(),
      };
      if (agentId !== undefined) record.agentId = agentId;
      this.index.upsert(record);
      this.persistIndex(scope, agentId);
      return { file, key };
    });
    if (this.backupRoot) this.mirrorToBackupAsync(scope, agentId, writeResult.file);
    this.onEvent({ kind: 'write', scope, agentId, file: writeResult.file });
    return writeResult;
  }

  /* --------------------------- R3 T2 asynchronous --------------------------- */

  async deposit(input: MemoryDepositInput): Promise<{ file: string; key: string; hash: string }> {
    const { scope, agentId, content } = this.validateDeposit(input);
    const layout = buildScopeLayout(this.root, scope, agentId);
    this.loadScope({ scope, agentId });
    const summary = input.summary ?? firstLine(content);
    const tags = input.tags ?? [];
    const source = input.source;
    const wrapupId = input.wrapupId;
    const topicSlug = slugify(input.topic ?? topicFromPendingSummary(summary));
    const now = this.now();
    const date = formatDate(now);
    const hash = hashContent(content);
    const idemKey = `${source}:${wrapupId}:${hash}`;
    const uuid = deterministicUuid(idemKey) ?? randomUUID();
    const file = join(layout.pending, `${uuid}.md`);
    const indexKey = `p:${scope}:${agentId ?? ''}:${uuid}`;

    const res = await this.writer.run(async () => {
      ensureDir(layout.pending);
      if (existsSync(file)) {
        // Idempotent: same deposit already captured.
        return { file, key: indexKey, hash };
      }
      const frontmatter: Frontmatter = {
        source,
        wrapup_id: wrapupId,
        hash,
        date,
        tags,
        summary,
        topic_slug: topicSlug,
      };
      atomicWriteFile(file, `${serializeFrontmatter(frontmatter)}${content}\n`);
      const record: IndexRecord = {
        key: indexKey,
        scope,
        content,
        summary,
        sourceFile: file,
        source,
        tier: 'pending',
        date,
        tags,
        writtenAt: now.getTime(),
      };
      if (agentId !== undefined) record.agentId = agentId;
      this.index.upsert(record);
      this.persistIndex(scope, agentId);
      return { file, key: indexKey, hash };
    });
    // Backup mirror runs outside the serial section so a slow backup path does
    // not stall primary writes (codex SHOULD-FIX). We read+write best-effort;
    // failures surface via onEvent but never block the primary commit.
    if (this.backupRoot) this.mirrorToBackupAsync(scope, agentId, res.file);
    this.onEvent({ kind: 'deposit', scope, agentId, file: res.file });
    return res;
  }

  /* --------------------------- R3 T3 wrapup --------------------------- */

  async wrapupSession(input: MemoryWrapupInput): Promise<{ file: string; key: string }> {
    const { scope, agentId } = this.validateWrapup(input);
    const layout = buildScopeLayout(this.root, scope, agentId);
    this.loadScope({ scope, agentId });
    const now = this.now();
    const date = formatDate(now);
    const slug = slugify(input.topic);
    const file = join(layout.impressions, `${date}_${slug}.md`);
    const key = `i:${scope}:${agentId ?? ''}:${date}_${slug}`;
    const summary = input.summary ?? firstLine(input.transcript);
    const tags = input.tags ?? [];
    const source = input.source ?? 'haro-runtime';

    const res = await this.writer.run(async () => {
      ensureDir(layout.impressions);
      const content = renderImpressionFile({
        topic: input.topic,
        summary,
        transcript: input.transcript,
        tags,
        source,
        wrapupId: input.wrapupId,
        date,
      });
      atomicWriteFile(file, content);
      const record: IndexRecord = {
        key,
        scope,
        content: input.transcript,
        summary,
        sourceFile: file,
        source,
        tier: 'impressions',
        date,
        tags,
        writtenAt: now.getTime(),
      };
      if (agentId !== undefined) record.agentId = agentId;
      this.index.upsert(record);
      this.persistIndex(scope, agentId);
      return { file, key };
    });
    if (this.backupRoot) this.mirrorToBackupAsync(scope, agentId, res.file);
    this.onEvent({ kind: 'wrapup', scope, agentId, file: res.file });

    if (input.mergePending !== false) {
      await this.mergePendingForWrapup(scope, agentId, input.wrapupId);
    }
    return res;
  }

  /* --------------------------- R1/R2 query --------------------------- */

  /**
   * R1 cascade (codex final-review fix): search tier-by-tier so results are
   * grouped `index → impressions → knowledge → pending` in that order, and
   * only hit `archived` when the caller opts in with `includeArchived`
   * (matches spec step 4 "未命中时扩展到 impressions/archived/"). We do NOT
   * short-circuit between steps 1-3: aria-memory treats those as a combined
   * priority-ordered search, so a partial index hit still gets augmented by
   * impression + knowledge results for the same query — AC3 asserts this.
   */
  query(input: MemoryQueryInput): MemoryQueryResult {
    const scope = input.scope;
    const agentId = input.agentId;
    this.loadScope(scope ? { scope, agentId } : { scope: 'platform' });
    if (scope === 'agent') this.loadScope({ scope: 'platform' });

    const primaryTiers: IndexRecord['tier'][] = ['index', 'impressions', 'knowledge', 'pending'];

    const limit = input.limit ?? 20;
    const seen = new Set<string>();
    const hits: MemoryQueryHit[] = [];
    const collectFromTier = (tier: IndexRecord['tier']): void => {
      if (hits.length >= limit) return;
      const searchOpts: { scope?: IndexRecord['scope']; agentId?: string; limit: number; tiers: readonly IndexRecord['tier'][] } = {
        limit: limit - hits.length,
        tiers: [tier],
      };
      if (scope) searchOpts.scope = scope;
      if (agentId) searchOpts.agentId = agentId;
      const records = this.index.search(input.query, searchOpts);
      for (const r of records) {
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        const hit: MemoryQueryHit = {
          content: r.content,
          summary: r.summary,
          source: r.source,
          sourceFile: r.sourceFile,
          tier: r.tier,
          score: scoreAgainstQuery(r, input.query),
          tags: r.tags,
        };
        if (r.date !== undefined) hit.date = r.date;
        hits.push(hit);
        if (hits.length >= limit) return;
      }
    };

    for (const tier of primaryTiers) collectFromTier(tier);
    // Spec step 4: only escalate to archived when the primary cascade was
    // empty OR the caller explicitly asked for it.
    if (hits.length === 0 || input.includeArchived) {
      collectFromTier('archived');
    }

    return { hits, servedFromIndex: true };
  }

  /* --------------------------- R4 context injection --------------------------- */

  contextFor(input: MemoryContextInput): MemoryContextResult {
    const limit = input.limit ?? 5;
    this.loadScope({ scope: 'agent', agentId: input.agentId });
    this.loadScope({ scope: 'platform' });
    const searchOpts = {
      agentId: input.agentId,
      limit,
      tiers: ['knowledge', 'pending', 'impressions', 'index'] as const,
    };
    const agentHits = this.index.search(input.query, searchOpts);
    const platformHits =
      agentHits.length >= limit
        ? []
        : this.index.search(input.query, { scope: 'platform', limit: limit - agentHits.length, tiers: searchOpts.tiers });
    const items: MemoryContextItem[] = [...agentHits, ...platformHits].map((r) => {
      const item: MemoryContextItem = {
        summary: r.summary,
        source: r.source,
        sourceFile: r.sourceFile,
        tier: r.tier,
      };
      if (r.date !== undefined) item.date = r.date;
      return item;
    });
    return { items };
  }

  /* --------------------------- R7 maintenance --------------------------- */

  async maintenance(opts: { scope?: MemoryScope; agentId?: string } = {}): Promise<MemoryMaintenanceReport> {
    const scope: MemoryScope = opts.scope ?? 'platform';
    const agentId = opts.agentId;
    const layout = buildScopeLayout(this.root, scope, agentId);
    const steps: MemoryMaintenanceStepReport[] = [];
    const ranAt = this.now().toISOString();

    const step = (name: string, fn: () => void): void => {
      try {
        fn();
        steps.push({ step: name, status: 'ok' });
        this.onEvent({ kind: 'maintenance-step', scope, agentId, step: name, status: 'ok' });
      } catch (err) {
        steps.push({ step: name, status: 'error', detail: err instanceof Error ? err.message : String(err) });
        this.onEvent({ kind: 'maintenance-step', scope, agentId, step: name, status: 'error' });
      }
    };

    await this.writer.run(async () => {
      step('backup', () => this.backupSnapshot(layout));
      step('merge-pending', () => this.mergeAllPending(layout, scope, agentId));
      step('compact-index', () => this.compactIndex(scope, agentId));
      step('rebuild-index', () => this.persistIndex(scope, agentId));
      step('archive-old-impressions', () => this.archiveOldImpressions(layout));
      step('split-knowledge', () => this.splitKnowledge(layout));
      step('update-personality', () => this.updatePersonalityStub(layout));
      step('update-meta', () => this.updateMeta(layout, ranAt));
      step('update-last-sleep-at', () => atomicWriteFile(layout.lastSleepAt, `${ranAt}\n`));
      step('generate-daily', () => this.generateDailyEntry(layout, ranAt));
      step('append-changelog', () => this.appendChangelog(layout, ranAt));
      step('finalize', () => {
        this.lastMaintenanceAt = ranAt;
      });
    });

    const changelogEntry = `[${ranAt}] memory-sleep executed on scope=${scope}${agentId ? `/${agentId}` : ''}`;
    return { scope, agentId, steps, ranAt, changelogEntry };
  }

  /* --------------------------- R8 stats --------------------------- */

  stats(): MemoryStats {
    const scopes: MemoryScopeStats[] = [];
    for (const key of this.loadedScopes) {
      const [scope, agentId] = key.split('|') as [MemoryScope, string];
      const layout = buildScopeLayout(this.root, scope, agentId || undefined);
      const scopeStats: MemoryScopeStats = {
        scope,
        knowledgeCount: safeList(layout.knowledge).filter((f) => f.endsWith('.md')).length,
        impressionCount: safeList(layout.impressions).filter((f) => f.endsWith('.md')).length,
        pendingCount: safeList(layout.pending).filter((f) => f.endsWith('.md')).length,
        indexEntries: this.index.list().filter((r) => r.scope === scope && (r.agentId ?? '') === (agentId || '')).length,
      };
      if (agentId) scopeStats.agentId = agentId;
      scopes.push(scopeStats);
    }
    const result: MemoryStats = { root: this.root, scopes };
    if (this.lastMaintenanceAt !== undefined) {
      result.lastMaintenanceAt = this.lastMaintenanceAt;
    }
    return result;
  }

  /* --------------------------- scope loader --------------------------- */

  private loadScope(key: ScopeKey): void {
    const cacheKey = `${key.scope}|${key.agentId ?? ''}`;
    if (this.loadedScopes.has(cacheKey)) return;
    this.loadedScopes.add(cacheKey);
    const layout = buildScopeLayout(this.root, key.scope, key.agentId);
    ensureDir(layout.scopeRoot);
    this.hydrateKnowledge(layout, key);
    this.hydrateImpressions(layout, key);
    this.hydratePending(layout, key);
    // R10 "读先主后备" (codex final-review fix): when the primary scope root
    // turns out to be empty but a backup root has content, hydrate from the
    // backup as a read fallback. Backup records still point at the backup
    // path so subsequent writes (which go to primary) supersede them on the
    // next query. Phase-0 primary/backup is an optional feature per the spec
    // §3 non-goals, so this is strictly best-effort.
    if (this.backupRoot) this.hydrateBackupFallback(key);
  }

  private hydrateBackupFallback(key: ScopeKey): void {
    if (!this.backupRoot) return;
    const backupLayout = buildScopeLayout(this.backupRoot, key.scope, key.agentId);
    if (!existsSync(backupLayout.scopeRoot)) return;
    // Only fill gaps: the primary write path will re-upsert on the next
    // mutation, which is the correct "read primary first, backup fallback"
    // shape. We reuse the hydrate helpers by pointing them at the backup
    // layout — their IndexRecord.sourceFile will correctly carry the backup
    // path for traceability.
    this.hydrateKnowledge(backupLayout, key);
    this.hydrateImpressions(backupLayout, key);
    this.hydratePending(backupLayout, key);
  }

  private hydrateKnowledge(layout: ReturnType<typeof buildScopeLayout>, key: ScopeKey): void {
    for (const name of safeList(layout.knowledge)) {
      if (!name.endsWith('.md') || name.startsWith('.')) continue;
      const file = join(layout.knowledge, name);
      const text = readFileSync(file, 'utf8');
      const { frontmatter, body } = splitFrontmatter(text);
      const summary = (frontmatter.summary as string | undefined) ?? firstLine(body);
      const tags = (frontmatter.tags as readonly string[] | undefined) ?? [];
      const date = (frontmatter.date as string | undefined) ?? formatDate(this.now());
      const source = (frontmatter.source as string | undefined) ?? 'unknown';
      const slug = name.replace(/\.md$/, '');
      const record: IndexRecord = {
        key: `k:${key.scope}:${key.agentId ?? ''}:${slug}`,
        scope: key.scope,
        content: body,
        summary,
        sourceFile: file,
        source,
        tier: 'knowledge',
        date,
        tags,
        writtenAt: statSync(file).mtimeMs,
      };
      if (key.agentId !== undefined) record.agentId = key.agentId;
      this.index.upsert(record);
    }
  }

  private hydrateImpressions(layout: ReturnType<typeof buildScopeLayout>, key: ScopeKey): void {
    for (const name of safeList(layout.impressions)) {
      if (!name.endsWith('.md')) continue;
      const file = join(layout.impressions, name);
      const stat = statSync(file);
      if (stat.isDirectory()) continue;
      const text = readFileSync(file, 'utf8');
      const { frontmatter, body } = splitFrontmatter(text);
      const summary = (frontmatter.summary as string | undefined) ?? firstLine(body);
      const tags = (frontmatter.tags as readonly string[] | undefined) ?? [];
      const date = (frontmatter.date as string | undefined) ?? name.slice(0, 10);
      const source = (frontmatter.source as string | undefined) ?? 'unknown';
      const slug = name.replace(/\.md$/, '');
      const record: IndexRecord = {
        key: `i:${key.scope}:${key.agentId ?? ''}:${slug}`,
        scope: key.scope,
        content: body,
        summary,
        sourceFile: file,
        source,
        tier: 'impressions',
        date,
        tags,
        writtenAt: stat.mtimeMs,
      };
      if (key.agentId !== undefined) record.agentId = key.agentId;
      this.index.upsert(record);
    }
  }

  private hydratePending(layout: ReturnType<typeof buildScopeLayout>, key: ScopeKey): void {
    for (const name of safeList(layout.pending)) {
      if (!name.endsWith('.md')) continue;
      const file = join(layout.pending, name);
      const text = readFileSync(file, 'utf8');
      const { frontmatter, body } = splitFrontmatter(text);
      const summary = (frontmatter.summary as string | undefined) ?? firstLine(body);
      const tags = (frontmatter.tags as readonly string[] | undefined) ?? [];
      const date = (frontmatter.date as string | undefined) ?? formatDate(this.now());
      const source = (frontmatter.source as string | undefined) ?? 'unknown';
      const slug = name.replace(/\.md$/, '');
      const record: IndexRecord = {
        key: `p:${key.scope}:${key.agentId ?? ''}:${slug}`,
        scope: key.scope,
        content: body.trim(),
        summary,
        sourceFile: file,
        source,
        tier: 'pending',
        date,
        tags,
        writtenAt: statSync(file).mtimeMs,
      };
      if (key.agentId !== undefined) record.agentId = key.agentId;
      this.index.upsert(record);
    }
  }

  /* --------------------------- index persistence --------------------------- */

  private persistIndex(scope: MemoryScope, agentId?: string): void {
    const layout = buildScopeLayout(this.root, scope, agentId);
    const entries = this.index
      .list()
      .filter((r) => r.scope === scope && (r.agentId ?? '') === (agentId ?? ''))
      .sort((a, b) => b.writtenAt - a.writtenAt)
      .slice(0, INDEX_MAX_ENTRIES);
    const body = entries
      .map((r) => `- [${r.date ?? ''}] ${r.summary.trim()} → [[${slugFromFile(r.sourceFile)}]]`)
      .join('\n');
    atomicWriteFile(layout.index, `${INDEX_HEADER}${body}\n`);
    if (this.backupRoot) this.mirrorToBackupAsync(scope, agentId, layout.index);
  }

  /* --------------------------- maintenance helpers --------------------------- */

  private backupSnapshot(layout: ReturnType<typeof buildScopeLayout>): void {
    if (!existsSync(layout.scopeRoot)) return;
    const stamp = formatDate(this.now()).replace(/-/g, '');
    const backupFile = join(layout.scopeRoot, `changelog.snapshot-${stamp}.md`);
    const existing = readFileIfExists(layout.changelog) ?? '';
    atomicWriteFile(backupFile, existing);
  }

  private mergeAllPending(layout: ReturnType<typeof buildScopeLayout>, scope: MemoryScope, agentId?: string): void {
    const grouped = this.groupPendingByTopic(layout);
    for (const [topicSlug, records] of grouped.entries()) {
      const file = join(layout.knowledge, `${topicSlug}.md`);
      const existing = readFileIfExists(file);
      const body = mergeKnowledgeFromPending(existing, records);
      atomicWriteFile(file, body);
      for (const rec of records) {
        try {
          unlinkSync(rec.sourceFile);
        } catch {
          /* ignore */
        }
        this.index.remove(rec.key);
      }
      this.index.upsert({
        ...records[0]!,
        key: `k:${scope}:${agentId ?? ''}:${topicSlug}`,
        tier: 'knowledge',
        sourceFile: file,
        content: body,
      });
    }
  }

  /**
   * Group pending records by topic slug. Prefers the `topic_slug` frontmatter
   * emitted by `deposit()` (codex SHOULD-FIX: prefix-aliased summaries could
   * otherwise merge unrelated topics). Falls back to a summary-derived slug
   * for pending files that predate the frontmatter field.
   */
  private groupPendingByTopic(layout: ReturnType<typeof buildScopeLayout>): Map<string, IndexRecord[]> {
    const grouped = new Map<string, IndexRecord[]>();
    for (const record of this.index.list()) {
      if (record.tier !== 'pending') continue;
      if (!record.sourceFile.startsWith(layout.pending)) continue;
      const slug = this.resolveTopicSlug(record);
      const list = grouped.get(slug) ?? [];
      list.push(record);
      grouped.set(slug, list);
    }
    return grouped;
  }

  private resolveTopicSlug(record: IndexRecord): string {
    const text = readFileIfExists(record.sourceFile);
    if (text) {
      const { frontmatter } = splitFrontmatter(text);
      const explicit = frontmatter.topic_slug;
      if (typeof explicit === 'string' && explicit.length > 0) return explicit;
    }
    return slugify(topicFromPendingSummary(record.summary));
  }

  private async mergePendingForWrapup(scope: MemoryScope, agentId: string | undefined, wrapupId: string): Promise<void> {
    await this.writer.run(async () => {
      const layout = buildScopeLayout(this.root, scope, agentId);
      const relevant = this.index.list().filter((r) => r.tier === 'pending' && r.scope === scope && (r.agentId ?? '') === (agentId ?? ''));
      const deduped = new Map<string, IndexRecord>();
      for (const rec of relevant) {
        const text = readFileIfExists(rec.sourceFile);
        if (!text) continue;
        const { frontmatter } = splitFrontmatter(text);
        if (frontmatter.wrapup_id === wrapupId) {
          const hash = (frontmatter.hash as string | undefined) ?? hashContent(rec.content);
          if (!deduped.has(hash)) deduped.set(hash, rec);
        }
      }
      if (deduped.size === 0) return;
      const byTopic = new Map<string, IndexRecord[]>();
      for (const rec of deduped.values()) {
        const slug = this.resolveTopicSlug(rec);
        const list = byTopic.get(slug) ?? [];
        list.push(rec);
        byTopic.set(slug, list);
      }
      for (const [topicSlug, records] of byTopic.entries()) {
        const file = join(layout.knowledge, `${topicSlug}.md`);
        const existing = readFileIfExists(file);
        const body = mergeKnowledgeFromPending(existing, records);
        atomicWriteFile(file, body);
        for (const rec of records) {
          try {
            unlinkSync(rec.sourceFile);
          } catch {
            /* ignore */
          }
          this.index.remove(rec.key);
        }
        this.index.upsert({
          ...records[0]!,
          key: `k:${scope}:${agentId ?? ''}:${topicSlug}`,
          tier: 'knowledge',
          sourceFile: file,
          content: body,
        });
      }
      this.persistIndex(scope, agentId);
    });
  }

  private compactIndex(_scope: MemoryScope, _agentId?: string): void {
    // No-op in Phase 0: the MemoryIndex is naturally bounded by writes.
    // Kept as a named step so the 12-step report stays shaped as spec'd.
  }

  private archiveOldImpressions(layout: ReturnType<typeof buildScopeLayout>): void {
    ensureDir(layout.impressionsArchived);
    const cutoff = new Date(this.now());
    cutoff.setMonth(cutoff.getMonth() - 6);
    for (const name of safeList(layout.impressions)) {
      if (!name.endsWith('.md')) continue;
      const file = join(layout.impressions, name);
      const stat = statSync(file);
      if (stat.mtime < cutoff) {
        const dest = join(layout.impressionsArchived, name);
        const text = readFileSync(file, 'utf8');
        atomicWriteFile(dest, text);
        try {
          unlinkSync(file);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private splitKnowledge(layout: ReturnType<typeof buildScopeLayout>): void {
    // Phase 0: report-only. We do not split by line count yet — aria-memory
    // uses a 1000-line threshold but we rely on Phase-1 size gating instead
    // (see roadmap). The step name persists so the report matches spec.
    if (!existsSync(layout.knowledge)) return;
  }

  private updatePersonalityStub(layout: ReturnType<typeof buildScopeLayout>): void {
    if (existsSync(layout.personality)) return;
    atomicWriteFile(
      layout.personality,
      [
        '# Personality',
        '',
        '_This file is maintained by memory-sleep. Phase 0 only initializes it;',
        'Phase 1 fills in trait summaries derived from impressions._',
        '',
      ].join('\n'),
    );
  }

  private updateMeta(layout: ReturnType<typeof buildScopeLayout>, ranAt: string): void {
    const payload = {
      lastGlobalSleepAt: ranAt,
      indexVersion: 1,
      counts: {
        knowledge: safeList(layout.knowledge).filter((n) => n.endsWith('.md')).length,
        impressions: safeList(layout.impressions).filter((n) => n.endsWith('.md')).length,
        pending: safeList(layout.pending).filter((n) => n.endsWith('.md')).length,
      },
    };
    atomicWriteFile(layout.meta, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private generateDailyEntry(layout: ReturnType<typeof buildScopeLayout>, ranAt: string): void {
    const dailyDir = join(layout.scopeRoot, 'daily');
    ensureDir(dailyDir);
    const date = formatDate(new Date(ranAt));
    const file = join(dailyDir, `${date}.md`);
    const prev = readFileIfExists(file) ?? `# Daily ${date}\n`;
    atomicWriteFile(file, `${prev}\n- memory-sleep at ${ranAt}`);
  }

  private appendChangelog(layout: ReturnType<typeof buildScopeLayout>, ranAt: string): void {
    const prev = readFileIfExists(layout.changelog) ?? '# Changelog\n';
    const next = `${prev.trimEnd()}\n- ${ranAt} memory-sleep\n`;
    atomicWriteFile(layout.changelog, next);
  }

  /**
   * Best-effort mirror to the backup root. Runs OUTSIDE the SerialWriter
   * critical section (codex SHOULD-FIX) so a slow backup path never stalls
   * primary writes or index persistence. Failures surface via onEvent but
   * never block the caller. AC10 still holds because the primary write has
   * already fsync'd by the time this call returns the next tick.
   */
  private mirrorToBackupAsync(scope: MemoryScope, agentId: string | undefined, file: string): void {
    if (!this.backupRoot) return;
    const relativePath = file.slice(this.root.length);
    const dest = join(this.backupRoot, relativePath);
    const p = Promise.resolve().then(() => {
      try {
        ensureDir(this.backupRoot!);
        const content = readFileIfExists(file);
        if (content === null) return;
        atomicWriteFile(dest, content);
        this.onEvent({ kind: 'backup-write', file: dest });
      } catch {
        /* best-effort */
      }
    });
    this.pendingBackups.add(p);
    void p.finally(() => this.pendingBackups.delete(p));
    void scope;
    void agentId;
  }

  /**
   * Wait for any in-flight backup mirror writes to complete. Tests and
   * shutdown code should call this to get a deterministic "backup is now on
   * disk" moment; production code can rely on best-effort scheduling.
   */
  async drainBackups(): Promise<void> {
    while (this.pendingBackups.size > 0) {
      await Promise.allSettled(Array.from(this.pendingBackups));
    }
  }

  /* --------------------------- validation --------------------------- */

  private validateWrite(input: MemoryWriteInput): Required<Pick<MemoryWriteInput, 'scope' | 'topic' | 'content'>> & { agentId?: string } {
    if (!input.content || input.content.length === 0) throw new Error('MemoryFabric.write: content is required');
    if (!input.topic || input.topic.length === 0) throw new Error('MemoryFabric.write: topic is required');
    if (input.scope === 'agent' && !input.agentId) {
      throw new Error('MemoryFabric.write: agentId is required when scope=agent');
    }
    const res: { scope: MemoryScope; topic: string; content: string; agentId?: string } = {
      scope: input.scope,
      topic: input.topic,
      content: input.content,
    };
    if (input.agentId !== undefined) res.agentId = input.agentId;
    return res;
  }

  private validateDeposit(input: MemoryDepositInput): MemoryDepositInput {
    if (!input.content) throw new Error('MemoryFabric.deposit: content is required');
    if (!input.source) throw new Error('MemoryFabric.deposit: source is required');
    if (!input.wrapupId) throw new Error('MemoryFabric.deposit: wrapupId is required');
    if (input.scope === 'agent' && !input.agentId) {
      throw new Error('MemoryFabric.deposit: agentId is required when scope=agent');
    }
    return input;
  }

  private validateWrapup(input: MemoryWrapupInput): MemoryWrapupInput {
    if (!input.wrapupId) throw new Error('MemoryFabric.wrapupSession: wrapupId is required');
    if (!input.topic) throw new Error('MemoryFabric.wrapupSession: topic is required');
    if (input.scope === 'agent' && !input.agentId) {
      throw new Error('MemoryFabric.wrapupSession: agentId is required when scope=agent');
    }
    return input;
  }
}

/* ---------------------------- free helpers ---------------------------- */

function firstLine(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function slugify(topic: string): string {
  const base = topic
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  return base.length > 0 ? base : 'untitled';
}

function slugFromFile(path: string): string {
  const segments = path.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? path;
  return base.replace(/\.md$/, '');
}

function topicFromPendingSummary(summary: string): string {
  const normalized = summary.trim();
  const first = normalized.split(/[.!?]/)[0];
  return (first ?? normalized).slice(0, 40) || 'untitled';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function renderKnowledgeFile(params: {
  topic: string;
  summary: string;
  content: string;
  tags: readonly string[];
  source: string;
  date: string;
}): string {
  const frontmatter: Frontmatter = {
    topic: params.topic,
    summary: params.summary,
    tags: params.tags,
    source: params.source,
    date: params.date,
  };
  return `${serializeFrontmatter(frontmatter)}# ${params.topic}\n\n## Source: ${params.source}\n\n${params.content}\n`;
}

function renderImpressionFile(params: {
  topic: string;
  summary: string;
  transcript: string;
  tags: readonly string[];
  source: string;
  wrapupId: string;
  date: string;
}): string {
  const frontmatter: Frontmatter = {
    topic: params.topic,
    summary: params.summary,
    tags: params.tags,
    source: params.source,
    wrapup_id: params.wrapupId,
    date: params.date,
  };
  return `${serializeFrontmatter(frontmatter)}# ${params.date} — ${params.topic}\n\n${params.transcript}\n`;
}

function mergeKnowledgeAppend(existing: string, patch: { content: string; summary: string; source: string; date: string }): string {
  const trimmed = existing.trimEnd();
  return `${trimmed}\n\n## Source: ${patch.source} (${patch.date})\n\n${patch.content}\n`;
}

function mergeKnowledgeFromPending(existing: string | null, records: IndexRecord[]): string {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const rec of records) {
    const bucket = rec.source;
    if (!seen.has(bucket)) {
      seen.add(bucket);
      sections.push(`## Source: ${bucket}`);
    }
    sections.push(rec.content.trim());
  }
  const body = sections.join('\n\n');
  if (existing) {
    return `${existing.trimEnd()}\n\n${body}\n`;
  }
  const fm: Frontmatter = {
    topic: records[0]!.summary,
    summary: records[0]!.summary,
    source: 'memory-sleep-merge',
    date: records[0]!.date ?? '',
  };
  return `${serializeFrontmatter(fm)}# ${records[0]!.summary}\n\n${body}\n`;
}

function scoreAgainstQuery(record: IndexRecord, query: string): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const text = `${record.summary}\n${record.content}\n${record.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of tokens) if (text.includes(token)) score += 1;
  return score;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function deterministicUuid(seed: string): string {
  // Deterministic v4-ish UUID derived from sha256(seed). Keeps deposit
  // idempotency stable across process restarts: same deposit → same file.
  // Codex MUST-FIX: the previous Buffer.from(seed).toString('hex') only hashed
  // the first 16 bytes of the seed, so two long seeds sharing a prefix would
  // silently collide into the same UUID. We now hash first, then format.
  const digest = createHash('sha256').update(seed).digest('hex');
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
