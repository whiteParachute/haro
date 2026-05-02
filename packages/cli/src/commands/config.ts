/**
 * `haro config get / set / unset` writes (FEAT-039 R10).
 *
 * The existing `haro config` (no args) read view stays in index.ts; this
 * module adds the write-side subcommands. Secret-bearing paths
 * (`providers.*.apiKey` etc.) are rejected upstream by the service layer.
 */

import type { Command } from 'commander';
import { services } from '@haro/core';
import { renderError, renderJson, resolveOutputMode } from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

export function registerConfigWriteCommands(parent: Command, app: AppContext): void {
  // `parent` is the existing `config` command from index.ts. We attach
  // get/set/unset under it without touching the no-arg read action.
  parent
    .command('get')
    .argument('<key>', 'dot-path key, e.g. providers.codex.defaultModel')
    .description('Read a config value (project > global > defaults)')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((key: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const result = services.config.getConfigValue(buildServiceContext(app), key);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        if (result.source === 'absent') {
          app.stdout.write(`${key}: (not set)\n`);
          return;
        }
        const where = result.path ? ` (${result.source}, ${result.path})` : ` (${result.source})`;
        app.stdout.write(`${key}: ${formatValue(result.value)}${where}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  parent
    .command('set')
    .argument('<key>', 'dot-path key')
    .argument('<value>', 'value (parsed as JSON when possible, else raw string)')
    .description('Write a config value to project or global YAML')
    .option('--scope <scope>', 'global | project', 'project')
    .action((key: string, raw: string, opts: { scope: string }) => {
      const scope = opts.scope === 'global' ? 'global' : 'project';
      try {
        const value = parseValue(raw);
        const result = services.config.setConfigValue(buildServiceContext(app), key, value, scope);
        app.stdout.write(`${result.key} = ${formatValue(result.value)} (${result.scope}, ${result.path})\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  parent
    .command('unset')
    .argument('<key>', 'dot-path key')
    .description('Remove a config value from project or global YAML')
    .option('--scope <scope>', 'global | project', 'project')
    .action((key: string, opts: { scope: string }) => {
      const scope = opts.scope === 'global' ? 'global' : 'project';
      try {
        const result = services.config.unsetConfigValue(buildServiceContext(app), key, scope);
        if (!result.removed) {
          app.stdout.write(`${key}: not present in ${result.scope} (${result.path})\n`);
          return;
        }
        app.stdout.write(`${key}: removed from ${result.scope} (${result.path})\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value);
}
