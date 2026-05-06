/**
 * CronTickHost — long-running tick loop wrapper (FEAT-033 R12).
 *
 * Used by:
 *   - the web-api process (started in `WebRuntime` boot, stopped on shutdown)
 *   - `haro cron daemon` (foreground or detached)
 *
 * Single instance is fine to run alongside other tick callers — the shared
 * `cron_lease` row keeps overlapping ticks from double-running due jobs.
 */

import { tick, type TickDeps, type TickOutcome } from './tick.js';
import { DEFAULT_TICK_INTERVAL_MS } from './types.js';
import type { CronRunnerLogger } from './runner.js';

export interface CronTickHostOptions extends TickDeps {
  /** Sleep between ticks. Default 60s; matches MIN_CRON_INTERVAL_MS. */
  intervalMs?: number;
  /**
   * Optional callback invoked after every tick — exposes the outcome so
   * tests / dashboards can observe progress without subscribing to logs.
   */
  onTick?: (outcome: TickOutcome) => void;
}

export interface CronTickHost {
  start(): void;
  stop(): Promise<void>;
  /** Force one tick now (still subject to the lease). Awaitable. */
  triggerNow(): Promise<TickOutcome>;
  readonly running: boolean;
}

export function createCronTickHost(options: CronTickHostOptions): CronTickHost {
  const intervalMs = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const logger: CronRunnerLogger = options.logger ?? {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopping = false;
  let inflight: Promise<TickOutcome> | null = null;

  const tickOnce = async (): Promise<TickOutcome> => {
    if (inflight) return inflight;
    const promise = (async (): Promise<TickOutcome> => {
      try {
        const outcome = await tick(options);
        options.onTick?.(outcome);
        return outcome;
      } catch (err) {
        logger.error?.({ err }, 'cron tick threw');
        return { skipped: false, ranCount: 0, results: [] };
      }
    })();
    inflight = promise;
    try {
      return await promise;
    } finally {
      inflight = null;
    }
  };

  const scheduleNext = (): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      void tickOnce().finally(() => {
        if (!stopping) scheduleNext();
      });
    }, intervalMs);
    timer.unref?.();
  };

  return {
    get running() {
      return running;
    },
    start(): void {
      if (running) return;
      running = true;
      stopping = false;
      // Kick off the first tick immediately so newly-due jobs get picked up
      // without waiting one full interval.
      void tickOnce().finally(() => {
        if (!stopping) scheduleNext();
      });
    },
    async stop(): Promise<void> {
      stopping = true;
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inflight) {
        try {
          await inflight;
        } catch {
          /* swallow — already logged in tickOnce */
        }
      }
    },
    triggerNow: tickOnce,
  };
}
