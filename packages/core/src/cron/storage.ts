/**
 * SQLite-backed storage for cron jobs and the cross-process tick lease
 * (FEAT-033 R2 / R11).
 *
 * Two responsibilities:
 *   1. CRUD on `cron_jobs` (managed indirectly via CronManager / services).
 *   2. Single-row `cron_lease` advisory lock so multiple tick callers
 *      (web-api ticker, `haro cron daemon`, `haro cron tick`) don't trample
 *      each other.
 *
 * The storage layer holds an open Database handle. Callers that want
 * per-call scoping (services pattern) should construct + close per request.
 * Long-lived processes (tick host) hold one instance for the process lifetime.
 */

import type Database from 'better-sqlite3';
import { initHaroDatabase } from '../db/init.js';
import type {
  CreateCronJobInput,
  CronJobLastStatus,
  CronJobRecord,
  CronJobStatus,
  ListCronJobsQuery,
  RetryPolicy,
} from './types.js';

export interface CronStorageOptions {
  root?: string;
  dbFile?: string;
}

export interface LeaseAcquireOptions {
  holder: string;
  ttlMs: number;
  now: number;
}

export interface LeaseRow {
  holder: string;
  acquiredAt: number;
  leaseUntil: number;
}

export interface InsertCronJobInput extends CreateCronJobInput {
  id: string;
  createdAt: number;
  /** Initial next_run_at (epoch ms). For 'cron' = parser.nextRunAfter; for 'once' = parsed timestamp. */
  initialNextRunAt: number;
}

export class CronStorage {
  private readonly database: Database.Database;
  private readonly ownsHandle: boolean;

  constructor(options: CronStorageOptions | { database: Database.Database } = {}) {
    if ('database' in options && options.database) {
      this.database = options.database;
      this.ownsHandle = false;
    } else {
      const opts = options as CronStorageOptions;
      const opened = initHaroDatabase({
        keepOpen: true,
        ...(opts.root ? { root: opts.root } : {}),
        ...(opts.dbFile ? { dbFile: opts.dbFile } : {}),
      });
      this.database = opened.database!;
      this.ownsHandle = true;
    }
  }

  close(): void {
    if (this.ownsHandle) this.database.close();
  }

  insert(input: InsertCronJobInput): CronJobRecord {
    this.runInsert(input);
    return this.get(input.id)!;
  }

