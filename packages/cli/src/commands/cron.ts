/**
 * `haro cron` command tree (FEAT-033 §5.5).
 *
 *   list / show / create / cancel / trigger    — pure CRUD via services.cron
 *   tick                                       — run one tick on demand
 *   daemon                                     — run a 60s tick loop until SIGINT/SIGTERM
 *
 * tick / daemon require a live AgentRunner (the same one `haro chat` uses);
 * they instantiate a long-lived `CronStorage` so the lease lock + scan work
 * across the loop without re-opening the DB on every tick.
 */

import type { Command } from 'commander';
import { DEFAULT_AGENT_ID, services, cron as coreCron } from '@haro/core';
import {
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';
import type {
  CreateCronJobInput,
  CronJobRecord,
  CronJobStatus,
  RetryBackoff,
} from '@haro/core/cron';

interface OutputFlags { json?: boolean; human?: boolean }

const CRON_TABLE_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'mode', label: 'MODE' },
  { key: 'whenExpr', label: 'WHEN' },
  { key: 'sessionId', label: 'SESSION' },
  { key: 'status', label: 'STATUS' },
  { key: 'nextRunAtIso', label: 'NEXT_RUN' },
  { key: 'lastStatus', label: 'LAST' },
] as const;

export function registerCronCommands(program: Command, app: AppContext): void {
  const cron = program.command('cron').description('Cron / one-shot scheduled jobs (FEAT-033)');

  cron
    .command('list')
    .description('List cron jobs')
    .option('--session <id>', 'filter by session id')
    .option('--status <status>', 'filter by status (pending|running|done|failed|cancelled|missed)')
    .option('--enabled <bool>', 'filter by enabled (true|false)')
    .option('--limit <n>', 'max rows', '200')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.cron.listJobs(buildServiceContext(app), {
          ...(opts.session ? { sessionId: String(opts.session) } : {}),
          ...(opts.status ? { status: parseStatus(String(opts.status)) } : {}),
          ...(opts.enabled !== undefined ? { enabled: parseBool(String(opts.enabled)) } : {}),
          ...(opts.limit !== undefined ? { limit: Number.parseInt(String(opts.limit), 10) } : {}),
        });
        if (mode === 'json') {
          for (const item of result.items) app.stdout.write(`${JSON.stringify({ ok: true, data: item })}\n`);
          app.stdout.write(`${JSON.stringify({ ok: true, summary: { total: result.count } })}\n`);
          return;
        }
        renderHumanTable(
          result.items.map(toRowProjection),
          CRON_TABLE_COLUMNS as unknown as Array<{ key: string; label: string }>,
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${result.count} cron job(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  cron
    .command('show')
    .argument('<id>', 'cron job id')
    .description('Show one cron job')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const job = services.cron.getJob(buildServiceContext(app), id);
        if (mode === 'json') {
          renderJson(job, { stdout: app.stdout });
          return;
        }
        renderHumanRecord(job as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  cron
    .command('create')
    .description('Register a cron or once job')
    .requiredOption('--task <text>', 'task input fed to the agent at fire time')
    .requiredOption('--session <id>', 'session id this job belongs to')
    .option('--cron <expr>', 'cron expression (5/6 fields, optional `TZ=<zone>` prefix)')
    .option('--once <iso>', 'ISO-8601 timestamp with explicit Z or ±HH:MM offset')
    .option('--agent <id>', `agent id (default: ${DEFAULT_AGENT_ID})`)
    .option('--retry-max <n>', 'retry attempts after first failure', '3')
    .option('--retry-backoff <kind>', 'exponential | linear | fixed', 'exponential')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const cronExpr = opts.cron ? String(opts.cron) : undefined;
        const onceExpr = opts.once ? String(opts.once) : undefined;
        if ((!cronExpr && !onceExpr) || (cronExpr && onceExpr)) {
          throw new CommanderExit(2, 'pass exactly one of --cron <expr> or --once <iso>');
        }
        const input: CreateCronJobInput = {
          sessionId: String(opts.session),
          taskInput: String(opts.task),
          mode: cronExpr ? 'cron' : 'once',
          when: cronExpr ?? onceExpr!,
          ...(opts.agent ? { agentId: String(opts.agent) } : {}),
          retryPolicy: {
            max: Number.parseInt(String(opts['retryMax'] ?? opts['retry-max'] ?? 3), 10),
            backoff: parseBackoff(String(opts['retryBackoff'] ?? opts['retry-backoff'] ?? 'exponential')),
          },
        };
        const job = services.cron.createJob(buildServiceContext(app), input);
        if (mode === 'json') {
          renderJson(job, { stdout: app.stdout });
          return;
        }
        app.stdout.write(`Created cron job ${job.id}\n`);
        renderHumanRecord(job as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  cron
    .command('cancel')
    .argument('<id>', 'cron job id')
    .description('Cancel a cron job (idempotent)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const job = await services.cron.cancelJob(buildServiceContext(app), id);
        if (mode === 'json') {
          renderJson(job, { stdout: app.stdout });
          return;
        }
        app.stdout.write(`Cancelled cron job ${job.id} (status=${job.status})\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  cron
    .command('trigger')
    .argument('<id>', 'cron job id')
    .description('Force next_run_at = now so the next tick picks it up')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const job = services.cron.triggerJob(buildServiceContext(app), id);
        if (mode === 'json') {
          renderJson(job, { stdout: app.stdout });
          return;
        }
        app.stdout.write(`Triggered cron job ${job.id} (next_run_at=${formatEpoch(job.nextRunAt)})\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  cron
    .command('tick')
    .description('Run one tick now (CI / debug / system cron — does not loop)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      const storage = openCronStorage(app);
      try {
        const outcome = await coreCron.tick({
          storage,
          agentRunner: app.runner,
          defaultAgentId: DEFAULT_AGENT_ID,
        });
        if (mode === 'json') {
          renderJson(outcome, { stdout: app.stdout });
          return;
        }
        if (outcome.skipped === 'lease-held') {
          app.stdout.write('Skipped: another process holds the cron lease.\n');
          return;
        }
        app.stdout.write(`Ran ${outcome.ranCount} due cron job(s).\n`);
        if (outcome.ranCount > 0) {
          renderHumanTable(
            outcome.results,
            [
              { key: 'jobId', label: 'JOB' },
              { key: 'status', label: 'STATUS' },
              { key: 'attempts', label: 'ATTEMPTS' },
              { key: 'finalErrorCode', label: 'ERROR' },
            ],
            { stdout: app.stdout },
          );
        }
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      } finally {
        storage.close();
      }
    });

  cron
    .command('daemon')
    .description('Run a foreground tick loop until SIGINT/SIGTERM')
    .option('--interval-ms <n>', 'tick cadence in milliseconds', String(coreCron.DEFAULT_TICK_INTERVAL_MS ?? 60_000))
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      const intervalMs = opts['intervalMs'] !== undefined
        ? Number.parseInt(String(opts['intervalMs']), 10)
        : Number.parseInt(String(opts['interval-ms'] ?? 60_000), 10);
      const storage = openCronStorage(app);
      const host = coreCron.createCronTickHost({
        storage,
        agentRunner: app.runner,
        defaultAgentId: DEFAULT_AGENT_ID,
        intervalMs,
        logger: app.logger,
        onTick: (outcome) => {
          if (outcome.skipped === 'lease-held') return; // quiet — another process is the leader
          if (outcome.ranCount > 0) {
            app.logger.info?.({ ran: outcome.ranCount }, 'cron tick dispatched jobs');
          }
        },
      });
      const stopOnSignal = async (signal: NodeJS.Signals): Promise<void> => {
        app.logger.info?.({ signal }, 'cron daemon received signal, stopping');
        await host.stop();
        storage.close();
        process.off('SIGINT', sigint);
        process.off('SIGTERM', sigterm);
      };
      const sigint = (): void => { void stopOnSignal('SIGINT'); };
      const sigterm = (): void => { void stopOnSignal('SIGTERM'); };
      process.on('SIGINT', sigint);
      process.on('SIGTERM', sigterm);
      app.stdout.write(`cron daemon started (interval=${intervalMs}ms; press Ctrl-C to stop)\n`);
      host.start();
      // Keep the process alive until a signal flips host.running false.
      await waitUntilStopped(host);
    });
}

function openCronStorage(app: AppContext): import('@haro/core/cron').CronStorage {
  return new coreCron.CronStorage({
    ...(app.opts.root ? { root: app.opts.root } : {}),
    dbFile: app.paths.dbFile,
  });
}

async function waitUntilStopped(host: { running: boolean }): Promise<void> {
  // Poll the host running flag once per second; the signal handler flips it.
  // unref'd setTimeout means we don't hold the loop alive ourselves.
  while (host.running) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1_000);
      t.unref?.();
    });
  }
}

