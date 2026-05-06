/** FEAT-033 — CronRunner execution lifecycle (advance, retry, cancel). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '../src/db/init.js';
import { CronManager } from '../src/cron/manager.js';
import { CronRunner } from '../src/cron/runner.js';
import { CronStorage } from '../src/cron/storage.js';
import { resetInflightForTest } from '../src/cron/inflight.js';
import type { CronRunnerAgentRunner } from '../src/cron/runner.js';
import type { CronJobRecord } from '../src/cron/types.js';
import type {
  AgentErrorEvent,
  AgentResultEvent,
} from '../src/provider/protocol.js';
import type { RunAgentInput, RunAgentResult } from '../src/runtime/types.js';

let root: string;
let dbFile: string;
let storage: CronStorage;
let manager: CronManager;
const FIXED_NOW = Date.UTC(2026, 4, 2, 12, 0, 0);

beforeEach(() => {
  resetInflightForTest();
  root = mkdtempSync(join(tmpdir(), 'haro-cron-runner-'));
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

describe('CronRunner.execute — once mode', () => {
  it('runs once job, marks done + disabled + clears next_run_at on success', async () => {
    const job = createOnce('s-1', 'do once');
    const fakeAgent = stubAgentRunner({ result: { type: 'result', content: 'ok' } });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job);
    expect(outcome.status).toBe('done');
    expect(outcome.attempts).toBe(1);
    const after = storage.get(job.id)!;
    expect(after.status).toBe('done');
    expect(after.enabled).toBe(false);
    expect(after.nextRunAt).toBeNull();
    expect(after.lastStatus).toBe('ok');
    expect(after.lastRunAt).toBe(FIXED_NOW);
  });

  it('marks failed when agent returns non-retryable error and exhausts no retries', async () => {
    const job = createOnce('s-1', 't');
    const fakeAgent = stubAgentRunner({
      result: { type: 'error', code: 'auth_error', message: 'bad token', retryable: false },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job);
    expect(outcome.status).toBe('failed');
    expect(outcome.finalErrorCode).toBe('auth_error');
    expect(fakeAgent.calls).toBe(1);
    const after = storage.get(job.id)!;
    expect(after.status).toBe('failed');
    expect(after.lastStatus).toBe('error');
    expect(after.lastError).toMatch(/auth_error/);
  });
});

describe('CronRunner.execute — retry policy', () => {
  it('retries retryable errors up to retryPolicy.max times', async () => {
    const job = createOnce('s-1', 't', {
      retryPolicy: { max: 2, backoff: 'exponential' },
    });
    const fakeAgent = stubAgentRunner({
      result: { type: 'error', code: 'rate_limit', message: '429', retryable: true },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job);
    expect(outcome.status).toBe('failed');
    // max=2 → 1 try + 2 retries = 3 attempts total
    expect(fakeAgent.calls).toBe(3);
    expect(outcome.attempts).toBe(3);
  });

  it('returns success on a later retry without consuming remaining attempts', async () => {
    const job = createOnce('s-1', 't', {
      retryPolicy: { max: 3, backoff: 'fixed' },
    });
    const sequence: Array<AgentResultEvent | AgentErrorEvent> = [
      { type: 'error', code: 'rate_limit', message: '429', retryable: true },
      { type: 'error', code: 'rate_limit', message: '429', retryable: true },
      { type: 'result', content: 'finally ok' },
    ];
    const fakeAgent = stubSequencedAgentRunner(sequence);
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job);
    expect(outcome.status).toBe('done');
    expect(fakeAgent.calls).toBe(3);
  });

  it('exponential backoff produces 1s/2s/4s delays in attempt order', async () => {
    const job = createOnce('s-1', 't', {
      retryPolicy: { max: 3, backoff: 'exponential' },
    });
    const slept: number[] = [];
    const fakeAgent = stubAgentRunner({
      result: { type: 'error', code: 'rate_limit', message: '429', retryable: true },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await runner.execute(job);
    // first attempt has no preceding sleep; retries 1/2/3 sleep 1000/2000/4000.
    expect(slept).toEqual([1_000, 2_000, 4_000]);
  });
});

describe('CronRunner.execute — at-most-once advance_next_run', () => {
  it('cron mode pre-advances next_run_at before invoking AgentRunner', async () => {
    // Create at FIXED_NOW (initial next_run_at = 12:05). Simulate tick firing
    // at 12:05 — runner now must compute the next firing strictly *after*
    // 12:05, i.e. 12:10.
    const job = manager.create({
      sessionId: 's-1',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 'every 5',
    });
    const initialNext = job.nextRunAt!;
    const tickNow = initialNext; // tick fires at the scheduled instant
    const seenNextDuringRun: Array<number | null> = [];
    const fakeAgent = stubAgentRunner({
      result: { type: 'result', content: 'ok' },
      onCall: () => {
        // Inspect storage at the moment AgentRunner.run starts.
        seenNextDuringRun.push(storage.get(job.id)!.nextRunAt);
      },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => tickNow,
      sleep: noSleep,
    });
    await runner.execute(storage.get(job.id)!);
    expect(seenNextDuringRun).toHaveLength(1);
    // next_run_at must already be advanced past the firing that just
    // triggered this tick (at-most-once: never re-fire the same instant).
    expect(seenNextDuringRun[0]!).toBeGreaterThan(initialNext);
  });

  it('once mode pre-clears next_run_at to null', async () => {
    const job = createOnce('s-1', 't');
    const seen: Array<number | null> = [];
    const fakeAgent = stubAgentRunner({
      result: { type: 'result', content: 'ok' },
      onCall: () => {
        seen.push(storage.get(job.id)!.nextRunAt);
      },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    await runner.execute(job);
    expect(seen[0]).toBeNull();
  });

  it('cron mode after success returns to status=pending so next tick picks it up', async () => {
    const job = manager.create({
      sessionId: 's-1',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 'every 5',
    });
    const fakeAgent = stubAgentRunner({ result: { type: 'result', content: 'ok' } });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    await runner.execute(storage.get(job.id)!);
    const after = storage.get(job.id)!;
    expect(after.status).toBe('pending');
    expect(after.enabled).toBe(true);
    expect(after.nextRunAt).not.toBeNull();
    expect(after.nextRunAt!).toBeGreaterThan(FIXED_NOW);
  });
});

describe('CronRunner.execute — abort', () => {
  it('aborted before first attempt → cancelled (no agent call)', async () => {
    // FEAT-033 R10: when the runner sees an abort signal it always marks
    // `cancelled` (graceful). `cancelled-forced` is reserved for the
    // CronManager.cancel() 30s-timeout escape hatch.
    const job = createOnce('s-1', 't');
    const fakeAgent = stubAgentRunner({ result: { type: 'result', content: 'ok' } });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await runner.execute(job, ctrl.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fakeAgent.calls).toBe(0);
  });

  it('abort signal propagated to AgentRunner returns cancelled (graceful)', async () => {
    const job = createOnce('s-1', 't');
    const ctrl = new AbortController();
    const fakeAgent: CronRunnerAgentRunner & { calls: number } = {
      calls: 0,
      async run(input: RunAgentInput): Promise<RunAgentResult> {
        this.calls++;
        // Simulate the AgentRunner observing the abort and emitting `aborted`.
        ctrl.abort();
        const aborted: AgentErrorEvent = {
          type: 'error',
          code: 'aborted',
          message: 'abort',
          retryable: false,
        };
        return {
          sessionId: 'sess',
          ruleId: 'r',
          provider: 'p',
          model: 'm',
          events: [aborted],
          finalEvent: aborted,
        };
      },
    };
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job, ctrl.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fakeAgent.calls).toBe(1);
    const after = storage.get(job.id)!;
    expect(after.enabled).toBe(false);
    expect(after.cancelledAt).toBe(FIXED_NOW);
  });
});

describe('CronRunner — cancel-during-execute (codex review #3)', () => {
  it('runner mark cannot resurrect a cancelled row even on a successful run', async () => {
    // Regression for codex review #3: previously cancel() preserved
    // status='running' for in-flight rows, so a runner that finished with
    // markSuccess() would write status='pending' over the cancel intent
    // because the requireNotCancelled guard saw 'running' (not cancelled).
    const job = manager.create({
      sessionId: 's-rec',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
    });
    // Mark the row as if a runner had set 'running'.
    storage.setStatus(job.id, 'running', { lastRunAt: FIXED_NOW });
    // Then a concurrent cancel lands.
    storage.setStatus(job.id, 'cancelled', {
      enabled: false,
      cancelledAt: FIXED_NOW,
      nextRunAt: null,
    });
    // Now simulate a runner trying to mark success post-cancel via the same
    // guarded SQL path the runner uses. It must NOT overwrite.
    const wrote = storage.setStatus(
      job.id,
      'pending',
      { lastStatus: 'ok', lastError: null },
      { requireNotCancelled: true },
    );
    expect(wrote).toBe(false);
    expect(storage.get(job.id)!.status).toBe('cancelled');
  });

  it('runner.execute() bails when row is already cancelled at entry', async () => {
    const job = createOnce('s-pre', 't');
    // Cancel before runner picks it up.
    storage.setStatus(job.id, 'cancelled', {
      enabled: false,
      cancelledAt: FIXED_NOW,
      nextRunAt: null,
    });
    const fakeAgent = stubAgentRunner({ result: { type: 'result', content: 'ok' } });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    const outcome = await runner.execute(job);
    expect(outcome.status).toBe('cancelled');
    expect(fakeAgent.calls).toBe(0);
    // Row state remains cancelled / disabled / next_run_at=null.
    const after = storage.get(job.id)!;
    expect(after.status).toBe('cancelled');
    expect(after.enabled).toBe(false);
    expect(after.nextRunAt).toBeNull();
  });
});

describe('CronRunner — runtime guards (codex review #2)', () => {
  it('passes continueFromSessionId so the agent reuses the cron job session (FEAT-033 R5/G2)', async () => {
    const job = createOnce('sess-pinned', 't');
    const captured: RunAgentInput[] = [];
    const fakeAgent: CronRunnerAgentRunner & { calls: number } = {
      calls: 0,
      async run(input: RunAgentInput): Promise<RunAgentResult> {
        this.calls++;
        captured.push(input);
        return {
          sessionId: 'sess-pinned',
          ruleId: 'rule',
          provider: 'codex',
          model: 'gpt-5',
          events: [],
          finalEvent: { type: 'result', content: 'ok' } satisfies AgentResultEvent,
        };
      },
    };
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: noSleep,
    });
    await runner.execute(job);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.continueFromSessionId).toBe('sess-pinned');
  });

  it('caps exponential backoff at 5 minutes (codex review #2 finding #6)', async () => {
    // max=20 means attempt 20 → base * 2^19 = ~524288s without the cap.
    // The cap forces all delays to be ≤ 5 minutes (300_000ms). With noSleep,
    // we just assert the runner doesn't hang and that all retries fire.
    const job = manager.create({
      sessionId: 's-cap',
      mode: 'cron',
      when: '*/5 * * * *',
      taskInput: 't',
      retryPolicy: { max: 16, backoff: 'exponential' },
    });
    const sleepArgs: number[] = [];
    const sleepCapture = async (ms: number): Promise<void> => {
      sleepArgs.push(ms);
    };
    const fakeAgent = stubAgentRunner({
      result: { type: 'error', code: 'transient', message: 'flaky', retryable: true },
    });
    const runner = new CronRunner({
      storage,
      agentRunner: fakeAgent,
      defaultAgentId: 'haro-default',
      now: () => FIXED_NOW,
      sleep: sleepCapture,
    });
    await runner.execute(job);
    expect(fakeAgent.calls).toBeGreaterThanOrEqual(2);
    // Every recorded delay must be at or below 5 minutes (the cap), not the
    // raw exponential 2^n which would be hours for high attempts.
    for (const ms of sleepArgs) {
      expect(ms).toBeLessThanOrEqual(5 * 60_000);
    }
  });
});

