/**
 * `haro workflow` command tree (FEAT-039 R6).
 *
 *   list — recent workflows from checkpoint store
 *   show <id> — full detail (latest checkpoint + permission/budget summary)
 *   show <id> --json
 *   replay <id> — currently a read-only print of the checkpoint chain
 *                 (true replay needs a workflow runner reattach; deferred)
 *   checkpoints <id> — list available checkpoints
 */

import type { Command } from 'commander';
import { HaroError, services } from '@haro/core';
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

export function registerWorkflowCommands(program: Command, app: AppContext): void {
  const workflow = program.command('workflow').description('Workflow checkpoints + replay (FEAT-039 R6)');

  workflow
    .command('list')
    .description('List recent workflows by latest checkpoint')
    .option('--limit <n>', 'max rows', '20')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.workflows.listWorkflows(buildServiceContext(app), {
          limit: opts.limit !== undefined ? Number.parseInt(String(opts.limit), 10) : 20,
        });
        if (mode === 'json') {
          for (const item of result.items) app.stdout.write(`${JSON.stringify({ ok: true, data: item })}\n`);
          app.stdout.write(`${JSON.stringify({ ok: true, summary: { total: result.count } })}\n`);
          return;
        }
        renderHumanTable(
          result.items.map((item) => ({
            workflowId: item.workflowId,
            status: item.status,
            executionMode: item.executionMode,
            blockedReason: item.blockedReason ?? '',
            updatedAt: item.updatedAt,
          })),
          [
            { key: 'workflowId', label: 'WORKFLOW' },
            { key: 'status', label: 'STATUS' },
            { key: 'executionMode', label: 'MODE' },
            { key: 'blockedReason', label: 'BLOCKED' },
            { key: 'updatedAt', label: 'UPDATED' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${result.count} workflow(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  workflow
    .command('show')
    .argument('<id>', 'workflow id')
    .description('Show workflow detail with checkpoints + budget summary')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const detail = services.workflows.getWorkflow(buildServiceContext(app), id);
        if (mode === 'json') {
          renderJson(detail, { stdout: app.stdout });
          return;
        }
        renderHumanRecord(detail as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        if (error instanceof HaroError && error.code === 'WORKFLOW_NOT_FOUND') {
          renderError(error, { stderr: app.stderr }, { mode });
          throw new CommanderExit(1, error.message);
        }
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  workflow
    .command('checkpoints')
    .argument('<id>', 'workflow id')
    .description('List checkpoints for a workflow')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const data = services.workflows.listWorkflowCheckpoints(buildServiceContext(app), id);
        if (mode === 'json') {
          renderJson(data, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          data.items,
          [
            { key: 'checkpointId', label: 'CHECKPOINT' },
            { key: 'nodeId', label: 'NODE' },
            { key: 'status', label: 'STATUS' },
            { key: 'createdAt', label: 'CREATED' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${data.count} checkpoint(s)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  workflow
    .command('replay')
    .argument('<id>', 'workflow id')
    .description('[read-only] Print checkpoint chain for inspection')
    .action((id: string) => {
      try {
        const detail = services.workflows.getWorkflow(buildServiceContext(app), id);
        app.stdout.write(`workflow ${id} — ${detail.checkpoints.length} checkpoint(s)\n`);
        for (const checkpoint of detail.checkpoints) {
          app.stdout.write(`  ${checkpoint.createdAt}  ${checkpoint.checkpointId}  node=${checkpoint.nodeId}  status=${checkpoint.status ?? '-'}\n`);
        }
        app.stdout.write('\nNote: live replay requires a workflow runner attach; this is a read-only inspector.\n');
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}
