/**
 * `haro logs` command tree (FEAT-039 R5).
 *
 *   tail [--session <id>] — poll session_events
 *   show --since <dur> --component <c> — page through events
 *   export --since <dur> --output <file> — JSONL dump
 *
 * `tail` is a simple polling loop (1s interval). Ctrl+C exits cleanly.
 */

import { writeFile, appendFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { services } from '@haro/core';
import {
  renderError,
  renderHumanTable,
  renderListJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

export function registerLogsCommands(program: Command, app: AppContext): void {
  const logs = program.command('logs').description('Runtime logs / session events (FEAT-039 R5)');

  logs
    .command('tail')
    .description('Follow session events; Ctrl+C exits')
    .option('--session <id>', 'tail a specific session')
    .option('--component <c>', 'filter by component (provider | channel | workflow)')
    .option('--interval <ms>', 'poll interval', '1000')
    .action(async (opts: { session?: string; component?: string; interval: string }) => {
      const intervalMs = Math.max(200, Number.parseInt(opts.interval, 10) || 1000);
      // Compound cursor `(createdAt, id)` matches the service's tie-break
      // order, so bursts of events sharing a timestamp don't get dropped
      // when more than one page worth lands inside the same second
      // (Codex adversarial review 2026-05-02 medium).
      let lastSeenAt = '1970-01-01T00:00:00Z';
      let lastSeenId = -1;
      const stop = new AbortController();
      process.on('SIGINT', () => stop.abort());
      try {
        while (!stop.signal.aborted) {
          // Drain pages while the API keeps returning full pages — same
          // burst stays inside one tick so nothing falls past the cursor.
          let drained = false;
          while (!drained && !stop.signal.aborted) {
            const page = services.logs.listSessionEventLogs(buildServiceContext(app), {
              ...(opts.session ? { sessionId: opts.session } : {}),
              from: lastSeenAt,
              sort: 'createdAt',
              order: 'asc',
              pageSize: '200',
            });
            const fresh = page.items.filter((row) =>
              row.createdAt > lastSeenAt
              || (row.createdAt === lastSeenAt && row.id > lastSeenId),
            );
            for (const event of fresh) {
              app.stdout.write(`${event.createdAt}  ${event.sessionId}  ${event.eventType}\n`);
              lastSeenAt = event.createdAt;
              lastSeenId = event.id;
            }
            // If the service returned fewer than the page size OR nothing
            // new, we've caught up; sleep and resume.
            drained = page.items.length < 200 || fresh.length === 0;
          }
          await sleep(intervalMs, stop.signal);
        }
      } catch (error) {
        if (stop.signal.aborted) return;
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  logs
    .command('show')
    .description('Show recent events')
    .option('--session <id>', 'filter by session')
    .option('--component <c>', 'provider | channel | workflow (matches event_type prefix)')
    .option('--since <iso>', 'ISO timestamp lower bound')
    .option('--page-size <n>', 'page size', '50')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.logs.listSessionEventLogs(buildServiceContext(app), {
          ...(opts.session ? { sessionId: String(opts.session) } : {}),
          ...(opts.since ? { from: String(opts.since) } : {}),
          ...(opts.pageSize ? { pageSize: String(opts.pageSize) } : {}),
        });
        const filtered = opts.component
          ? result.items.filter((row) => row.eventType.startsWith(`${String(opts.component)}.`)
              || row.eventType.includes(String(opts.component)))
          : result.items;
        if (mode === 'json') {
          renderListJson({ ...result, items: filtered }, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          filtered,
          [
            { key: 'createdAt', label: 'TIME' },
            { key: 'sessionId', label: 'SESSION' },
            { key: 'eventType', label: 'TYPE' },
            { key: 'agentId', label: 'AGENT' },
            { key: 'provider', label: 'PROVIDER' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${filtered.length} of ${result.total} event(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  logs
    .command('export')
    .description('Export events to a JSONL file (paginates to completion)')
    .option('--session <id>', 'filter by session')
    .option('--since <iso>', 'ISO lower bound')
    .requiredOption('-o, --output <file>', 'output JSONL file')
    .action(async (opts: { session?: string; since?: string; output: string }) => {
      try {
        await writeFile(opts.output, '', 'utf8');
        const pageSize = 200;
        let page = 1;
        let total = 0;
        while (true) {
          const result = services.logs.listSessionEventLogs(buildServiceContext(app), {
            ...(opts.session ? { sessionId: opts.session } : {}),
            ...(opts.since ? { from: opts.since } : {}),
            page: String(page),
            pageSize: String(pageSize),
            sort: 'createdAt',
            order: 'asc',
          });
          if (result.items.length === 0) break;
          const lines = result.items.map((event) => `${JSON.stringify(event)}\n`).join('');
          await appendFile(opts.output, lines, 'utf8');
          total += result.items.length;
          if (result.items.length < pageSize) break;
          page += 1;
        }
        app.stdout.write(`exported ${total} event(s) → ${opts.output}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

