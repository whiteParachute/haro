/**
 * `haro budget` command tree (FEAT-039 R7).
 *
 *   show — list workflow budgets (or one with --workflow <id>)
 *   audit --since <iso> [--outcome ...] — recent audit events
 *   set --agent <id> — currently unsupported (no per-agent budget table);
 *                       prints a clear "carry-over" message.
 */

import type { Command } from 'commander';
import { services } from '@haro/core';
import {
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

export function registerBudgetCommands(program: Command, app: AppContext): void {
  const budget = program.command('budget').description('Token / permission budget (FEAT-039 R7)');

  budget
    .command('show')
    .description('Show workflow budgets')
    .option('--workflow <id>', 'show one workflow only')
    .option('--limit <n>', 'list size when --workflow is absent', '20')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        if (opts.workflow) {
          const summary = services.budget.getWorkflowBudget(buildServiceContext(app), String(opts.workflow));
          if (mode === 'json') {
            renderJson(summary, { stdout: app.stdout });
            return;
          }
          renderHumanRecord(summary as unknown as Record<string, unknown>, { stdout: app.stdout });
          return;
        }
        const items = services.budget.listWorkflowBudgets(buildServiceContext(app), {
          limit: opts.limit !== undefined ? Number.parseInt(String(opts.limit), 10) : 20,
        });
        if (mode === 'json') {
          for (const item of items) app.stdout.write(`${JSON.stringify({ ok: true, data: item })}\n`);
          app.stdout.write(`${JSON.stringify({ ok: true, summary: { total: items.length } })}\n`);
          return;
        }
        renderHumanTable(
          items.map((item) => ({
            workflowId: item.workflowId,
            state: item.budget?.state ?? '-',
            usedTokens: item.budget?.usedTotalTokens ?? 0,
            limitTokens: item.budget?.limitTokens ?? 0,
            permissionsDenied: item.permissions.denied,
          })),
          [
            { key: 'workflowId', label: 'WORKFLOW' },
            { key: 'state', label: 'STATE' },
            { key: 'usedTokens', label: 'USED' },
            { key: 'limitTokens', label: 'LIMIT' },
            { key: 'permissionsDenied', label: 'DENIED' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${items.length} workflow budget(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  budget
    .command('audit')
    .description('Audit log: budget / permission events')
    .option('--since <iso>', 'ISO timestamp lower bound')
    .option('--outcome <outcome>', 'denied | allowed | needs-approval | failure | success')
    .option('--type <prefix>', 'event_type prefix (budget | permission | session)')
    .option('--limit <n>', 'max rows', '100')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const events = services.budget.listAuditEvents(buildServiceContext(app), {
          ...(opts.since ? { since: String(opts.since) } : {}),
          ...(opts.outcome ? { outcome: String(opts.outcome) } : {}),
          ...(opts.type ? { eventTypePrefix: String(opts.type) } : {}),
          limit: opts.limit !== undefined ? Number.parseInt(String(opts.limit), 10) : 100,
        });
        if (mode === 'json') {
          for (const event of events) app.stdout.write(`${JSON.stringify({ ok: true, data: event })}\n`);
          app.stdout.write(`${JSON.stringify({ ok: true, summary: { total: events.length } })}\n`);
          return;
        }
        renderHumanTable(
          events.map((event) => ({
            createdAt: event.createdAt,
            eventType: event.eventType,
            outcome: event.outcome,
            workflowId: event.workflowId ?? '-',
            agentId: event.agentId ?? '-',
            reason: event.reason ?? '',
          })),
          [
            { key: 'createdAt', label: 'TIME' },
            { key: 'eventType', label: 'TYPE' },
            { key: 'outcome', label: 'OUTCOME' },
            { key: 'workflowId', label: 'WORKFLOW' },
            { key: 'agentId', label: 'AGENT' },
            { key: 'reason', label: 'REASON' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${events.length} event(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  budget
    .command('set')
    .description('[unsupported] Per-agent budget defaults')
    .option('--agent <id>', 'agent id')
    .option('--workflow <id>', 'workflow id')
    .option('--tokens <n>', 'token limit')
    .action(() => {
      app.stderr.write(
        '`budget set` is a Phase 1.5 follow-up — there is no per-agent default budget table yet.\n' +
        'Per-workflow budgets are created automatically by ScenarioRouter; tune them via the corresponding `agents/<id>.yaml` once that field lands.\n',
      );
      throw new CommanderExit(2, 'budget set is not implemented yet');
    });
}