  private runInsert(input: InsertCronJobInput): void {
    const stmt = this.database.prepare(
      `INSERT INTO cron_jobs (
         id, session_id, agent_id, mode, when_expr, task_input, retry_policy,
         status, enabled, last_run_at, next_run_at, last_status, last_error,
         last_delivery_error, created_at, cancelled_at, metadata
       ) VALUES (
         @id, @sessionId, @agentId, @mode, @whenExpr, @taskInput, @retryPolicy,
         'pending', 1, NULL, @nextRunAt, NULL, NULL,
         NULL, @createdAt, NULL, @metadata
       )`,
    );
    stmt.run({
      id: input.id,
      sessionId: input.sessionId,
      agentId: input.agentId ?? null,
      mode: input.mode,
      whenExpr: input.when,
      taskInput: input.taskInput,
      retryPolicy: input.retryPolicy ? JSON.stringify(input.retryPolicy) : null,
      nextRunAt: input.initialNextRunAt,
      createdAt: input.createdAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  }

  /**
   * Atomic count + insert under `BEGIN IMMEDIATE` so concurrent creates can
   * never both pass the quota check (FEAT-033 G7 / R7). Returns:
   *   - `{ ok: true, record }` when the insert succeeded.
   *   - `{ ok: false, activeCount }` when the session was already at or above
   *     the quota; manager.create() formats the user-facing error.
   */
  insertIfBelowQuota(
    input: InsertCronJobInput,
    quotaPerSession: number,
  ): { ok: true; record: CronJobRecord } | { ok: false; activeCount: number } {
    const txn = this.database.transaction((): { ok: true } | { ok: false; activeCount: number } => {
      const row = this.database
        .prepare(
          `SELECT COUNT(*) AS n FROM cron_jobs
            WHERE session_id = ?
              AND enabled = 1
              AND next_run_at IS NOT NULL`,
        )
        .get(input.sessionId) as { n: number } | undefined;
      const activeCount = row?.n ?? 0;
      if (activeCount >= quotaPerSession) {
        return { ok: false, activeCount };
      }
      this.runInsert(input);
      return { ok: true };
    });
    // immediate=true upgrades the implicit BEGIN to BEGIN IMMEDIATE so the
    // write lock is taken before the count read; without it two readers can
    // both observe `activeCount < quota` and then race to upgrade.
    const result = txn.immediate();
    if (result.ok) return { ok: true, record: this.get(input.id)! };
    return result;
  }

  get(id: string): CronJobRecord | null {
    const row = this.database
      .prepare(`SELECT * FROM cron_jobs WHERE id = ?`)
      .get(id) as RawJobRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(query: ListCronJobsQuery = {}): CronJobRecord[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.sessionId !== undefined) {
      where.push('session_id = @sessionId');
      params.sessionId = query.sessionId;
    }
    if (query.status !== undefined) {
      where.push('status = @status');
      params.status = query.status;
    }
    if (query.enabled !== undefined) {
      where.push('enabled = @enabled');
      params.enabled = query.enabled ? 1 : 0;
    }
    if (query.dueBefore !== undefined) {
      where.push('next_run_at IS NOT NULL AND next_run_at <= @dueBefore');
      params.dueBefore = query.dueBefore;
    }
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 1000) : 200;
    const sql = `SELECT * FROM cron_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`;
    const rows = this.database.prepare(sql).all(params) as RawJobRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Count jobs that still have a future / pending firing scheduled. Used for
   * the per-session quota (FEAT-033 G7). Defining "active" as
   * `enabled=1 AND next_run_at IS NOT NULL` avoids leaking quota for
   * recurring cron jobs whose `status` cycles through `done`/`failed` after
   * each firing while remaining enabled with a fresh `next_run_at`.
   */
  countActiveForSession(sessionId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS n FROM cron_jobs
          WHERE session_id = ?
            AND enabled = 1
            AND next_run_at IS NOT NULL`,
      )
      .get(sessionId) as { n: number };
    return row.n ?? 0;
  }

  setStatus(
    id: string,
    status: CronJobStatus,
    fields: {
      enabled?: boolean;
      cancelledAt?: number | null;
      lastRunAt?: number | null;
      nextRunAt?: number | null;
      lastStatus?: CronJobLastStatus | null;
      lastError?: string | null;
    } = {},
    options: {
      /**
       * When true, the UPDATE only takes effect if the row's current status is
       * NOT one of the cancel terminals (`cancelled` / `cancelled-forced`).
       * Used by the runner so a late-finishing job cannot overwrite a forced
       * cancel set by `CronManager.cancel()` after a 30s timeout (FEAT-033 R10).
       */
      requireNotCancelled?: boolean;
    } = {},
  ): boolean {
    const set: string[] = ['status = @status'];
    const params: Record<string, unknown> = { id, status };
    if (fields.enabled !== undefined) {
      set.push('enabled = @enabled');
      params.enabled = fields.enabled ? 1 : 0;
    }
    if (fields.cancelledAt !== undefined) {
      set.push('cancelled_at = @cancelledAt');
      params.cancelledAt = fields.cancelledAt;
    }
    if (fields.lastRunAt !== undefined) {
      set.push('last_run_at = @lastRunAt');
      params.lastRunAt = fields.lastRunAt;
    }
    if (fields.nextRunAt !== undefined) {
      set.push('next_run_at = @nextRunAt');
      params.nextRunAt = fields.nextRunAt;
    }
    if (fields.lastStatus !== undefined) {
      set.push('last_status = @lastStatus');
      params.lastStatus = fields.lastStatus;
    }
    if (fields.lastError !== undefined) {
      set.push('last_error = @lastError');
      params.lastError = fields.lastError;
    }
    const guard = options.requireNotCancelled
      ? ` AND status NOT IN ('cancelled','cancelled-forced')`
      : '';
    const result = this.database
      .prepare(`UPDATE cron_jobs SET ${set.join(', ')} WHERE id = @id${guard}`)
      .run(params);
    return result.changes > 0;
  }

  /**
   * Move next_run_at forward (cron) or null it out (once-after-run). Used by
   * tick(). The optional `requireNotCancelled` guard mirrors `setStatus` so a
   * runner that wakes up after a concurrent cancel cannot resurrect the
   * schedule by writing a fresh next_run_at.
   */
  advanceNextRun(
    id: string,
    nextRunAt: number | null,
    options: { requireNotCancelled?: boolean } = {},
  ): boolean {
    const guard = options.requireNotCancelled
      ? ` AND status NOT IN ('cancelled','cancelled-forced')`
      : '';
    const result = this.database
      .prepare(`UPDATE cron_jobs SET next_run_at = ? WHERE id = ?${guard}`)
      .run(nextRunAt, id);
    return result.changes > 0;
  }

  /**
   * trigger(): force next_run_at = now so the next tick picks the job up.
   * Refuses cancelled / cancelled-forced jobs; the recurring lifecycle is
   * pending/running/done/failed, all of which are valid trigger targets so
   * long as the job is still enabled.
   */
  forceTriggerNow(id: string, now: number): boolean {
    const result = this.database
      .prepare(
        `UPDATE cron_jobs SET next_run_at = ?
          WHERE id = ?
            AND enabled = 1
            AND status NOT IN ('cancelled','cancelled-forced')`,
      )
      .run(now, id);
    return result.changes > 0;
  }

  /** Try to acquire the cron tick lease. Returns true on success. */
  tryAcquireLease(opts: LeaseAcquireOptions): boolean {
    const leaseUntil = opts.now + opts.ttlMs;
    // Ensure single sentinel row exists (no-op after first call).
    this.database
      .prepare(
        `INSERT OR IGNORE INTO cron_lease (id, holder, acquired_at, lease_until)
         VALUES (1, '', 0, 0)`,
      )
      .run();
    const result = this.database
      .prepare(
        `UPDATE cron_lease
            SET holder = @holder, acquired_at = @now, lease_until = @leaseUntil
          WHERE id = 1
            AND (lease_until <= @now OR holder = @holder)`,
      )
      .run({ holder: opts.holder, now: opts.now, leaseUntil });
    return result.changes === 1;
  }

  renewLease(opts: LeaseAcquireOptions): boolean {
    const leaseUntil = opts.now + opts.ttlMs;
    const result = this.database
      .prepare(
        `UPDATE cron_lease
            SET lease_until = @leaseUntil, acquired_at = @now
          WHERE id = 1 AND holder = @holder AND lease_until > @now`,
      )
      .run({ holder: opts.holder, now: opts.now, leaseUntil });
    return result.changes === 1;
  }

  releaseLease(holder: string): void {
    this.database
      .prepare(`UPDATE cron_lease SET holder = '', lease_until = 0 WHERE id = 1 AND holder = ?`)
      .run(holder);
  }

  readLease(): LeaseRow | null {
    const row = this.database
      .prepare(`SELECT holder, acquired_at, lease_until FROM cron_lease WHERE id = 1`)
      .get() as { holder: string; acquired_at: number; lease_until: number } | undefined;
    if (!row) return null;
    return { holder: row.holder, acquiredAt: row.acquired_at, leaseUntil: row.lease_until };
  }
}

interface RawJobRow {
  id: string;
  session_id: string;
  agent_id: string | null;
  mode: 'cron' | 'once';
  when_expr: string;
  task_input: string;
  retry_policy: string | null;
  status: CronJobStatus;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  last_status: CronJobLastStatus | null;
  last_error: string | null;
  last_delivery_error: string | null;
  created_at: number;
  cancelled_at: number | null;
  metadata: string | null;
}

function rowToRecord(row: RawJobRow): CronJobRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    mode: row.mode,
    whenExpr: row.when_expr,
    taskInput: row.task_input,
    retryPolicy: parseJson<RetryPolicy>(row.retry_policy),
    status: row.status,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastDeliveryError: row.last_delivery_error,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
  };
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
