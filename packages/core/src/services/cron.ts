/**
 * Cron service layer (FEAT-033 R9).
 *
 * Both `@haro/cli` and `@haro/web-api` route through these functions so the
 * MCP `schedule_task` tool, the `haro cron` CLI, and the
 * `/api/v1/cron/jobs` HTTP routes share one validation + storage path.
 *
 * Each call opens a short-lived `CronManager` and closes it before returning,
 * mirroring the per-call lifecycle used by `services.workflows` /
 * `services.sessions`. The `tick()` host process holds its own long-lived
 * storage handle and does not go through this layer.
 */

import {
  CronManager,
  type CreateCronJobInput,
  type CronJobRecord,
  type CronJobStatus,
  type ListCronJobsQuery,
} from '../cron/index.js';
import type { ServiceContext } from './types.js';

export interface ListCronJobsOptions {
  sessionId?: string;
  status?: CronJobStatus;
  enabled?: boolean;
  limit?: number;
}

export interface ListCronJobsResult {
  items: CronJobRecord[];
  count: number;
  limit: number;
}

function openManager(ctx: ServiceContext): CronManager {
  return new CronManager({
    storageOptions: {
      ...(ctx.root ? { root: ctx.root } : {}),
      ...(ctx.dbFile ? { dbFile: ctx.dbFile } : {}),
    },
  });
}

export function listJobs(
  ctx: ServiceContext,
  options: ListCronJobsOptions = {},
): ListCronJobsResult {
  const manager = openManager(ctx);
  try {
    const query: ListCronJobsQuery = {};
    if (options.sessionId !== undefined) query.sessionId = options.sessionId;
    if (options.status !== undefined) query.status = options.status;
    if (options.enabled !== undefined) query.enabled = options.enabled;
    if (options.limit !== undefined) query.limit = options.limit;
    const items = manager.list(query);
    return { items, count: items.length, limit: options.limit ?? 200 };
  } finally {
    manager.close();
  }
}

export function getJob(ctx: ServiceContext, id: string): CronJobRecord {
  const manager = openManager(ctx);
  try {
    return manager.get(id);
  } finally {
    manager.close();
  }
}

export function createJob(ctx: ServiceContext, input: CreateCronJobInput): CronJobRecord {
  const manager = openManager(ctx);
  try {
    return manager.create(input);
  } finally {
    manager.close();
  }
}

export async function cancelJob(ctx: ServiceContext, id: string): Promise<CronJobRecord> {
  const manager = openManager(ctx);
  try {
    return await manager.cancel(id);
  } finally {
    manager.close();
  }
}

export function triggerJob(ctx: ServiceContext, id: string): CronJobRecord {
  const manager = openManager(ctx);
  try {
    return manager.trigger(id);
  } finally {
    manager.close();
  }
}
