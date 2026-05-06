/**
 * Process-global registry of in-flight cron job runs (FEAT-033 R10).
 *
 * Cancelling a running job needs in-process state because `cancel()` only
 * knows the job id, not which AbortController the tick host is using. This
 * registry bridges that: the tick host registers each job before running and
 * clears the entry when execute() resolves; `CronManager.cancel()` looks up
 * the entry to send `abort()` and await graceful completion.
 *
 * Cross-process cancel falls back to the DB flag — the other process's tick
 * naturally honours `enabled=0` on subsequent ticks but cannot interrupt a
 * job mid-flight that it owns. That limitation is documented in spec §8 / Q.
 */

export interface InflightEntry {
  controller: AbortController;
  /** Resolves when the runner has fully returned for this job. */
  done: Promise<void>;
}

const REGISTRY = new Map<string, InflightEntry>();

export function trackInflight(jobId: string, entry: InflightEntry): void {
  REGISTRY.set(jobId, entry);
}

export function clearInflight(jobId: string): void {
  REGISTRY.delete(jobId);
}

export function getInflight(jobId: string): InflightEntry | undefined {
  return REGISTRY.get(jobId);
}

/** Test-only — wipe state between vitest runs. */
export function resetInflightForTest(): void {
  REGISTRY.clear();
}
