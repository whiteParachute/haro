/** FEAT-033 — CronManager CRUD + quota + once-in-past + cancel/trigger. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '../src/db/init.js';
import { CronManager } from '../src/cron/manager.js';
import { CronStorage } from '../src/cron/storage.js';
import { resetInflightForTest } from '../src/cron/inflight.js';
import { isHaroError } from '../src/errors/index.js';

let root: string;
let dbFile: string;
let manager: CronManager;
let storage: CronStorage;
const FIXED_NOW = Date.UTC(2026, 4, 2, 12, 0, 0);

beforeEach(() => {
  resetInflightForTest();
  root = mkdtempSync(join(tmpdir(), 'haro-cron-mgr-'));
  dbFile = join(root, 'haro.db');
  initHaroDatabase({ dbFile });
  storage = new CronStorage({ dbFile });
  manager = new CronManager({
    storage,
    now: () => FIXED_NOW,
    createId: createIdFactory(),
  });
});

afterEach(() => {
  manager.close();
  storage.close();
  resetInflightForTest();
  rmSync(root, { recursive: true, force: true });
});

describe('CronManager.create', () => {
  it('creates a cron job and computes next_run_at in the future', () => {
    const job = manager.create({
      sessionId: 's-1',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 'do thing',
    });
    expect(job.status).toBe('pending');
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).not.toBeNull();
    expect(job.nextRunAt!).toBeGreaterThan(FIXED_NOW);
  });

  it('creates a once job with a future ISO timestamp', () => {
    const future = new Date(FIXED_NOW + 60_000).toISOString();
    const job = manager.create({
      sessionId: 's-1',
      mode: 'once',
      when: future,
      taskInput: 'reminder',
    });
    expect(job.mode).toBe('once');
    expect(job.nextRunAt).toBe(Date.parse(future));
  });

  it('rejects sub-minute cron with CRON_FREQUENCY_TOO_HIGH', () => {
    let err: unknown;
    try {
      manager.create({ sessionId: 's-1', mode: 'cron', when: '* * * * * *', taskInput: 't' });
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_FREQUENCY_TOO_HIGH');
  });

  it('rejects once timestamp in the past with CRON_ONCE_IN_PAST', () => {
    const past = new Date(FIXED_NOW - 60_000).toISOString();
    let err: unknown;
    try {
      manager.create({ sessionId: 's-1', mode: 'once', when: past, taskInput: 't' });
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_ONCE_IN_PAST');
  });

  it('enforces per-session quota — 51st create fails with CRON_QUOTA_EXCEEDED', () => {
    const q = 50;
    const local = new CronManager({
      storage,
      now: () => FIXED_NOW,
      createId: createIdFactory('quota'),
      quotaPerSession: q,
    });
    try {
      for (let i = 0; i < q; i++) {
        local.create({ sessionId: 's-quota', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
      }
      let err: unknown;
      try {
        local.create({ sessionId: 's-quota', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
      } catch (e) {
        err = e;
      }
      expect(isHaroError(err)).toBe(true);
      if (isHaroError(err)) expect(err.code).toBe('CRON_QUOTA_EXCEEDED');
    } finally {
      local.close();
    }
  });

  it('rejects oversized taskInput', () => {
    const big = 'x'.repeat(64 * 1024 + 1);
    expect(() =>
      manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: big }),
    ).toThrowError(/CRON_TASK_INPUT_TOO_LARGE|exceeds/);
  });

  it('rejects ambiguous once timestamps without explicit offset (regression for codex review #2)', () => {
    const cases = [
      '05/15/2026',                       // US locale form
      '2026-05-15',                       // date-only
      '2026-05-15T09:00:00',              // naked, no offset
      '2026-05-15 09:00:00+08:00',        // space separator
      'tomorrow at noon',                  // free text
    ];
    for (const when of cases) {
      let err: unknown;
      try {
        manager.create({ sessionId: 's-iso', mode: 'once', when, taskInput: 't' });
      } catch (e) {
        err = e;
      }
      expect(isHaroError(err)).toBe(true);
      if (isHaroError(err)) expect(err.code).toBe('CRON_INVALID_EXPRESSION');
    }
  });

  it('accepts strict ISO-8601 once timestamps with Z or numeric offset', () => {
    const futureZ = new Date(FIXED_NOW + 60_000).toISOString();
    expect(
      manager.create({ sessionId: 's-iso', mode: 'once', when: futureZ, taskInput: 't' }).mode,
    ).toBe('once');
    // Numeric +08:00 form, well in the future
    const future = '2026-12-15T09:00:00+08:00';
    expect(
      manager.create({ sessionId: 's-iso', mode: 'once', when: future, taskInput: 't' }).mode,
    ).toBe('once');
  });

  it('normalizes missing retryPolicy to DEFAULT_RETRY_POLICY (regression for codex review #3)', () => {
    const job = manager.create({
      sessionId: 's-rp',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
    });
    expect(job.retryPolicy).toEqual({ max: 3, backoff: 'exponential' });
  });

  it('rejects malformed retryPolicy', () => {
    const cases: Array<[unknown, string]> = [
      [{ max: -1, backoff: 'exponential' }, 'negative max'],
      [{ max: 99, backoff: 'exponential' }, 'overlarge max'],
      [{ max: 1.5, backoff: 'exponential' }, 'non-integer max'],
      [{ max: 3, backoff: 'turbo' }, 'unknown backoff'],
      [{ max: 3 }, 'missing backoff'],
      ['nope', 'non-object policy'],
    ];
    for (const [retryPolicy, label] of cases) {
      let err: unknown;
      try {
        manager.create({
          sessionId: 's-rp',
          mode: 'cron',
          when: '*/5 * * * *',
          taskInput: 't',
          retryPolicy: retryPolicy as never,
        });
      } catch (e) {
        err = e;
      }
      expect(isHaroError(err), `case: ${label}`).toBe(true);
      if (isHaroError(err)) expect(err.code).toBe('INVALID_INPUT');
    }
  });

  it('quota counts active enabled jobs regardless of last status (regression for codex review #1)', async () => {
    // Create 50 jobs, then simulate the recurring lifecycle where storage marks
    // status='done' but enabled stays true and next_run_at is recomputed.
    const job1 = manager.create({
      sessionId: 's-q-recur',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
    });
    storage.setStatus(job1.id, 'done', { lastStatus: 'ok', lastRunAt: FIXED_NOW });
    // The job is still scheduled (next_run_at preserved, enabled=true) → must
    // still count against quota for the session.
    expect(storage.countActiveForSession('s-q-recur')).toBe(1);

    // Cancel it → quota frees up.
    await manager.cancel(job1.id);
    expect(storage.countActiveForSession('s-q-recur')).toBe(0);
  });
});

