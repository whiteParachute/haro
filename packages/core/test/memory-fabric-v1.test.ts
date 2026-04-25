/** FEAT-021 — Memory Fabric v1 layered memory + SQLite FTS5 read model. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createMemoryFabric, type MemoryFabric } from '../src/memory/index.js';

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'haro-memory-v1-'));
}

describe('MemoryFabric v1 write/query/context [FEAT-021]', () => {
  let root: string;
  let dbFile: string;
  let fabric: MemoryFabric;

  beforeEach(() => {
    root = freshRoot();
    dbFile = join(root, 'haro.db');
    fabric = createMemoryFabric({ root, dbFile });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('validates layer/scope/source and returns a MemoryEntry schema', async () => {
    await expect(
      fabric.writeEntry({
        layer: 'persistent',
        scope: 'agent:',
        topic: 'bad scope',
        content: 'invalid',
        sourceRef: 'test',
      }),
    ).rejects.toThrow(/unsupported scope/);
    await expect(
      fabric.writeEntry({
        layer: 'persistent',
        scope: 'shared',
        topic: 'missing source',
        content: 'invalid',
        sourceRef: '',
      }),
    ).rejects.toThrow(/sourceRef/);

    const entry = await fabric.writeEntry({
      layer: 'session',
      scope: 'agent:alpha',
      topic: 'runtime constraint',
      summary: 'Runtime should keep source refs',
      content: 'Never inject unverified memory without its source.',
      sourceRef: 'session:s1:event:1',
      tags: ['runtime'],
    });
    expect(entry).toMatchObject({
      layer: 'session',
      scope: 'agent:alpha',
      agentId: 'alpha',
      verificationStatus: 'unverified',
      sourceRef: 'session:s1:event:1',
    });
    expect(entry.contentHash).toHaveLength(16);
  });

  it('AC1 writes persistent Markdown canonical source and indexes memory_entries + FTS5', async () => {
    const entry = await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'sqlite fts ranking',
      summary: 'SQLite FTS5 backs memory search',
      content: 'Memory Fabric v1 uses SQLite FTS5 read model for keyword lookup.',
      sourceRef: 'spec:FEAT-021',
      verificationStatus: 'verified',
      confidence: 0.9,
    });
    expect(entry.contentPath).toBeTruthy();
    expect(existsSync(entry.contentPath!)).toBe(true);
    expect(readFileSync(entry.contentPath!, 'utf8')).toContain('Memory Fabric v1 uses SQLite FTS5');

    const db = new Database(dbFile, { readonly: true });
    try {
      const row = db.prepare(`SELECT id FROM memory_entries WHERE id = ?`).get(entry.id) as
        | { id: string }
        | undefined;
      expect(row?.id).toBe(entry.id);
      const fts = db
        .prepare(`SELECT entry_id FROM memory_entries_fts WHERE memory_entries_fts MATCH ?`)
        .all('"fts5"') as Array<{ entry_id: string }>;
      expect(fts.map((item) => item.entry_id)).toContain(entry.id);
    } finally {
      db.close();
    }
  });

  it('AC2 filters by keyword/scope/layer/status and ranks verified shared results above unverified ones', async () => {
    await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'ranking policy',
      summary: 'Verified ranking policy',
      content: 'keyword-rank memory should prefer verified evidence.',
      sourceRef: 'review:1',
      verificationStatus: 'verified',
      confidence: 0.8,
    });
    await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'ranking policy draft',
      summary: 'Unverified ranking policy',
      content: 'keyword-rank memory draft is not reviewed.',
      sourceRef: 'agent:draft',
      verificationStatus: 'unverified',
    });
    await fabric.writeEntry({
      layer: 'skill',
      scope: 'shared',
      topic: 'ranking policy skill',
      summary: 'Skill result should be filtered out by layer',
      content: 'keyword-rank skill memory',
      sourceRef: 'skill:test',
      assetRef: 'skill:test',
    });
    await fabric.writeEntry({
      layer: 'persistent',
      scope: 'platform',
      topic: 'ranking policy platform',
      summary: 'Platform result should be filtered out by scope',
      content: 'keyword-rank platform memory',
      sourceRef: 'platform:test',
      verificationStatus: 'verified',
    });

    const results = fabric.queryEntries({
      keyword: 'keyword-rank',
      scope: 'shared',
      layer: 'persistent',
      verificationStatus: ['verified', 'unverified'],
      limit: 5,
    });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.entry.scope === 'shared')).toBe(true);
    expect(results.every((result) => result.entry.layer === 'persistent')).toBe(true);
    expect(results[0]?.entry.verificationStatus).toBe('verified');
  });

  it('AC3 contextFor injects verified shared memory and labels unverified/conflicted uncertainty', async () => {
    await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'concise answer policy',
      summary: 'Verified: answer concisely',
      content: 'For concise requests, keep answers short and cite sources.',
      sourceRef: 'owner:confirmed',
      verificationStatus: 'verified',
    });
    await fabric.writeEntry({
      layer: 'session',
      scope: 'agent:alpha',
      topic: 'concise answer draft',
      summary: 'Draft: maybe answer in bullets',
      content: 'concise answer draft prefers bullets.',
      sourceRef: 'session:s1',
      verificationStatus: 'unverified',
    });

    const ctx = fabric.contextFor({ agentId: 'alpha', query: 'concise answer', limit: 5 });
    expect(ctx.items.map((item) => item.summary)).toEqual(
      expect.arrayContaining(['Verified: answer concisely', 'Draft: maybe answer in bullets']),
    );
    const draft = ctx.items.find((item) => item.summary === 'Draft: maybe answer in bullets');
    expect(draft?.verificationStatus).toBe('unverified');
    expect(draft?.uncertainty).toContain('未验证');
    expect(draft?.uncertainty).toContain('session:s1');
  });

  it('AC4 preserves conflicting topic entries and marks both as conflicted', async () => {
    const first = await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'deployment command',
      summary: 'Deploy via pnpm',
      content: 'Use pnpm deploy for release.',
      sourceRef: 'doc:a',
    });
    const second = await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'deployment command',
      summary: 'Deploy via npm',
      content: 'Use npm run deploy for release.',
      sourceRef: 'doc:b',
    });

    expect(second.id).not.toBe(first.id);
    const results = fabric.queryEntries({
      keyword: 'deploy release',
      scope: 'shared',
      verificationStatus: 'conflicted',
      limit: 10,
    });
    expect(results.map((result) => result.entry.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('AC5 skill memory is queryable by skill id or assetRef for success and failure modes', async () => {
    const success = await fabric.writeEntry({
      layer: 'skill',
      scope: 'shared',
      topic: 'lark-doc success pattern',
      summary: 'lark-doc succeeds with markdown import',
      content: 'Skill lark-doc succeeds when Markdown is normalized before import.',
      sourceRef: 'skill-run:lark-doc:success',
      assetRef: 'skill:lark-doc',
      tags: ['lark-doc', 'success'],
    });
    await fabric.writeEntry({
      layer: 'skill',
      scope: 'shared',
      topic: 'lark-doc failure boundary',
      summary: 'lark-doc fails on oversize tables',
      content: 'Skill lark-doc fails when a table exceeds the Feishu grid limit.',
      sourceRef: 'skill-run:lark-doc:failure',
      assetRef: 'skill:lark-doc',
      tags: ['lark-doc', 'failure'],
    });

    expect(fabric.queryEntries({ skillId: 'lark-doc', keyword: 'normalized', limit: 5 })[0]?.entry.id).toBe(success.id);
    expect(
      fabric.queryEntries({ assetRef: 'skill:lark-doc', keyword: 'grid limit', limit: 5 }).some((result) =>
        result.entry.summary.includes('fails'),
      ),
    ).toBe(true);
    expect(fabric.queryEntries({ skillId: 'missing-skill', keyword: 'normalized', limit: 5 })).toHaveLength(0);
  });

  it('supports verification mark, archive and stats aggregates', async () => {
    const entry = await fabric.writeEntry({
      layer: 'persistent',
      scope: 'platform',
      topic: 'verified gate',
      summary: 'Owner verification is required',
      content: 'Shared verified memory requires reviewer evidence and owner confirmation.',
      sourceRef: 'decision:D3',
    });
    await expect(fabric.markVerification(entry.id, 'verified', ['critic:ok'])).rejects.toThrow(/owner confirmation/);
    await fabric.markVerification(entry.id, 'verified', ['critic:ok', 'owner:whiteParachute']);
    expect(
      fabric.queryEntries({ keyword: 'owner confirmation', verificationStatus: 'verified', limit: 5 })[0]?.entry
        .verificationEvidenceRefs,
    ).toEqual(['critic:ok', 'owner:whiteParachute']);

    await fabric.archiveEntry(entry.id, 'superseded by policy v2');
    expect(fabric.queryEntries({ keyword: 'owner confirmation', limit: 5 })).toHaveLength(0);
    const archived = fabric.queryEntries({ keyword: 'owner confirmation', includeArchived: true, limit: 5 });
    expect(archived[0]?.entry.archivedReason).toBe('superseded by policy v2');
    const stats = fabric.stats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(1);
    expect(stats.archivedEntries).toBeGreaterThanOrEqual(1);
    expect(stats.byLayer?.persistent).toBeGreaterThanOrEqual(1);
  });
});

describe('MemoryFabric v1 rebuildIndex [FEAT-021]', () => {
  it('AC6 rebuilds an existing aria-memory directory twice without duplicate FTS results', async () => {
    const root = freshRoot();
    try {
      const knowledge = join(root, 'platform', 'knowledge');
      mkdirSync(knowledge, { recursive: true });
      writeFileSync(
        join(knowledge, 'legacy.md'),
        [
          '---',
          'topic: legacy haro memory',
          'summary: Legacy aria-memory record',
          'source: aria-memory',
          'date: 2026-04-18',
          '---',
          '# Legacy aria-memory record',
          '',
          'Legacy aria-memory content is searchable through rebuild-index keyword.',
          '',
        ].join('\n'),
      );
      const fabric = createMemoryFabric({ root, dbFile: join(root, 'haro.db') });
      const first = await fabric.rebuildIndex();
      const second = await fabric.rebuildIndex();

      expect(first.indexed).toBe(1);
      expect(second.indexed).toBe(1);
      const hits = fabric.queryEntries({ keyword: 'rebuild-index keyword', scope: 'platform', limit: 10 });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.entry.contentPath).toContain('legacy.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
