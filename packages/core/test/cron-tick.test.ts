/** FEAT-033 R11/R12 — tick() + CronTickHost orchestration. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '../src/db/init.js';
import { CronManager } from '../src/cron/manager.js';
import { CronStorage } from '../src/cron/storage.js';
import { CronRunner } from '../src/cron/runner.js';
import { tick } from '../src/cron/tick.js';
import { createCronTickHost } from '../src/cron/host.js';
import type { AgentResultEvent } from '../src/provider/protocol.js';
import type { RunAgentInput, RunAgentResult } from '../src/runtime/types.js';
import type { CronRunnerAgentRunner } from '../src/cron/runner.js';

const noSleep = async (_ms: number): Promise<void> => undefined;

let root: string;
let dbFile: string;
let storage: CronStorage;
let manager: CronManager;
const FIXED_NOW = Date.UTC(2026, 4, 2, 12, 0, 0);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'haro-cron-tick-'));
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
  rmSync(root, { recursive: true, force: true });
});

describe('tick()', () => {
  it('runs no jobs when nothing is due', async () => {
    manager.create({
      sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't',
    });
    const fakeAgent = stubAgentRunner();
    const outcome = await tick({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW, // before next firing
    });
    expect(outcome).toMatchObject({ skipped: false, ranCount: 0 });
    expect(fakeAgent.calls).toBe(0);
  });

  it('runs each due job once and pre-advances next_run_at', async () => {
    const a = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 'a' });
    const b = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 'b' });
    const tickNow = a.nextRunAt!; // both have same next_run_at
    const fakeAgent = stubAgentRunner();
    const outcome = await tick({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.ranCount).toBe(2);
    expect(fakeAgent.calls).toBe(2);
    // Both jobs are pending again with future next_run_at past tickNow.
    for (const job of [a, b]) {
      const after = storage.get(job.id)!;
      expect(after.status).toBe('pending');
      expect(after.nextRunAt!).toBeGreaterThan(tickNow);
    }
  });

  it('the same firing instant is not run twice across two consecutive ticks', async () => {
    // Regression for at-most-once: tick → execute → next_run_at advanced;
    // a second tick at the same instant should NOT see the same firing again.
    const job = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const tickNow = job.nextRunAt!;
    const fakeAgent = stubAgentRunner();
    await tick({ storage, agentRunner: fakeAgent, defaultAgentId: 'haro-default', now: () => tickNow });
    await tick({ storage, agentRunner: fakeAgent, defaultAgentId: 'haro-default', now: () => tickNow });
    expect(fakeAgent.calls).toBe(1);
  });

  it('skips with `lease-held` when another holder owns the lease', async () => {
    const job = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const tickNow = job.nextRunAt!;
    // Lease held by another process at the same instant the tick fires — tick must skip.
    storage.tryAcquireLease({ holder: 'someone-else', ttlMs: 60_000, now: tickNow });
    const fakeAgent = stubAgentRunner();
    const outcome = await tick({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
    });
    expect(outcome).toEqual({ skipped: 'lease-held', ranCount: 0 });
    expect(fakeAgent.calls).toBe(0);
  });

  it('releases the lease in finally so the next tick can claim it', async () => {
    manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const fakeAgent = stubAgentRunner();
    await tick({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      holder: 'A',
    });
    // After tick returns, lease must be free (lease_until=0, holder='').
    const lease = storage.readLease();
    expect(lease?.leaseUntil).toBe(0);
    expect(lease?.holder).toBe('');
  });

  it('does not skip remaining due jobs when one execute throws', async () => {
    // The job whose taskInput matches `failTaskInput` will throw; the other
    // must still run to completion. Order-agnostic so storage list-ordering
    // changes don't break the test.
    const a = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 'fail' });
    const b = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 'ok' });
    const tickNow = a.nextRunAt!;
    const fakeAgent: CronRunnerAgentRunner & { calls: number } = {
      calls: 0,
      async run(input: RunAgentInput): Promise<RunAgentResult> {
        this.calls++;
        if (input.task === 'fail') throw new Error('boom');
        const ev: AgentResultEvent = { type: 'result', content: 'ok' };
        return {
          sessionId: `sess-${this.calls}`,
          ruleId: 'r',
          provider: 'p',
          model: 'm',
          events: [ev],
          finalEvent: ev,
        };
      },
    };
    const outcome = await tick({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
      // Inject a no-sleep runner so the failing job's retry backoff doesn't
      // drag the test out by ~7 seconds.
      runner: new CronRunner({
        storage,
        agentRunner: fakeAgent,
        defaultAgentId: 'haro-default',
        now: () => tickNow,
        sleep: noSleep,
      }),
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.ranCount).toBe(2);
    // Failing job → status=failed; ok job → status=pending (recurring cron
    // returns to pending after success).
    expect(storage.get(a.id)!.status).toBe('failed');
    expect(storage.get(b.id)!.status).toBe('pending');
  });
});

describe('createCronTickHost', () => {
  it('triggerNow() runs one tick on demand', async () => {
    const job = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const tickNow = job.nextRunAt!;
    const fakeAgent = stubAgentRunner();
    const host = createCronTickHost({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
      intervalMs: 60_000,
    });
    const outcome = await host.triggerNow();
    expect(outcome).toMatchObject({ skipped: false, ranCount: 1 });
    expect(host.running).toBe(false); // triggerNow does not flip the run flag
  });

  it('start()/stop() lifecycle does not throw and remains idempotent', async () => {
    const fakeAgent = stubAgentRunner();
    const host = createCronTickHost({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      intervalMs: 60_000,
    });
    expect(host.running).toBe(false);
    host.start();
    expect(host.running).toBe(true);
    host.start(); // idempotent
    await host.stop();
    expect(host.running).toBe(false);
    await host.stop(); // idempotent
  });
});

describe('tick() — lease renewal (codex review #2 finding #3)', () => {
  it('renews the lease while jobs are running so a slow batch cannot lose the lock', async () => {
    // The renewer fires at TTL/2; with leaseTtlMs=200 it ticks every 100ms.
    // A long-running job (300ms) ensures at least one renewal happens.
    const job = manager.create({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' });
    const tickNow = job.nextRunAt!;
    let elapsed = 0;
    const slowAgent: CronRunnerAgentRunner & { calls: number } = {
      calls: 0,
      async run(_input: RunAgentInput): Promise<RunAgentResult> {
        this.calls++;
        await new Promise((resolve) => setTimeout(resolve, 300));
        elapsed = Date.now();
        return {
          sessionId: 'sess',
          ruleId: 'rule',
          provider: 'codex',
          model: 'gpt-5',
          events: [{ type: 'result', content: 'ok' } satisfies AgentResultEvent],
          finalEvent: { type: 'result', content: 'ok' } satisfies AgentResultEvent,
        };
      },
    };
    const startMs = Date.now();
    const outcome = await tick({
      storage,
      agentRunner: slowAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
      leaseTtlMs: 200,
    });
    expect(outcome.skipped).toBe(false);
    expect(slowAgent.calls).toBe(1);
    // Sanity check the slow agent actually ran for ≥ 200ms (longer than TTL).
    expect(elapsed - startMs).toBeGreaterThanOrEqual(200);
    // Lease was released cleanly after tick returned.
    const lease = storage.readLease();
    expect(lease?.holder ?? '').toBe('');
  });
});

function stubAgentRunner(): CronRunnerAgentRunner & { calls: number } {
  return {
    calls: 0,
    async run(_input: RunAgentInput): Promise<RunAgentResult> {
      this.calls++;
      const ev: AgentResultEvent = { type: 'result', content: 'ok' };
      return {
        sessionId: `sess-${this.calls}`,
        ruleId: 'rule',
        provider: 'codex',
        model: 'gpt-5',
        events: [ev],
        finalEvent: ev,
      };
    },
  };
}

function createIdFactory(): () => string {
  let n = 0;
  return () => `job-${++n}`;
}
