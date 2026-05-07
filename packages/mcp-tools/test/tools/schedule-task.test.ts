import { afterEach, describe, expect, it } from 'vitest';
import { cron as cronService } from '@haro/core/services';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('schedule_task tool [FEAT-032 R7 / AC4]', () => {
  it('creates a cron job and is visible via services.cron.listJobs', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: {
        when: '0 * * * *',
        mode: 'cron',
        taskInput: 'hourly task',
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    const jobId = out.result.value.jobId;
    expect(jobId.length).toBeGreaterThan(0);
    expect(out.result.value.mode).toBe('cron');
    const list = cronService.listJobs(e.buildDeps().serviceContext);
    expect(list.items.some((job) => job.id === jobId)).toBe(true);
    const job = cronService.getJob(e.buildDeps().serviceContext, jobId);
    expect(job.taskInput).toBe('hourly task');
  });

  it('creates a once job with a future ISO timestamp', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const future = new Date(Date.now() + 60_000).toISOString();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: { when: future, mode: 'once', taskInput: 'reminder' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.mode).toBe('once');
  });

  it('rejects past ISO timestamps with INVALID_PARAMS', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const past = new Date(Date.now() - 10_000).toISOString();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: { when: past, mode: 'once', taskInput: 'late' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects malformed cron expressions with INVALID_PARAMS', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: { when: 'not a cron', mode: 'cron', taskInput: 'x' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('accepts TZ-prefixed cron expressions', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: {
        when: 'TZ=Asia/Shanghai 0 9 * * *',
        mode: 'cron',
        taskInput: 'morning task',
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.whenExpr).toMatch(/0 9/);
  });

  it('rejects empty taskInput', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: { when: '0 * * * *', mode: 'cron', taskInput: '' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects taskInput larger than 64KB', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: {
        when: '0 * * * *',
        mode: 'cron',
        taskInput: 'x'.repeat(64 * 1024 + 1),
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });
});
