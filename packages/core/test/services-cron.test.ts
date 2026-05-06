/** FEAT-033 — services.cron parity contract for CLI + web-api. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '../src/db/init.js';
import * as cronService from '../src/services/cron.js';
import { isHaroError } from '../src/errors/index.js';

let root: string;
let dbFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'haro-services-cron-'));
  dbFile = join(root, 'haro.db');
  initHaroDatabase({ dbFile });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('services.cron', () => {
  it('createJob persists and returns a CronJobRecord with status pending', () => {
    const job = cronService.createJob(
      { root, dbFile },
      { sessionId: 's-1', mode: 'cron', when: '*/5 * * * *', taskInput: 'do thing' },
    );
    expect(job.id).toMatch(/^cron_/);
    expect(job.status).toBe('pending');
    expect(job.enabled).toBe(true);
  });

  it('listJobs filters by sessionId', () => {
    cronService.createJob({ root, dbFile }, { sessionId: 'a', mode: 'cron', when: '*/5 * * * *', taskInput: 'a1' });
    cronService.createJob({ root, dbFile }, { sessionId: 'b', mode: 'cron', when: '*/5 * * * *', taskInput: 'b1' });
    cronService.createJob({ root, dbFile }, { sessionId: 'a', mode: 'cron', when: '*/5 * * * *', taskInput: 'a2' });
    const result = cronService.listJobs({ root, dbFile }, { sessionId: 'a' });
    expect(result.count).toBe(2);
    for (const item of result.items) expect(item.sessionId).toBe('a');
  });

  it('getJob throws CRON_JOB_NOT_FOUND for missing id', () => {
    let err: unknown;
    try {
      cronService.getJob({ root, dbFile }, 'nope');
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_JOB_NOT_FOUND');
  });

  it('cancelJob disables and frees quota', async () => {
    const job = cronService.createJob(
      { root, dbFile },
      { sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' },
    );
    const cancelled = await cronService.cancelJob({ root, dbFile }, job.id);
    expect(cancelled.enabled).toBe(false);
    expect(cancelled.status).toBe('cancelled');
    const list = cronService.listJobs({ root, dbFile }, { enabled: false });
    expect(list.items.map((j) => j.id)).toContain(job.id);
  });

  it('triggerJob brings next_run_at to now and returns updated record', () => {
    const job = cronService.createJob(
      { root, dbFile },
      { sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' },
    );
    const before = job.nextRunAt!;
    const triggered = cronService.triggerJob({ root, dbFile }, job.id);
    expect(triggered.nextRunAt!).toBeLessThanOrEqual(Date.now());
    expect(triggered.nextRunAt!).toBeLessThan(before);
  });

  it('createJob propagates CRON_FREQUENCY_TOO_HIGH from manager', () => {
    let err: unknown;
    try {
      cronService.createJob(
        { root, dbFile },
        { sessionId: 's', mode: 'cron', when: '* * * * * *', taskInput: 't' },
      );
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_FREQUENCY_TOO_HIGH');
  });
});
