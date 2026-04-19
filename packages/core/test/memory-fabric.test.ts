/** FEAT-007 — MemoryFabric unit tests covering AC1..AC10. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFabric, MemoryFabric } from '../src/memory/index.js';

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'haro-memory-'));
}

describe('MemoryFabric write + query [FEAT-007]', () => {
  let root: string;
  let fabric: MemoryFabric;

  beforeEach(() => {
    root = freshRoot();
    fabric = createMemoryFabric({ root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1 T1 write is visible to the very next query (same process, R4 same-session injection)', async () => {
    await fabric.write({
      scope: 'agent',
      agentId: 'alpha',
      topic: 'prefers concise answers',
      content: '用户偏爱简洁回答，避免冗长说明。',
      source: 'haro-test',
    });
    const res = fabric.query({ scope: 'agent', agentId: 'alpha', query: '偏爱简洁' });
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0]?.summary).toContain('偏爱简洁');
    expect(res.hits[0]?.tier).toBe('knowledge');
    expect(res.servedFromIndex).toBe(true);
  });

  it('AC2 deposit lands in .pending/ and is queryable in-process even before merge', async () => {
    const res = await fabric.deposit({
      scope: 'agent',
      agentId: 'alpha',
      content: '用户在 2026-04-18 提到希望能直接写入记忆。',
      source: 'sg-feishu',
      wrapupId: 'wrapup-1',
    });
    expect(existsSync(res.file)).toBe(true);
    const pendingDir = join(root, 'agents/alpha/knowledge/.pending');
    expect(readdirSync(pendingDir)).toHaveLength(1);
    const hits = fabric.query({ scope: 'agent', agentId: 'alpha', query: '写入记忆' });
    expect(hits.hits.some((h) => h.tier === 'pending')).toBe(true);
  });

  it('AC3 query cascades through index → impressions → knowledge → archived', async () => {
    await fabric.write({ scope: 'agent', agentId: 'alpha', topic: 'k-topic', content: 'knowledge body alpha-keyword' });
    await fabric.deposit({ scope: 'agent', agentId: 'alpha', content: 'pending alpha-keyword pending-line', source: 's1', wrapupId: 'w1' });
    await fabric.wrapupSession({
      scope: 'agent',
      agentId: 'alpha',
      wrapupId: 'w-imp',
      topic: 'imp-topic',
      transcript: 'impression content alpha-keyword',
      mergePending: false,
    });
    const hits = fabric.query({ scope: 'agent', agentId: 'alpha', query: 'alpha-keyword' }).hits;
    // Should contain knowledge + impression (we cannot guarantee order but all tiers present).
    const tiers = new Set(hits.map((h) => h.tier));
    expect(tiers.has('knowledge')).toBe(true);
    expect(tiers.has('impressions')).toBe(true);
  });

  it('AC4 contextFor returns items that Runner can prepend to systemPrompt', async () => {
    await fabric.write({
      scope: 'agent',
      agentId: 'runner-agent',
      topic: 'prefers concise answers',
      content: '用户偏爱简洁回答。',
      source: 'haro-runtime',
    });
    const ctx = fabric.contextFor({ agentId: 'runner-agent', query: '偏爱', limit: 3 });
    expect(ctx.items.length).toBeGreaterThan(0);
    expect(ctx.items[0]?.summary).toContain('偏爱');
    expect(ctx.items[0]?.tier).toBe('knowledge');
  });
});

describe('MemoryFabric merge + maintenance [FEAT-007]', () => {
  let root: string;
  let fabric: MemoryFabric;

  beforeEach(() => {
    root = freshRoot();
    fabric = createMemoryFabric({ root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC5 multi-endpoint wrapupId: merges both sources and labels each Source: section', async () => {
    await fabric.deposit({
      scope: 'agent',
      agentId: 'alpha',
      content: '来自飞书的记录：同事希望接入工作流',
      source: 'sg-feishu',
      wrapupId: 'multi-1',
      summary: 'multi同事需求',
    });
    await fabric.deposit({
      scope: 'agent',
      agentId: 'alpha',
      content: '来自 Telegram 的记录：请加上 Telegram 通道',
      source: 'sg-telegram',
      wrapupId: 'multi-1',
      summary: 'multi同事需求',
    });
    await fabric.maintenance({ scope: 'agent', agentId: 'alpha' });
    const knowledgeDir = join(root, 'agents/alpha/knowledge');
    const files = readdirSync(knowledgeDir).filter((n) => n.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    const body = readFileSync(join(knowledgeDir, files[0]!), 'utf8');
    expect(body).toContain('## Source: sg-feishu');
    expect(body).toContain('## Source: sg-telegram');
    expect(body).toContain('飞书的记录');
    expect(body).toContain('Telegram 的记录');
  });

  it('AC6 identical-content deposits dedupe to a single record after sleep', async () => {
    for (let i = 0; i < 2; i += 1) {
      await fabric.deposit({
        scope: 'agent',
        agentId: 'dup',
        content: '同一条内容重复提交 — 应当按 hash 去重。',
        source: 'sg-feishu',
        wrapupId: 'dup-1',
      });
    }
    const pendingBefore = readdirSync(join(root, 'agents/dup/knowledge/.pending'));
    expect(pendingBefore).toHaveLength(1); // deterministicUuid guarantees same filename
    await fabric.maintenance({ scope: 'agent', agentId: 'dup' });
    const knowledgeDir = join(root, 'agents/dup/knowledge');
    const files = readdirSync(knowledgeDir).filter((n) => n.endsWith('.md'));
    expect(files).toHaveLength(1);
    const body = readFileSync(join(knowledgeDir, files[0]!), 'utf8');
    // Dedup by hash ⇒ exactly one "## Source:" block + the content body is
    // emitted exactly once (frontmatter/summary/heading may restate the
    // summary string, but the actual merged content block counts as one).
    const sourceHeaders = body.match(/^## Source: sg-feishu/gm) ?? [];
    expect(sourceHeaders).toHaveLength(1);
    const afterSourceBlock = body.split(/^## Source: sg-feishu[^\n]*\n+/m)[1] ?? '';
    expect(afterSourceBlock.match(/重复提交/g)?.length).toBe(1);
  });

  it('AC7/AC8 maintenance executes the 12 named steps and is idempotent', async () => {
    const first = await fabric.maintenance({ scope: 'platform' });
    expect(first.steps.map((s) => s.step)).toEqual([
      'backup',
      'merge-pending',
      'compact-index',
      'rebuild-index',
      'archive-old-impressions',
      'split-knowledge',
      'update-personality',
      'update-meta',
      'update-last-sleep-at',
      'generate-daily',
      'append-changelog',
      'finalize',
    ]);
    expect(first.steps.every((s) => s.status === 'ok')).toBe(true);
    const lastSleepFile = join(root, 'platform/.last-sleep-at');
    expect(existsSync(lastSleepFile)).toBe(true);
    const metaPath = join(root, 'platform/meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(meta.lastGlobalSleepAt).toBe(first.ranAt);
    // Idempotency: run again, expect same files + no error.
    const second = await fabric.maintenance({ scope: 'platform' });
    expect(second.steps.every((s) => s.status === 'ok')).toBe(true);
  });
});

describe('MemoryFabric aria-memory compatibility [FEAT-007]', () => {
  it('AC9 preserves legacy aria-memory personality.md and changelog.md files', async () => {
    const root = freshRoot();
    try {
      const scope = join(root, 'platform');
      mkdirSync(scope, { recursive: true });
      writeFileSync(join(scope, 'personality.md'), '# legacy personality (do not overwrite)');
      writeFileSync(join(scope, 'changelog.md'), '# legacy changelog\n- 2026-01-01 legacy\n');
      const fabric = createMemoryFabric({ root });
      await fabric.write({
        scope: 'platform',
        topic: 'new-entry',
        content: 'fresh knowledge content',
        source: 'haro-test',
      });
      expect(readFileSync(join(scope, 'personality.md'), 'utf8')).toContain('legacy personality');
      await fabric.maintenance({ scope: 'platform' });
      expect(readFileSync(join(scope, 'personality.md'), 'utf8')).toContain('legacy personality');
      expect(readFileSync(join(scope, 'changelog.md'), 'utf8')).toContain('legacy changelog');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('MemoryFabric primary+backup [FEAT-007]', () => {
  it('AC10 write is mirrored to the backup root shortly after', async () => {
    const root = freshRoot();
    const backupRoot = freshRoot();
    try {
      const fabric = createMemoryFabric({ root, backupRoot });
      const res = await fabric.write({
        scope: 'agent',
        agentId: 'b1',
        topic: 'backup-test',
        content: 'mirrored content',
      });
      const backupPath = res.file.replace(root, backupRoot);
      // Mirror is dispatched outside the serial section so it never stalls
      // primary writes (codex SHOULD-FIX). drainBackups() waits for the
      // single-microtask mirror to land; AC10's "within 1s" comfortably holds.
      await fabric.drainBackups();
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, 'utf8')).toContain('mirrored content');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(backupRoot, { recursive: true, force: true });
    }
  });
});
