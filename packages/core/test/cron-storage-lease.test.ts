/** FEAT-033 R11 — cross-process tick lease lock semantics. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '../src/db/init.js';
import { CronStorage } from '../src/cron/storage.js';

let root: string;
let dbFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'haro-cron-lease-'));
  dbFile = join(root, 'haro.db');
  initHaroDatabase({ dbFile });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('CronStorage lease', () => {
  it('first acquirer wins; second is blocked while lease is fresh', () => {
    const a = new CronStorage({ dbFile });
    const b = new CronStorage({ dbFile });
    try {
      const t = 1_000_000;
      expect(a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t })).toBe(true);
      expect(b.tryAcquireLease({ holder: 'B', ttlMs: 60_000, now: t + 100 })).toBe(false);
    } finally {
      a.close();
      b.close();
    }
  });

  it('expired lease can be reclaimed', () => {
    const a = new CronStorage({ dbFile });
    const b = new CronStorage({ dbFile });
    try {
      const t0 = 1_000_000;
      expect(a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t0 })).toBe(true);
      const tFuture = t0 + 60_001;
      expect(b.tryAcquireLease({ holder: 'B', ttlMs: 60_000, now: tFuture })).toBe(true);
      const lease = b.readLease();
      expect(lease?.holder).toBe('B');
    } finally {
      a.close();
      b.close();
    }
  });

  it('same holder can re-acquire (idempotent)', () => {
    const a = new CronStorage({ dbFile });
    try {
      const t = 1_000_000;
      expect(a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t })).toBe(true);
      expect(a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t + 1000 })).toBe(true);
    } finally {
      a.close();
    }
  });

  it('renewLease succeeds for current holder, fails for stranger', () => {
    const a = new CronStorage({ dbFile });
    try {
      const t = 1_000_000;
      a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t });
      expect(a.renewLease({ holder: 'A', ttlMs: 60_000, now: t + 30_000 })).toBe(true);
      expect(a.renewLease({ holder: 'X', ttlMs: 60_000, now: t + 30_000 })).toBe(false);
    } finally {
      a.close();
    }
  });

  it('release frees the lease for others', () => {
    const a = new CronStorage({ dbFile });
    const b = new CronStorage({ dbFile });
    try {
      const t = 1_000_000;
      a.tryAcquireLease({ holder: 'A', ttlMs: 60_000, now: t });
      a.releaseLease('A');
      expect(b.tryAcquireLease({ holder: 'B', ttlMs: 60_000, now: t + 1 })).toBe(true);
    } finally {
      a.close();
      b.close();
    }
  });
});