describe('CronManager.list / get', () => {
  it('lists by session and status', () => {
    const a = manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 'a' });
    manager.create({ sessionId: 's-2', mode: 'cron', when: '*/5 * * * *', taskInput: 'b' });
    const sOne = manager.list({ sessionId: 's-1' });
    expect(sOne).toHaveLength(1);
    expect(sOne[0]!.id).toBe(a.id);
    const pending = manager.list({ status: 'pending' });
    expect(pending).toHaveLength(2);
  });

  it('get throws CRON_JOB_NOT_FOUND for missing id', () => {
    let err: unknown;
    try {
      manager.get('nope');
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_JOB_NOT_FOUND');
  });
});

describe('CronManager.cancel / trigger', () => {
  it('cancel marks pending job as cancelled and disables it', async () => {
    const job = manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const cancelled = await manager.cancel(job.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.enabled).toBe(false);
    expect(cancelled.nextRunAt).toBeNull();
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('cancel is idempotent on already-cancelled jobs', async () => {
    const job = manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    await manager.cancel(job.id);
    await expect(manager.cancel(job.id)).resolves.toBeDefined();
  });

  it('trigger sets next_run_at to now', () => {
    const job = manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    expect(job.nextRunAt!).toBeGreaterThan(FIXED_NOW);
    const triggered = manager.trigger(job.id);
    expect(triggered.nextRunAt).toBe(FIXED_NOW);
  });

  it('trigger refuses cancelled jobs', async () => {
    const job = manager.create({ sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    await manager.cancel(job.id);
    expect(() => manager.trigger(job.id)).toThrowError(/CRON_JOB_NOT_FOUND|cancelled/);
  });

  it('cancel forces "cancelled-forced" when in-flight runner ignores abort within timeout (FEAT-033 AC5)', async () => {
    const { trackInflight, clearInflight } = await import('../src/cron/inflight.js');
    const job = manager.create({
      sessionId: 's-cf',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
    });
    // Simulate the tick host having registered an in-flight controller whose
    // runner refuses to honour the abort signal. `done` never resolves until
    // we manually flip it after the cancel timeout.
    const controller = new AbortController();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    trackInflight(job.id, { controller, done });

    // Use a tiny timeout so the test runs in milliseconds.
    const fastManager = new CronManager({
      storage,
      now: () => FIXED_NOW,
      cancelTimeoutMs: 25,
    });
    const cancelled = await fastManager.cancel(job.id);
    expect(controller.signal.aborted).toBe(true);
    expect(cancelled.status).toBe('cancelled-forced');
    expect(cancelled.lastError).toMatch(/forced abort/);

    // Now release the runner so the test cleans up cleanly.
    resolveDone();
    clearInflight(job.id);
    fastManager.close();
  });

  it('cancel returns gracefully when in-flight runner finishes within timeout', async () => {
    const { trackInflight, clearInflight } = await import('../src/cron/inflight.js');
    const job = manager.create({
      sessionId: 's-cg',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
    });
    const controller = new AbortController();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    trackInflight(job.id, { controller, done });

    // Simulate the runner completing 10ms after abort by resolving `done`.
    controller.signal.addEventListener(
      'abort',
      () => {
        setTimeout(() => {
          // Mimic what runner.markCancelled would do for a graceful abort.
          storage.setStatus(
            job.id,
            'cancelled',
            {
              enabled: false,
              cancelledAt: FIXED_NOW,
              nextRunAt: null,
              lastStatus: 'error',
              lastError: 'aborted by caller',
            },
            { requireNotCancelled: true },
          );
          resolveDone();
          clearInflight(job.id);
        }, 10);
      },
      { once: true },
    );

    const fastManager = new CronManager({
      storage,
      now: () => FIXED_NOW,
      cancelTimeoutMs: 500,
    });
    const cancelled = await fastManager.cancel(job.id);
    expect(cancelled.status).toBe('cancelled'); // graceful, not forced
    fastManager.close();
  });

  it('cancel survives concurrent quota check + insert race (FEAT-033 G7 TOCTOU)', () => {
    // Sanity-check the BEGIN IMMEDIATE wrapper: insert exactly the quota
    // ceiling and verify the ceiling+1 attempt always rejects, regardless of
    // ordering. (better-sqlite3 is single-writer so we can't truly race here,
    // but this guards against a future regression that drops the transaction.)
    const cap = 5;
    const tightManager = new CronManager({
      storage,
      now: () => FIXED_NOW,
      createId: createIdFactory('q'),
      quotaPerSession: cap,
    });
    for (let i = 0; i < cap; i++) {
      tightManager.create({ sessionId: 's-q', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    }
    let err: unknown;
    try {
      tightManager.create({ sessionId: 's-q', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) {
      expect(err.code).toBe('CRON_QUOTA_EXCEEDED');
      expect(err.message).toMatch(`already has ${cap} active`);
    }
    tightManager.close();
  });
});

function createIdFactory(prefix = 'job'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
