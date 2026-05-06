/**
 * Public API for cron job CRUD (FEAT-033 §5.1).
 *
 * `services.cron.*` (Step 4) and the future MCP `schedule_task` tool both go
 * through this manager. The manager owns:
 *   - input validation (cron / once parsing, task size cap, quota)
 *   - delegation to CronStorage for persistence
 *
 * Execution (tick / runner) lives elsewhere: this module never runs jobs.
 */

import { randomUUID } from 'node:crypto';
import { HaroError } from '../errors/index.js';
import { CronStorage, type CronStorageOptions } from './storage.js';
import {
  assertCronFrequencyAllowed,
  nextRunAfter,
  parseCronExpression,
} from './cron-parser.js';
import { getInflight } from './inflight.js';
import {
  DEFAULT_QUOTA_PER_SESSION,
  DEFAULT_RETRY_POLICY,
  MAX_TASK_INPUT_BYTES,
  ONCE_GRACE_MS,
  type CreateCronJobInput,
  type CronJobRecord,
  type ListCronJobsQuery,
  type RetryBackoff,
  type RetryPolicy,
} from './types.js';

/**
 * Maximum time `cancel()` waits for the runner to honour an abort signal
 * before flipping the row to `cancelled-forced` and returning (FEAT-033 AC5).
 */
export const CANCEL_GRACEFUL_TIMEOUT_MS = 30_000;

const VALID_BACKOFFS: readonly RetryBackoff[] = ['exponential', 'linear', 'fixed'];
const MAX_RETRY_LIMIT = 16;
/**
 * Strict ISO-8601 date-time matcher: requires explicit `Z` or `±HH:MM`
 * offset. Rejects locale-dependent forms like `05/06/2026` or naked
 * `2026-05-15T09:00:00` that `Date.parse` would otherwise accept with
 * runtime-local timezone.
 */
const ISO8601_STRICT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CronManagerOptions {
  storage?: CronStorage;
  storageOptions?: CronStorageOptions;
  now?: () => number;
  createId?: () => string;
  quotaPerSession?: number;
  /** Override the 30s graceful-cancel timeout (FEAT-033 AC5). Tests pass a small value. */
  cancelTimeoutMs?: number;
}

export interface CronManagerCloseable {
  close(): void;
}

export class CronManager implements CronManagerCloseable {
  private readonly storage: CronStorage;
  private readonly ownsStorage: boolean;
  private readonly nowFn: () => number;
  private readonly createIdFn: () => string;
  private readonly quotaPerSession: number;
  private readonly cancelTimeoutMs: number;

  constructor(options: CronManagerOptions = {}) {
    if (options.storage) {
      this.storage = options.storage;
      this.ownsStorage = false;
    } else {
      this.storage = new CronStorage(options.storageOptions ?? {});
      this.ownsStorage = true;
    }
    this.nowFn = options.now ?? (() => Date.now());
    this.createIdFn = options.createId ?? (() => `cron_${randomUUID()}`);
    this.quotaPerSession = options.quotaPerSession ?? DEFAULT_QUOTA_PER_SESSION;
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? CANCEL_GRACEFUL_TIMEOUT_MS;
  }

  close(): void {
    if (this.ownsStorage) this.storage.close();
  }