function toRowProjection(job: CronJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    mode: job.mode,
    whenExpr: job.whenExpr,
    sessionId: job.sessionId,
    status: job.status,
    nextRunAtIso: formatEpoch(job.nextRunAt),
    lastStatus: job.lastStatus ?? '-',
  };
}

function formatEpoch(epoch: number | null): string {
  if (epoch === null) return '-';
  return new Date(epoch).toISOString();
}

function parseBool(raw: string): boolean {
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new CommanderExit(2, `--enabled expects true|false (got '${raw}')`);
}

function parseStatus(raw: string): CronJobStatus {
  const valid: CronJobStatus[] = ['pending', 'running', 'done', 'failed', 'cancelled', 'cancelled-forced', 'missed'];
  if (!valid.includes(raw as CronJobStatus)) {
    throw new CommanderExit(2, `--status expects one of ${valid.join('|')} (got '${raw}')`);
  }
  return raw as CronJobStatus;
}

function parseBackoff(raw: string): RetryBackoff {
  const valid: RetryBackoff[] = ['exponential', 'linear', 'fixed'];
  if (!valid.includes(raw as RetryBackoff)) {
    throw new CommanderExit(2, `--retry-backoff expects one of ${valid.join('|')} (got '${raw}')`);
  }
  return raw as RetryBackoff;
}
