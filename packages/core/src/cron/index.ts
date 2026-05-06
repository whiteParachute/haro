/**
 * `@haro/core/cron` — cron job subsystem (FEAT-033).
 *
 * Exports the public API. Internal-only modules (`runner`, `tick`) are added
 * in later steps and re-exported here.
 */

export { CANCEL_GRACEFUL_TIMEOUT_MS, CronManager } from './manager.js';
export type { CronManagerOptions } from './manager.js';
export {
  clearInflight,
  getInflight,
  resetInflightForTest,
  trackInflight,
} from './inflight.js';
export type { InflightEntry } from './inflight.js';
export { CronRunner } from './runner.js';
export type {
  CronRunnerAgentRunner,
  CronRunnerLogger,
  CronRunnerOptions,
  CronRunOutcome,
} from './runner.js';
export { tick, DEFAULT_MAX_JOBS_PER_TICK } from './tick.js';
export type { TickDeps, TickOutcome } from './tick.js';
export { createCronTickHost } from './host.js';
export type { CronTickHost, CronTickHostOptions } from './host.js';
export { CronStorage } from './storage.js';
export type {
  CronStorageOptions,
  InsertCronJobInput,
  LeaseAcquireOptions,
  LeaseRow,
} from './storage.js';
export {
  parseCronExpression,
  nextRunAfter,
  minObservedIntervalMs,
  assertCronFrequencyAllowed,
} from './cron-parser.js';
export type { CronParseResult } from './cron-parser.js';
export type {
  CreateCronJobInput,
  CronJobLastStatus,
  CronJobMode,
  CronJobRecord,
  CronJobStatus,
  ListCronJobsQuery,
  RetryBackoff,
  RetryPolicy,
} from './types.js';
export {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_QUOTA_PER_SESSION,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TICK_INTERVAL_MS,
  MAX_TASK_INPUT_BYTES,
  MIN_CRON_INTERVAL_MS,
  ONCE_GRACE_MS,
} from './types.js';