  create(input: CreateCronJobInput): CronJobRecord {
    if (typeof input.sessionId !== 'string' || input.sessionId.trim() === '') {
      throw new HaroError('INVALID_INPUT', 'sessionId is required.');
    }
    if (typeof input.taskInput !== 'string' || input.taskInput.trim() === '') {
      throw new HaroError('INVALID_INPUT', 'taskInput is required.');
    }
    if (Buffer.byteLength(input.taskInput, 'utf8') > MAX_TASK_INPUT_BYTES) {
      throw new HaroError(
        'CRON_TASK_INPUT_TOO_LARGE',
        `taskInput exceeds ${MAX_TASK_INPUT_BYTES} bytes.`,
        { remediation: 'Move large payloads to memory_remember and reference them in the prompt.' },
      );
    }
    if (input.mode !== 'cron' && input.mode !== 'once') {
      throw new HaroError('INVALID_INPUT', `mode must be 'cron' or 'once' (got '${input.mode}').`);
    }

    const now = this.nowFn();
    const initialNextRunAt =
      input.mode === 'cron' ? this.computeNextCronFiring(input.when, now) : this.parseOnceTimestamp(input.when, now);

    const retryPolicy = normalizeRetryPolicy(input.retryPolicy);

    // Atomic count + insert under BEGIN IMMEDIATE so concurrent creators can
    // never both observe `count < quota` and slip past the limit (FEAT-033 G7).
    const result = this.storage.insertIfBelowQuota(
      {
        ...input,
        retryPolicy,
        id: this.createIdFn(),
        createdAt: now,
        initialNextRunAt,
      },
      this.quotaPerSession,
    );
    if (!result.ok) {
      throw new HaroError(
        'CRON_QUOTA_EXCEEDED',
        `Session '${input.sessionId}' already has ${result.activeCount} active cron job(s); quota is ${this.quotaPerSession}.`,
        { remediation: 'Cancel finished jobs or raise the quota via Permission Guard approval.' },
      );
    }
    return result.record;
  }

  get(id: string): CronJobRecord {
    const record = this.storage.get(id);
    if (!record) {
      throw new HaroError('CRON_JOB_NOT_FOUND', `Cron job '${id}' not found.`, {
        remediation: 'Run `haro cron list` to see existing jobs.',
      });
    }
    return record;
  }

  tryGet(id: string): CronJobRecord | null {
    return this.storage.get(id);
  }

  list(query: ListCronJobsQuery = {}): CronJobRecord[] {
    return this.storage.list(query);
  }

  /**
   * Cancel a cron job (FEAT-033 R10 / AC5).
   *
   * Two-phase:
   *
   *   1. Always flip the DB row: `enabled=0`, `cancelledAt=now`, `nextRunAt=null`.
   *      Status moves to `cancelled` for non-running rows (idempotent for
   *      rows already cancelled). Recurring-cycle states (pending/done/failed)
   *      all become `cancelled` here.
   *   2. If the job is in flight in THIS process, abort the controller and
   *      wait up to `cancelTimeoutMs` for the runner to return. If the runner
   *      cooperated, it has already (or will shortly) write status='cancelled'
   *      via `requireNotCancelled` guard. If the timeout elapses, force-mark
   *      `cancelled-forced`; the runner's later setStatus calls are blocked
   *      by `requireNotCancelled` so they cannot overwrite the forced state.
   *
   * Cross-process limitation: when the running tick host lives in a different
   * process (e.g. `haro cron daemon` while CLI calls `haro cron cancel`), the
   * AbortController is not visible here, so only phase 1 applies. The other
   * process's runner will finish naturally; that's documented in spec §8 Q2.
   */
  async cancel(id: string): Promise<CronJobRecord> {
    const existing = this.get(id);
    // Idempotent: if the job is already disabled and has no future firing,
    // it cannot be cancelled twice. Do not gate on `status` alone — recurring
    // cron jobs cycle through `done`/`failed` while still active.
    if (!existing.enabled && existing.nextRunAt === null) {
      return existing;
    }
    const now = this.nowFn();
    // Always flip to 'cancelled' immediately so the runner's setStatus calls
    // (all guarded by requireNotCancelled) cannot overwrite the cancel intent.
    // Without this an in-flight runner that finishes successfully would write
    // status='pending' over our cancel — see codex review #3 #2.
    this.storage.setStatus(id, 'cancelled', {
      enabled: false,
      cancelledAt: now,
      nextRunAt: null,
    });

    // Phase 2: wake up the in-process runner if any.
    const inflight = getInflight(id);
    if (inflight) {
      inflight.controller.abort();
      const winner = await raceWithTimeout(inflight.done, this.cancelTimeoutMs);
      if (winner === 'timeout') {
        // Runner failed to honour abort within deadline — force the terminal
        // state. `requireNotCancelled` is intentionally NOT used here so this
        // write always succeeds even though we already wrote 'cancelled' in
        // phase 1: 'cancelled' → 'cancelled-forced' is the legal escalation.
        this.storage.setStatus(id, 'cancelled-forced', {
          enabled: false,
          cancelledAt: now,
          nextRunAt: null,
          lastStatus: 'error',
          lastError: `cancel timed out after ${this.cancelTimeoutMs}ms; forced abort`,
        });
      }
    }
    return this.get(id);
  }

