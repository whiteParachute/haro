/**
 * Cron job types (FEAT-033).
 *
 * Naming follows hermes-agent's `cron/jobs.py`: every scheduled work item is a
 * "job" regardless of whether it fires on a recurring cron expression or a
 * single ISO timestamp. A `mode` discriminator tells the two apart.
 */

export type CronJobMode = 'cron' | 'once';

export type CronJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'cancelled-forced'
  | 'missed';

export type CronJobLastStatus = 'ok' | 'error';

export type RetryBackoff = 'exponential' | 'linear' | 'fixed';

export interface RetryPolicy {
  max: number;
  backoff: RetryBackoff;
}

export interface CreateCronJobInput {
  sessionId: string;
  agentId?: string;
  mode: CronJobMode;
  /** For mode='cron': expression (with optional `TZ=` prefix). For mode='once': ISO timestamp. */
  when: string;
  /** Free-form prompt fed to AgentRunner.run({ task }). Capped at 64 KB. */
  taskInput: string;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, unknown>;
}

export interface CronJobRecord {
  id: string;
  sessionId: string;
  agentId: string | null;
  mode: CronJobMode;
  whenExpr: string;
  taskInput: string;
  retryPolicy: RetryPolicy | null;
  status: CronJobStatus;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastStatus: CronJobLastStatus | null;
  lastError: string | null;
  lastDeliveryError: string | null;
  createdAt: number;
  cancelledAt: number | null;
  metadata: Record<string, unknown> | null;
}

export interface ListCronJobsQuery {
  sessionId?: string;
  status?: CronJobStatus;
  enabled?: boolean;
  /** Inclusive upper bound on next_run_at (epoch ms) — used by tick(). */
  dueBefore?: number;
  limit?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { max: 3, backoff: 'exponential' };
export const DEFAULT_QUOTA_PER_SESSION = 50;
export const MIN_CRON_INTERVAL_MS = 60_000;
export const ONCE_GRACE_MS = 5_000;
export const MAX_TASK_INPUT_BYTES = 64 * 1024;
export const DEFAULT_LEASE_TTL_MS = 60_000;
export const DEFAULT_TICK_INTERVAL_MS = 60_000;
