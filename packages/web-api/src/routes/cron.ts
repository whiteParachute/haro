/**
 * `/api/v1/cron/*` HTTP routes (FEAT-033 §5.5 / R9).
 *
 * CRUD only — the host process triggering tick() lives outside (CLI daemon
 * or a separate `haro cron daemon` process). This route never spawns the
 * CronTickHost itself, matching the FEAT-033 G8 boundary that web-api must
 * not be required for the cron subsystem to work.
 */
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HaroError, services } from '@haro/core';
import type { CronJobMode, CronJobStatus, RetryBackoff, RetryPolicy } from '@haro/core/cron';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

interface CreateCronJobBody {
  sessionId?: string;
  agentId?: string;
  mode?: CronJobMode;
  when?: string;
  taskInput?: string;
  retryPolicy?: { max?: number; backoff?: RetryBackoff };
  metadata?: Record<string, unknown>;
}

const VALID_STATUSES: readonly CronJobStatus[] = [
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
  'cancelled-forced',
  'missed',
];

interface HaroErrorWire {
  code: string;
  message: string;
  remediation?: string;
  status: ContentfulStatusCode;
}

function unwrapHaroError(error: unknown): HaroErrorWire | null {
  if (error instanceof HaroError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.remediation ? { remediation: error.remediation } : {}),
      status: mapHaroErrorToHttpStatus(error.code),
    };
  }
  return null;
}

function mapHaroErrorToHttpStatus(code: string): ContentfulStatusCode {
  switch (code) {
    case 'CRON_JOB_NOT_FOUND':
      return 404;
    case 'CRON_QUOTA_EXCEEDED':
      return 409;
    case 'CRON_FREQUENCY_TOO_HIGH':
    case 'CRON_INVALID_EXPRESSION':
    case 'CRON_ONCE_IN_PAST':
    case 'CRON_TASK_INPUT_TOO_LARGE':
    case 'INVALID_INPUT':
      return 400;
    default:
      return 500;
  }
}

function normalizeRetryPolicy(raw: { max?: number; backoff?: RetryBackoff }): RetryPolicy {
  return {
    max: typeof raw.max === 'number' ? raw.max : 3,
    backoff: raw.backoff ?? 'exponential',
  };
}

export function createCronRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/jobs', (c) => {
    const sessionId = c.req.query('sessionId');
    const status = c.req.query('status');
    const enabled = c.req.query('enabled');
    const limit = c.req.query('limit');
    if (status && !VALID_STATUSES.includes(status as CronJobStatus)) {
      return c.json({ success: false, message: `invalid status '${status}'` }, 400);
    }
    const opts: services.cron.ListCronJobsOptions = {};
    if (sessionId) opts.sessionId = sessionId;
    if (status) opts.status = status as CronJobStatus;
    if (enabled === 'true') opts.enabled = true;
    else if (enabled === 'false') opts.enabled = false;
    if (limit) opts.limit = Number.parseInt(limit, 10);
    const result = services.cron.listJobs(ctx(), opts);
    return c.json({ success: true, data: result });
  });

  route.get('/jobs/:id', (c) => {
    try {
      const job = services.cron.getJob(ctx(), c.req.param('id'));
      return c.json({ success: true, data: job });
    } catch (error) {
      const wire = unwrapHaroError(error);
      if (wire) {
        return c.json(
          {
            success: false,
            message: wire.message,
            code: wire.code,
            ...(wire.remediation ? { remediation: wire.remediation } : {}),
          },
          wire.status,
        );
      }
      throw error;
    }
  });

  route.post('/jobs', async (c) => {
    let body: CreateCronJobBody;
    try {
      body = (await c.req.json()) as CreateCronJobBody;
    } catch {
      return c.json({ success: false, message: 'request body must be JSON' }, 400);
    }
    if (!body.sessionId || !body.taskInput || !body.mode || !body.when) {
      return c.json(
        { success: false, message: 'sessionId, taskInput, mode, when are required' },
        400,
      );
    }
    if (body.mode !== 'cron' && body.mode !== 'once') {
      return c.json({ success: false, message: `mode must be 'cron' or 'once' (got '${body.mode}')` }, 400);
    }
    try {
      const job = services.cron.createJob(ctx(), {
        sessionId: body.sessionId,
        taskInput: body.taskInput,
        mode: body.mode,
        when: body.when,
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(body.retryPolicy ? { retryPolicy: normalizeRetryPolicy(body.retryPolicy) } : {}),
        ...(body.metadata ? { metadata: body.metadata } : {}),
      });
      return c.json({ success: true, data: job }, 201);
    } catch (error) {
      const wire = unwrapHaroError(error);
      if (wire) {
        return c.json(
          {
            success: false,
            message: wire.message,
            code: wire.code,
            ...(wire.remediation ? { remediation: wire.remediation } : {}),
          },
          wire.status,
        );
      }
      throw error;
    }
  });

  route.delete('/jobs/:id', async (c) => {
    try {
      const job = await services.cron.cancelJob(ctx(), c.req.param('id'));
      return c.json({ success: true, data: job });
    } catch (error) {
      const wire = unwrapHaroError(error);
      if (wire) {
        return c.json(
          {
            success: false,
            message: wire.message,
            code: wire.code,
            ...(wire.remediation ? { remediation: wire.remediation } : {}),
          },
          wire.status,
        );
      }
      throw error;
    }
  });

  route.post('/jobs/:id/trigger', (c) => {
    try {
      const job = services.cron.triggerJob(ctx(), c.req.param('id'));
      return c.json({ success: true, data: job });
    } catch (error) {
      const wire = unwrapHaroError(error);
      if (wire) {
        return c.json(
          {
            success: false,
            message: wire.message,
            code: wire.code,
            ...(wire.remediation ? { remediation: wire.remediation } : {}),
          },
          wire.status,
        );
      }
      throw error;
    }
  });

  return route;
}