  trigger(id: string): CronJobRecord {
    const existing = this.get(id);
    if (existing.status === 'cancelled' || existing.status === 'cancelled-forced') {
      throw new HaroError('CRON_JOB_NOT_FOUND', `Cron job '${id}' is cancelled and cannot be triggered.`);
    }
    const now = this.nowFn();
    const ok = this.storage.forceTriggerNow(id, now);
    if (!ok) {
      throw new HaroError('INVALID_INPUT', `Cron job '${id}' cannot be triggered in its current state.`);
    }
    return this.get(id);
  }

  private computeNextCronFiring(when: string, now: number): number {
    const parsed = parseCronExpression(when);
    assertCronFrequencyAllowed(parsed);
    return nextRunAfter(parsed, new Date(now));
  }

  private parseOnceTimestamp(when: string, now: number): number {
    if (typeof when !== 'string' || !ISO8601_STRICT.test(when)) {
      throw new HaroError(
        'CRON_INVALID_EXPRESSION',
        `'once' mode requires an ISO-8601 timestamp with explicit Z or ±HH:MM offset; got '${when}'.`,
        { remediation: 'Use ISO-8601 like 2026-05-15T09:00:00+08:00 or 2026-05-15T01:00:00Z.' },
      );
    }
    const parsed = Date.parse(when);
    if (!Number.isFinite(parsed)) {
      throw new HaroError(
        'CRON_INVALID_EXPRESSION',
        `'once' timestamp '${when}' is not a parseable date.`,
        { remediation: 'Use ISO-8601 like 2026-05-15T09:00:00+08:00 or 2026-05-15T01:00:00Z.' },
      );
    }
    if (parsed + ONCE_GRACE_MS < now) {
      throw new HaroError(
        'CRON_ONCE_IN_PAST',
        `'once' timestamp ${when} is in the past (now=${new Date(now).toISOString()}).`,
        { remediation: 'Pick a future ISO timestamp.' },
      );
    }
    return parsed;
  }
}

async function raceWithTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<'graceful' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  try {
    const winner = await Promise.race([
      promise.then(() => 'graceful' as const),
      timeoutPromise,
    ]);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeRetryPolicy(raw: RetryPolicy | undefined): RetryPolicy {
  if (raw === undefined || raw === null) return { ...DEFAULT_RETRY_POLICY };
  if (typeof raw !== 'object') {
    throw new HaroError('INVALID_INPUT', `retryPolicy must be an object (got ${typeof raw}).`);
  }
  const max = (raw as RetryPolicy).max;
  const backoff = (raw as RetryPolicy).backoff;
  if (!Number.isInteger(max) || max < 0 || max > MAX_RETRY_LIMIT) {
    throw new HaroError(
      'INVALID_INPUT',
      `retryPolicy.max must be an integer between 0 and ${MAX_RETRY_LIMIT} (got ${String(max)}).`,
    );
  }
  if (!VALID_BACKOFFS.includes(backoff)) {
    throw new HaroError(
      'INVALID_INPUT',
      `retryPolicy.backoff must be one of ${VALID_BACKOFFS.join(', ')} (got '${String(backoff)}').`,
    );
  }
  return { max, backoff };
}