function createOnce(
  sessionId: string,
  taskInput: string,
  extra: { retryPolicy?: { max: number; backoff: 'exponential' | 'linear' | 'fixed' } } = {},
): CronJobRecord {
  const future = new Date(FIXED_NOW + 60_000).toISOString();
  return manager.create({
    sessionId,
    mode: 'once',
    when: future,
    taskInput,
    ...(extra.retryPolicy ? { retryPolicy: extra.retryPolicy } : {}),
  });
}

interface StubResultOptions {
  result: AgentResultEvent | AgentErrorEvent;
  onCall?: () => void;
}

function stubAgentRunner(opts: StubResultOptions): CronRunnerAgentRunner & { calls: number } {
  return {
    calls: 0,
    async run(input: RunAgentInput): Promise<RunAgentResult> {
      this.calls++;
      opts.onCall?.();
      return {
        sessionId: `sess-${this.calls}`,
        ruleId: 'rule',
        provider: 'codex',
        model: 'gpt-5',
        events: [opts.result],
        finalEvent: opts.result,
      };
    },
  };
}

function stubSequencedAgentRunner(
  sequence: Array<AgentResultEvent | AgentErrorEvent>,
): CronRunnerAgentRunner & { calls: number } {
  return {
    calls: 0,
    async run(_input: RunAgentInput): Promise<RunAgentResult> {
      const event = sequence[this.calls] ?? sequence[sequence.length - 1]!;
      this.calls++;
      return {
        sessionId: `sess-${this.calls}`,
        ruleId: 'rule',
        provider: 'codex',
        model: 'gpt-5',
        events: [event],
        finalEvent: event,
      };
    },
  };
}

function createIdFactory(): () => string {
  let n = 0;
  return () => `job-${++n}`;
}

const noSleep = async (_ms: number): Promise<void> => undefined;
