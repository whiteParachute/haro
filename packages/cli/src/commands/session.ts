/**
 * `haro session` command tree (FEAT-039 R2).
 *
 * Read paths (list / show / show --tail) call `services.sessions` directly.
 * `delete` runs the same service-layer transaction as Web API but emits
 * a CLI-side audit event-type ('cli.session.delete') so RBAC tracking
 * stays distinct from the Dashboard's own delete flow.
 *
 * `export` and `resume` are thin wrappers — `resume` enters the existing
 * REPL with `continueLatestSession=true` against the chosen session id.
 */

import { writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { HaroError, services } from '@haro/core';
import {
  confirmDestructive,
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  renderListJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext, type RunCliReplFn } from '../index.js';

export interface SessionCommandHooks {
  /** Bound to runRepl in index.ts so `session resume` can enter the loop. */
  runRepl: RunCliReplFn;
}

interface OutputFlags {
  json?: boolean;
  human?: boolean;
}

export function registerSessionCommands(program: Command, app: AppContext, hooks: SessionCommandHooks): void {
  const session = program.command('session').description('Session management (FEAT-039 R2)');

  session
    .command('list')
    .description('List sessions (default page size 20)')
    .option('--status <status>', 'filter by status')
    .option('--agent <id>', 'filter by agent id')
    .option('--page <n>', 'page number')
    .option('--page-size <n>', 'page size')
    .option('--limit <n>', 'legacy limit (alias for page-size)')
    .option('--offset <n>', 'legacy offset')
    .option('--sort <field>', 'sort field')
    .option('--order <asc|desc>', 'sort order')
    .option('-q, --query <q>', 'free-text query')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.sessions.listSessions(buildServiceContext(app), {
          ...(opts.status ? { status: String(opts.status) } : {}),
          ...(opts.agent ? { agentId: String(opts.agent) } : {}),
          ...(opts.page ? { page: String(opts.page) } : {}),
          ...(opts.pageSize ? { pageSize: String(opts.pageSize) } : {}),
          ...(opts.limit ? { limit: String(opts.limit) } : {}),
          ...(opts.offset ? { offset: String(opts.offset) } : {}),
          ...(opts.sort ? { sort: String(opts.sort) } : {}),
          ...(opts.order ? { order: String(opts.order) } : {}),
          ...(opts.query ? { q: String(opts.query) } : {}),
        });
        if (mode === 'json') {
          renderListJson(result, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          result.items,
          [
            { key: 'sessionId', label: 'SESSION' },
            { key: 'agentId', label: 'AGENT' },
            { key: 'status', label: 'STATUS' },
            { key: 'createdAt', label: 'CREATED' },
            { key: 'provider', label: 'PROVIDER' },
            { key: 'model', label: 'MODEL' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${result.total} session(s), page ${result.pageInfo.page}/${result.pageInfo.totalPages || 1}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  session
    .command('show')
    .argument('<id>', 'session id')
    .description('Show session detail; --tail prints the recent event stream')
    .option('--tail [n]', 'show last N events (default 100)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (id: string, opts: { tail?: string | boolean } & OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const detail = services.sessions.getSession(buildServiceContext(app), id);
        if (opts.tail !== undefined && opts.tail !== false) {
          const limit = typeof opts.tail === 'string' && opts.tail !== '' ? Number.parseInt(opts.tail, 10) : 100;
          const events = services.sessions.listSessionEvents(buildServiceContext(app), id, {
            limit: Number.isFinite(limit) ? limit : 100,
          });
          if (mode === 'json') {
            renderJson({ session: detail, events: events.items }, { stdout: app.stdout });
            return;
          }
          renderHumanRecord(detail as unknown as Record<string, unknown>, { stdout: app.stdout });
          app.stdout.write(`\nLast ${events.items.length} event(s):\n`);
          renderHumanTable(
            events.items,
            [
              { key: 'id', label: '#' },
              { key: 'eventType', label: 'TYPE' },
              { key: 'createdAt', label: 'AT' },
            ],
            { stdout: app.stdout },
          );
          return;
        }
        if (mode === 'json') {
          renderJson(detail, { stdout: app.stdout });
          return;
        }
        renderHumanRecord(detail as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  session
    .command('resume')
    .argument('<id>', 'session id to resume')
    .description('Resume the chosen session in chat REPL (interactive)')
    .action(async (id: string) => {
      const detail = services.sessions.tryGetSession(buildServiceContext(app), id);
      if (!detail) {
        const err = new HaroError('SESSION_NOT_FOUND', `Session '${id}' not found`, {
          remediation: 'Run `haro session list` to see available sessions',
        });
        renderError(err, { stderr: app.stderr });
        throw new CommanderExit(1, err.message);
      }
      app.stdout.write(`Resuming session ${detail.sessionId} (agent=${detail.agentId})...\n`);
      app.replState = {
        agentId: detail.agentId,
        providerOverride: app.cliState.defaultProvider,
        modelOverride: app.cliState.defaultModel,
        continueLatestSession: true,
        lastSessionId: detail.sessionId,
        resumeFromSessionId: detail.sessionId,
      };
      await hooks.runRepl(app);
    });

  session
    .command('export')
    .argument('<id>', 'session id')
    .description('Export session events; format=json|md, output=<file>. Paginates through all events.')
    .option('--format <fmt>', 'export format', 'json')
    .option('-o, --output <file>', 'output file path')
    .action(async (id: string, opts: { format: string; output?: string }) => {
      try {
        const detail = services.sessions.getSession(buildServiceContext(app), id);
        const events: services.sessions.SessionEvent[] = [];
        const pageSize = 500;
        let offset = 0;
        // listSessionEvents caps at 500 per call; loop until a short page.
        while (true) {
          const page = services.sessions.listSessionEvents(
            buildServiceContext(app),
            id,
            { limit: pageSize, offset },
          );
          events.push(...page.items);
          if (page.items.length < pageSize) break;
          offset += pageSize;
        }
        const format = opts.format === 'md' ? 'md' : 'json';
        const body = format === 'md'
          ? renderSessionMarkdown(detail, events)
          : JSON.stringify({ session: detail, events, exportedCount: events.length }, null, 2);
        if (opts.output) {
          await writeFile(opts.output, body, 'utf8');
          app.stdout.write(`exported ${events.length} events → ${opts.output}\n`);
          return;
        }
        app.stdout.write(`${body}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  session
    .command('delete')
    .argument('<id>', 'session id')
    .description('Delete a session and its events (audit-logged, irreversible)')
    .option('-y, --yes', 'skip confirmation')
    .option('--quiet', 'skip preview banner')
    .action(async (id: string, opts: { yes?: boolean; quiet?: boolean }) => {
      try {
        const detail = services.sessions.tryGetSession(buildServiceContext(app), id);
        if (!detail) {
          const err = new HaroError('SESSION_NOT_FOUND', `Session '${id}' not found`);
          renderError(err, { stderr: app.stderr });
          throw new CommanderExit(1, err.message);
        }
        const confirm = await confirmDestructive(
          {
            action: 'delete',
            target: `session '${id}'`,
            preview: `Will delete session ${detail.sessionId} (agent=${detail.agentId}, status=${detail.status}, createdAt=${detail.createdAt}) and all its events. This is irreversible.`,
            ...(opts.yes ? { yes: true } : {}),
            ...(opts.quiet ? { quiet: true } : {}),
          },
          { stdin: app.stdin, stdout: app.stdout, stderr: app.stderr },
        );
        if (!confirm.confirmed) {
          app.stdout.write(`delete cancelled: ${confirm.reason}\n`);
          return;
        }
        const result = services.sessions.deleteSession(buildServiceContext(app), id, {
          auditEventType: 'cli.session.delete',
        });
        if (result.outcome === 'not-found') {
          app.stdout.write(`session '${id}' was already gone\n`);
          return;
        }
        app.stdout.write(`session '${id}' deleted\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

function renderSessionMarkdown(session: services.sessions.SessionDetail, events: readonly services.sessions.SessionEvent[]): string {
  const lines: string[] = [
    `# Session ${session.sessionId}`,
    '',
    `- agent: \`${session.agentId}\``,
    `- provider: \`${session.provider}\``,
    `- model: \`${session.model}\``,
    `- status: ${session.status}`,
    `- createdAt: ${session.createdAt}`,
    `- endedAt: ${session.endedAt ?? '-'}`,
    '',
    `## Events (${events.length})`,
    '',
  ];
  for (const event of events) {
    lines.push(`### #${event.id} \`${event.eventType}\` @ ${event.createdAt}`, '', '```json', JSON.stringify(event.event, null, 2), '```', '');
  }
  return lines.join('\n');
}
