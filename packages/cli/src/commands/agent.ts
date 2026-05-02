/**
 * `haro agent` command tree (FEAT-039 R3).
 *
 * Singular topic for fine-grained agent control:
 *   list / show / create / edit / delete / validate / test
 *
 * Heavy lifting goes through `services.agents` so web-api routes and CLI
 * see the same yaml validation / persistence rules.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { DEFAULT_AGENT_YAML, HaroError, services } from '@haro/core';
import {
  confirmDestructive,
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags {
  json?: boolean;
  human?: boolean;
}

export function registerAgentCommands(program: Command, app: AppContext): void {
  const agent = program.command('agent').description('Agent management (FEAT-039 R3)');

  agent
    .command('list')
    .description('List registered agents (in-memory registry)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      const items = services.agents.listAgents(app.agentRegistry);
      if (mode === 'json') {
        for (const item of items) app.stdout.write(`${JSON.stringify({ ok: true, data: item })}\n`);
        return;
      }
      renderHumanTable(
        items,
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'NAME' },
          { key: 'defaultProvider', label: 'PROVIDER' },
          { key: 'defaultModel', label: 'MODEL' },
          { key: 'summary', label: 'SUMMARY' },
        ],
        { stdout: app.stdout },
      );
    });

  agent
    .command('show')
    .argument('<id>', 'agent id')
    .description('Show agent detail (registry view)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const detail = services.agents.getAgent(app.agentRegistry, id);
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

  agent
    .command('create')
    .argument('<id>', 'new agent id (kebab-case)')
    .description('Create an agent yaml from template; --from-template default for now')
    .option('--from-template <name>', 'template name', 'default')
    .action(async (id: string, opts: { fromTemplate: string }) => {
      try {
        const idError = services.agents.validateAgentId(id);
        if (idError) {
          throw new HaroError('AGENT_ID_INVALID', idError, {
            remediation: 'Use kebab-case matching ^[a-z0-9][a-z0-9-]*[a-z0-9]$',
          });
        }
        if (opts.fromTemplate !== 'default') {
          throw new HaroError('UNSUPPORTED', `Unknown template '${opts.fromTemplate}'`, {
            remediation: "Only --from-template default is supported in batch 1",
          });
        }
        const yaml = DEFAULT_AGENT_YAML.replace(/^id: .*/m, `id: ${id}`);
        const result = await services.agents.createAgentFromYaml(buildServiceContext(app), yaml);
        await reloadAgentRegistry(app);
        app.stdout.write(`agent '${result.id}' created at ${services.agents.getAgentYamlFile(buildServiceContext(app), result.id)}\n`);
        app.stdout.write(`run \`haro agent edit ${result.id}\` to customize the system prompt\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  agent
    .command('edit')
    .argument('<id>', 'agent id')
    .description('Open the agent yaml in $EDITOR')
    .action(async (id: string) => {
      try {
        const filePath = services.agents.getAgentYamlFile(buildServiceContext(app), id);
        if (!existsSync(filePath)) {
          throw new HaroError('AGENT_NOT_FOUND', `Agent yaml '${id}' not found at ${filePath}`, {
            remediation: `Create it via \`haro agent create ${id} --from-template default\``,
          });
        }
        const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
        await new Promise<void>((resolve, reject) => {
          const child = spawn(editor, [filePath], { stdio: 'inherit' });
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${editor} exited with code ${code ?? 'null'}`))));
          child.on('error', reject);
        });
        // Re-validate after edit
        const yaml = await readFile(filePath, 'utf8');
        const validation = services.agents.validateAgentYaml(yaml, id);
        if (!validation.ok) {
          const err = new HaroError('AGENT_VALIDATION_FAILED', 'Edited yaml failed validation', {
            details: { issues: validation.issues },
            remediation: 'Fix issues then run `haro agent validate <id>`',
          });
          renderError(err, { stderr: app.stderr });
          throw new CommanderExit(1, err.message);
        }
        await reloadAgentRegistry(app);
        app.stdout.write(`agent '${id}' updated\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  agent
    .command('delete')
    .argument('<id>', 'agent id')
    .description('Delete an agent yaml (audit-logged, irreversible)')
    .option('-y, --yes', 'skip confirmation')
    .option('--quiet', 'skip preview banner')
    .action(async (id: string, opts: { yes?: boolean; quiet?: boolean }) => {
      try {
        const defaultAgentId = app.loaded.config.defaultAgent ?? 'haro-assistant';
        const filePath = services.agents.getAgentYamlFile(buildServiceContext(app), id);
        const confirm = await confirmDestructive(
          {
            action: 'delete',
            target: `agent '${id}'`,
            preview: `Will delete ${filePath}. The agent will no longer appear in registries; existing sessions stay.`,
            ...(opts.yes ? { yes: true } : {}),
            ...(opts.quiet ? { quiet: true } : {}),
          },
          { stdin: app.stdin, stdout: app.stdout, stderr: app.stderr },
        );
        if (!confirm.confirmed) {
          app.stdout.write(`delete cancelled: ${confirm.reason}\n`);
          return;
        }
        await services.agents.deleteAgent(buildServiceContext(app), id, defaultAgentId);
        await reloadAgentRegistry(app);
        app.stdout.write(`agent '${id}' deleted\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  agent
    .command('validate')
    .argument('<id>', 'agent id')
    .description('Re-run yaml + Zod schema validation')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const yaml = await services.agents.readAgentYaml(buildServiceContext(app), id);
        const validation = services.agents.validateAgentYaml(yaml.yaml, id);
        if (mode === 'json') {
          renderJson(validation, { stdout: app.stdout });
          return;
        }
        if (validation.ok) {
          app.stdout.write(`agent '${id}' OK (no issues)\n`);
          return;
        }
        app.stdout.write(`agent '${id}' has ${validation.issues.length} issue(s):\n`);
        for (const issue of validation.issues) {
          app.stdout.write(`  - [${issue.code ?? 'schema'}] ${issue.path}: ${issue.message}\n`);
        }
        throw new CommanderExit(1, 'agent validation failed');
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  agent
    .command('test')
    .argument('<id>', 'agent id')
    .description('Run a sandbox task (no memory, no channel side-effects)')
    .requiredOption('--task <task>', 'sandbox task text')
    .action(async (id: string, opts: { task: string }) => {
      try {
        services.agents.getAgent(app.agentRegistry, id);
        app.stdout.write(`Running sandbox task on '${id}' (no memory, fresh continuation)...\n`);
        const result = await app.runner.run({
          task: opts.task,
          agentId: id,
          noMemory: true,
          // FEAT-039 R3 sandbox: must NOT pick up the latest completed
          // session as continuation, otherwise tests pollute / are polluted
          // by real chat history.
          continueLatestSession: false,
        });
        if (result.finalEvent.type === 'result') {
          app.stdout.write(`OK — ${result.events.length} event(s)\n`);
        } else {
          app.stderr.write(`FAILED — ${result.finalEvent.message}\n`);
          throw new CommanderExit(1, result.finalEvent.message);
        }
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

async function reloadAgentRegistry(app: AppContext): Promise<void> {
  app.agentRegistry = await services.agents.reloadAgentsFromDisk({
    ...buildServiceContext(app),
    providerRegistry: app.providerRegistry,
  });
}
