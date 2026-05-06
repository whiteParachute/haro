/**
 * `tick()` — single-pass cron job dispatcher (FEAT-033 R11).
 *
 * Stateless. Whoever holds the cross-process lease runs all due jobs in this
 * tick, then returns. Callers (web-api ticker, `haro cron daemon`,
 * `haro cron tick`) re-invoke periodically. The tick model is borrowed from
 * hermes-agent's `cron/scheduler.py` `tick()`.
 *
 * Failure modes worth knowing:
 *
 *   - lease held by another process → returns `{ skipped: 'lease-held' }`.
 *   - one due job throws → logged, other due jobs in the batch still run.
 *   - host process crashes mid-execute → at-most-once: `next_run_at` was
 *     already advanced before AgentRunner started, so the same firing won't
 *     be re-attempted on the next tick.
 */

import { hostname } from 'node:os';
import { CronRunner, type CronRunnerAgentRunner, type CronRunnerLogger } from './runner.js';
import { clearInflight, trackInflight } from './inflight.js';
import type { CronStorage, LeaseAcquireOptions } from './storage.js';
import { DEFAULT_LEASE_TTL_MS, type CronJobRecord } from './types.js';

export interface TickDeps {
  storage: CronStorage;
  agentRunner: CronRunnerAgentRunner;
  defaultAgentId: string;
  now?: () => number;
  /** Identifier persisted in `cron_lease.holder` for diagnostics. */
  holder?: string;
  /** Lease TTL. Default 60s; renewing is the host loop's responsibility. */
  leaseTtlMs?: number;
  /** Hard cap on the number of jobs dispatched per tick. */
  maxJobsPerTick?: number;
  logger?: CronRunnerLogger;
  /** Allow callers to inject a CronRunner (e.g. with a custom sleep). */
  runner?: CronRunner;
  /** Cancellation: aborts in-flight jobs (each receives the signal). */
  signal?: AbortSignal;
}

export type TickOutcome =
  | { skipped: 'lease-held'; ranCount: 0 }
  | {
      skipped: false;
      ranCount: number;
      results: Array<{ jobId: string; status: string; attempts: number; finalErrorCode?: string }>;
    };

export const DEFAULT_MAX_JOBS_PER_TICK = 50;

export async function tick(deps: TickDeps): Promise<TickOutcome> {
  const now = deps.now ?? Date.now;
  const ttl = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const holder = deps.holder ?? buildHolder();
  const logger = deps.logger ?? {};

  const acquireOpts: LeaseAcquireOptions = { holder, ttlMs: ttl, now: now() };
  const acquired = deps.storage.tryAcquireLease(acquireOpts);
  if (!acquired) {
    logger.debug?.({ holder }, 'cron tick skipped: lease held');
    return { skipped: 'lease-held', ranCount: 0 };
  }

  // Background lease renewer: a single tick can outlive its initial TTL when
  // a job runs longer than `ttl` (default 60s), and without renewal another
  // process can acquire the lease and re-dispatch overlapping work. Renew at
  // half the TTL so a single missed renewal still leaves headroom.
  const renewIntervalMs = Math.max(5_000, Math.floor(ttl / 2));
  let renewalLost = false;
  const renewer = setInterval(() => {
    // The interval callback runs OUTSIDE the surrounding try/finally, so an
    // exception here would otherwise crash the process. Treat any throw as
    // lease loss and let the dispatch loop drain.
    try {
      const ok = deps.storage.renewLease({ holder, ttlMs: ttl, now: now() });
      if (!ok) {
        renewalLost = true;
        logger.warn?.({ holder }, 'cron tick: lease renewal failed; another process may have taken over');
      }
    } catch (err) {
      renewalLost = true;
      logger.error?.({ holder, err }, 'cron tick: lease renewal threw; treating as lost');
    }
  }, renewIntervalMs);
  renewer.unref?.();

  try {
    const dueLimit = deps.maxJobsPerTick ?? DEFAULT_MAX_JOBS_PER_TICK;
    const due: CronJobRecord[] = deps.storage.list({
      enabled: true,
      dueBefore: now(),
      limit: dueLimit,
    });
    if (due.length === 0) {
      return { skipped: false, ranCount: 0, results: [] };
    }

    const runner = deps.runner ?? new CronRunner({
      storage: deps.storage,
      agentRunner: deps.agentRunner,
      defaultAgentId: deps.defaultAgentId,
      now,
      logger,
    });

    const results: Array<{
      jobId: string;
      status: string;
      attempts: number;
      finalErrorCode?: string;
    }> = [];
    for (const job of due) {
      // If we lost the lease (e.g. host stalled past TTL), stop dispatching
      // further jobs — the new lease holder will pick them up next tick.
      // The in-flight job is allowed to finish; its `next_run_at` was already
      // advanced so duplicate firing is bounded to that single overlap.
      if (renewalLost) {
        logger.warn?.({ holder, remaining: due.length - results.length }, 'cron tick: aborting batch after lease loss');
        break;
      }
      // Skip jobs that the storage thinks are due but actually have no
      // future firing (defensive — list() already filters next_run_at IS NOT
      // NULL via dueBefore).
      if (job.nextRunAt === null) continue;
      // Re-read fresh: cancel() could have landed between list() above and
      // this loop iteration. Skipping cancelled rows here saves the runner
      // from doing unnecessary advance/setStatus work that would be guard-
      // blocked anyway.
      const fresh = deps.storage.get(job.id);
      if (!fresh || !fresh.enabled) {
        continue;
      }

      // Per-job AbortController so CronManager.cancel() can interrupt this
      // run via the shared inflight registry. Chain to the tick-level signal
      // so a host shutdown propagates to every running job.
      const jobController = new AbortController();
      const onTickAbort = (): void => jobController.abort();
      if (deps.signal) {
        if (deps.signal.aborted) jobController.abort();
        else deps.signal.addEventListener('abort', onTickAbort, { once: true });
      }
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      trackInflight(job.id, { controller: jobController, done });
      try {
        const outcome = await runner.execute(job, jobController.signal);
        results.push({
          jobId: outcome.jobId,
          status: outcome.status,
          attempts: outcome.attempts,
          ...(outcome.finalErrorCode ? { finalErrorCode: outcome.finalErrorCode } : {}),
        });
      } catch (err) {
        // Defensive: CronRunner promises not to throw, but if it does (e.g.
        // storage failure), persist the error to the job and keep going.
        logger.error?.({ jobId: job.id, err }, 'cron runner threw out of execute');
        deps.storage.setStatus(
          job.id,
          'failed',
          {
            lastStatus: 'error',
            lastError: err instanceof Error ? err.message : String(err),
          },
          { requireNotCancelled: true },
        );
        results.push({ jobId: job.id, status: 'failed', attempts: 0, finalErrorCode: 'runner_threw' });
      } finally {
        clearInflight(job.id);
        resolveDone();
        deps.signal?.removeEventListener('abort', onTickAbort);
      }
    }
    return { skipped: false, ranCount: results.length, results };
  } finally {
    clearInterval(renewer);
    // releaseLease is gated on `holder = ?` so this is a no-op if another
    // process already took over. Safe to call unconditionally.
    deps.storage.releaseLease(holder);
  }
}

function buildHolder(): string {
  return `${hostname()}:${process.pid}`;
}
