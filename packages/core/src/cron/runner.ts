/**
 * CronRunner — execute a single cron job (FEAT-033 R5/R6/R10/R11).
 *
 * Lifecycle (per hermes-agent's `tick → advance → execute → mark` pattern):
 *
 *   1. advance_next_run — write the next firing time BEFORE running so a
 *      crash mid-run yields at-most-once semantics.
 *   2. mark status='running'.
 *   3. attempt = 0..retryPolicy.max:
 *        if signal aborted → emit cancelled (graceful) and stop.
 *        result = await agentRunner.run({ task, agentId, signal })
 *        if result event is `result` → success, mark accordingly and return.
 *        if !retryable → mark failed and return.
 *        sleep backoff, attempt++.
 *   4. retries exhausted → mark failed.
 *
 * Forced-vs-graceful semantics: this runner ALWAYS marks `cancelled` when it
 * sees abort. The `cancelled-forced` status is reserved for the
 * `CronManager.cancel()` 30s-timeout escape hatch — i.e. cases where the
 * runner failed to honour the abort signal in time. So all writes here use
 * `requireNotCancelled` so a delayed runner finish cannot overwrite the
 * forced cancel that cancel() may have already committed.
 *
 * The runner does NOT reach into the cron scheduling loop (`tick()` owns
 * that) and does NOT renew the lease (the host that holds the lease does).
 * It writes session events transitively through `AgentRunner.run`, so the
 * SessionDetailPage shows the cron-triggered run identically to a manual one.
 */

import type { CronJobLastStatus, CronJobRecord, CronJobStatus, RetryPolicy } from './types.js';
import { DEFAULT_RETRY_POLICY } from './types.js';
import {
  nextRunAfter,
  parseCronExpression,
  type CronParseResult,
} from './cron-parser.js';
import type { CronStorage } from './storage.js';
import type { RunAgentInput, RunAgentResult } from '../runtime/types.js';

export interface CronRunnerAgentRunner {
  run(input: RunAgentInput): Promise<RunAgentResult>;
}

export interface CronRunnerLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface CronRunnerOptions {
  storage: CronStorage;
  agentRunner: CronRunnerAgentRunner;
  /**
   * Default agent id used when a job omits `agent_id`. Most jobs come from
   * `services.cron.create({ agentId })` so this is a fallback safety net.
   */
  defaultAgentId: string;
  now?: () => number;
  /** Sleep helper — overridden in tests so backoff doesn't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  logger?: CronRunnerLogger;
}

export interface CronRunOutcome {
  jobId: string;
  status: CronJobStatus;
  attempts: number;
  finalErrorCode?: string;
}

export class CronRunner {
  private readonly storage: CronStorage;
  private readonly agentRunner: CronRunnerAgentRunner;
  private readonly defaultAgentId: string;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly logger: CronRunnerLogger;

  constructor(options: CronRunnerOptions) {
    this.storage = options.storage;
    this.agentRunner = options.agentRunner;
    this.defaultAgentId = options.defaultAgentId;
    this.nowFn = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? {};
  }

  /**
   * Execute one due job end-to-end.
   *
   * @param record the freshly-loaded job record (next_run_at <= now).
   * @param signal optional cancellation hook from the tick host or a
   *               manual `cron cancel`.
   */
  async execute(record: CronJobRecord, signal?: AbortSignal): Promise<CronRunOutcome> {
    // Guard against a cancel() that landed between the tick host's `list()`
    // and our entry here: re-read fresh and bail if the row is no longer
    // active. This makes cancel-before-execute a no-op instead of advancing
    // next_run_at unnecessarily.
    const fresh = this.storage.get(record.id);
    if (!fresh || !fresh.enabled) {
      return { jobId: record.id, status: fresh?.status ?? 'cancelled', attempts: 0 };
    }

    // 1. advance_next_run — write before running for at-most-once semantics.
    //    Guarded so a concurrent cancel that nulled next_run_at isn't undone.
    const nextRunAt = this.computeAdvancedNextRun(record);
    this.storage.advanceNextRun(record.id, nextRunAt, { requireNotCancelled: true });

    // 2. mark running. If guarded UPDATE finds the row already cancelled,
    //    abandon the run rather than flipping the user-visible status back.
    const markedRunning = this.storage.setStatus(
      record.id,
      'running',
      { lastRunAt: this.nowFn() },
      { requireNotCancelled: true },
    );
    if (!markedRunning) {
      return { jobId: record.id, status: 'cancelled', attempts: 0 };
    }

    const policy = record.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const maxAttempts = Math.max(1, policy.max + 1); // max=3 → 1 try + 3 retries
    let lastErrorMessage: string | null = null;
    let lastErrorCode: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) {
        return this.markCancelled(record, attempt);
      }
      if (attempt > 0) {
        const delay = backoffDelayMs(policy, attempt);
        await this.sleepFn(delay);
        if (signal?.aborted) {
          return this.markCancelled(record, attempt);
        }
      }

