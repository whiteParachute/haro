import { createHash } from 'node:crypto';
import type { MemoryQueryHit } from './types.js';

export interface IndexRecord {
  key: string;
  scope: 'platform' | 'agent' | 'shared';
  agentId?: string;
  summary: string;
  content: string;
  sourceFile: string;
  source: string;
  tier: MemoryQueryHit['tier'];
  date?: string;
  tags: readonly string[];
  writtenAt: number;
}

/**
 * In-memory search structure powering R2/R4 (same-session visibility). Not a
 * fuzzy search — just a tokenized multiset that treats each word-like token as
 * an indexable term. Phase 1 replaces this with SQLite FTS5; the interface is
 * kept narrow so the swap stays invisible to callers.
 */
export class MemoryIndex {
  private records = new Map<string, IndexRecord>();
  /** Tokens derived from both summary and content. */
  private tokenMap = new Map<string, Set<string>>();

  upsert(record: IndexRecord): void {
    const previous = this.records.get(record.key);
    if (previous) this.removeTokens(previous);
    this.records.set(record.key, record);
    this.addTokens(record);
  }

  remove(key: string): void {
    const existing = this.records.get(key);
    if (!existing) return;
    this.removeTokens(existing);
    this.records.delete(key);
  }

  list(): readonly IndexRecord[] {
    return Array.from(this.records.values());
  }

  size(): number {
    return this.records.size;
  }

  search(
    query: string,
    opts: { scope?: IndexRecord['scope']; agentId?: string; limit?: number; tiers?: readonly IndexRecord['tier'][] } = {},
  ): IndexRecord[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const hits = new Map<string, { record: IndexRecord; score: number }>();
    for (const token of tokens) {
      const keys = this.tokenMap.get(token);
      if (!keys) continue;
      for (const key of keys) {
        const record = this.records.get(key);
        if (!record) continue;
        if (opts.scope && record.scope !== opts.scope) continue;
        if (opts.agentId && record.agentId !== opts.agentId) continue;
        if (opts.tiers && !opts.tiers.includes(record.tier)) continue;
        const prev = hits.get(key);
        if (prev) prev.score += 1;
        else hits.set(key, { record, score: 1 });
      }
    }
    const ranked = Array.from(hits.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.record.writtenAt - a.record.writtenAt;
    });
    const limit = opts.limit ?? 20;
    return ranked.slice(0, limit).map((r) => r.record);
  }

  private addTokens(record: IndexRecord): void {
    const text = `${record.summary}\n${record.content}\n${(record.tags ?? []).join(' ')}`;
    for (const token of new Set(tokenize(text))) {
      let set = this.tokenMap.get(token);
      if (!set) {
        set = new Set();
        this.tokenMap.set(token, set);
      }
      set.add(record.key);
    }
  }

  private removeTokens(record: IndexRecord): void {
    const text = `${record.summary}\n${record.content}\n${(record.tags ?? []).join(' ')}`;
    for (const token of new Set(tokenize(text))) {
      const set = this.tokenMap.get(token);
      if (!set) continue;
      set.delete(record.key);
      if (set.size === 0) this.tokenMap.delete(token);
    }
  }
}

const TOKEN_SPLIT = /[^\p{L}\p{N}_]+/u;
const CJK_CHAR = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff]/u;

/**
 * Tokenize text for indexing. Splits on whitespace/punctuation for Latin-ish
 * inputs, and additionally emits character 2-grams for any CJK-bearing chunk
 * so queries like "偏爱简洁" still hit records containing "用户偏爱简洁回答".
 * Without the bigram pass a single unbroken CJK phrase would collapse into one
 * opaque token and queries would silently miss (observed in AC1/AC2/AC4).
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const chunks = text.toLowerCase().split(TOKEN_SPLIT);
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (chunk.length >= 2) out.add(chunk);
    if (CJK_CHAR.test(chunk)) {
      const codepoints = Array.from(chunk);
      for (let i = 0; i < codepoints.length - 1; i += 1) {
        const bigram = codepoints[i]! + codepoints[i + 1]!;
        out.add(bigram);
      }
    }
  }
  return Array.from(out);
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