      const runInput: RunAgentInput = {
        task: record.taskInput,
        agentId: record.agentId ?? this.defaultAgentId,
        continueFromSessionId: record.sessionId,
        ...(signal ? { signal } : {}),
      };
      let result: RunAgentResult;
      try {
        result = await this.agentRunner.run(runInput);
      } catch (cause) {
        lastErrorMessage = cause instanceof Error ? cause.message : String(cause);
        lastErrorCode = 'runner_threw';
        this.logger.error?.({ jobId: record.id, attempt, err: cause }, 'cron runner threw');
        continue; // try retry
      }

      const finalEvent = result.finalEvent;
      if (finalEvent.type === 'result') {
        return this.markSuccess(record, attempt + 1);
      }
      // error event
      lastErrorMessage = finalEvent.message;
      lastErrorCode = finalEvent.code;
      if (finalEvent.code === 'aborted') {
        return this.markCancelled(record, attempt + 1);
      }
      if (!finalEvent.retryable) {
        return this.markFailed(record, attempt + 1, lastErrorMessage, lastErrorCode);
      }
      // retryable: loop continues
    }

    return this.markFailed(record, maxAttempts, lastErrorMessage, lastErrorCode);
  }

  /**
   * Compute the next firing time written *before* execute. For cron mode the
   * scheduler's nextRunAfter(now); for once mode null (it never fires again).
   */
  private computeAdvancedNextRun(record: CronJobRecord): number | null {
    if (record.mode === 'once') return null;
    let parsed: CronParseResult;
    try {
      parsed = parseCronExpression(record.whenExpr);
    } catch (err) {
      this.logger.error?.({ jobId: record.id, err }, 'cron expression no longer parses; treating as once');
      return null;
    }
    return nextRunAfter(parsed, new Date(this.nowFn()));
  }

  private markSuccess(record: CronJobRecord, attempts: number): CronRunOutcome {
    const lastStatus: CronJobLastStatus = 'ok';
    if (record.mode === 'once') {
      // once jobs are terminal after a single successful run.
      this.storage.setStatus(
        record.id,
        'done',
        {
          enabled: false,
          lastStatus,
          lastError: null,
          nextRunAt: null,
        },
        { requireNotCancelled: true },
      );
      return { jobId: record.id, status: 'done', attempts };
    }
    // recurring cron jobs return to 'pending' so the next tick picks them up.
    this.storage.setStatus(
      record.id,
      'pending',
      {
        lastStatus,
        lastError: null,
      },
      { requireNotCancelled: true },
    );
    return { jobId: record.id, status: 'pending', attempts };
  }

  private markFailed(
    record: CronJobRecord,
    attempts: number,
    message: string | null,
    code: string | undefined,
  ): CronRunOutcome {
    const lastStatus: CronJobLastStatus = 'error';
    // For recurring jobs, leave next_run_at intact so the next firing still
    // happens; status='failed' reflects the last outcome and lastError carries
    // the cause for /cron show diagnostics. For once jobs, next_run_at was
    // already nulled in advanceNextRun, so the job is terminal.
    this.storage.setStatus(
      record.id,
      'failed',
      {
        lastStatus,
        lastError: formatError(message, code),
      },
      { requireNotCancelled: true },
    );
    return {
      jobId: record.id,
      status: 'failed',
      attempts,
      ...(code ? { finalErrorCode: code } : {}),
    };
  }

  /**
   * Mark the job cancelled in response to an abort signal. Always 'cancelled'
   * (graceful) — `cancelled-forced` is reserved for the cancel() 30s-timeout
   * escape hatch in CronManager.cancel(), which is the only place that knows
   * the runner failed to honour the abort in time.
   */
  private markCancelled(record: CronJobRecord, attempts: number): CronRunOutcome {
    this.storage.setStatus(
      record.id,
      'cancelled',
      {
        enabled: false,
        cancelledAt: this.nowFn(),
        nextRunAt: null,
        lastStatus: 'error',
        lastError: 'aborted by caller',
      },
      { requireNotCancelled: true },
    );
    return { jobId: record.id, status: 'cancelled', attempts };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// Cap retry delay so an attacker-controlled retry policy can't park a tick
// thread for hours. 5 minutes is well above any realistic flaky-network
// retry window and well below the 60s tick cadence times the typical max.
const MAX_RETRY_DELAY_MS = 5 * 60_000;

function backoffDelayMs(policy: RetryPolicy, attempt: number): number {
  // attempt is 1-based when this is called: 1 → first retry after first failure.
  const base = 1_000;
  let delay: number;
  switch (policy.backoff) {
    case 'fixed':
      delay = base;
      break;
    case 'linear':
      delay = base * attempt;
      break;
    case 'exponential':
    default:
      delay = base * 2 ** (attempt - 1);
      break;
  }
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function formatError(message: string | null, code: string | undefined): string {
  if (!message) return code ?? 'unknown error';
  return code ? `[${code}] ${message}` : message;
}
