/**
 * `haro memory` command tree (FEAT-039 R4).
 *
 *   query  — FTS5 search (delegates to services.memory.queryMemory)
 *   remember — write a new memory entry (services.memory.writeMemoryEntry)
 *   list — query with no keyword
 *   show <id> — query and pick a single entry
 *   export --output <dir> — JSON dump of all entries in a scope
 */

import { writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { DEFAULT_AGENT_ID, services } from '@haro/core';
import {
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  renderListJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

export function registerMemoryCommands(program: Command, app: AppContext): void {
  const memory = program.command('memory').description('Memory Fabric query / remember / list / export (FEAT-039 R4)');

  memory
    .command('query')
    .argument('<query>', 'free-text query (FTS5)')
    .description('Search memory entries')
    .option('--scope <scope>', 'platform | shared | agent')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--layer <layer>', 'session | persistent | skill')
    .option('--verification <status>', 'unverified | verified | conflicted | rejected')
    .option('--page-size <n>', 'page size')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((query: string, opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.memory.queryMemory(buildServiceContext(app), {
          q: query,
          ...(opts.scope ? { scope: opts.scope as 'platform' | 'shared' | 'agent' } : {}),
          ...(opts.agent ? { agentId: String(opts.agent) } : {}),
          ...(opts.layer ? { layer: opts.layer as 'session' | 'persistent' | 'skill' } : {}),
          ...(opts.verification ? { verificationStatus: opts.verification as 'unverified' | 'verified' | 'conflicted' | 'rejected' } : {}),
          ...(opts.pageSize ? { pageSize: String(opts.pageSize) } : {}),
        });
        if (mode === 'json') {
          renderListJson(result, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          result.items.map((item) => ({
            score: item.score.toFixed(2),
            topic: item.entry.topic,
            scope: item.entry.scope,
            layer: item.entry.layer,
            updatedAt: item.entry.updatedAt,
          })),
          [
            { key: 'score', label: 'SCORE' },
            { key: 'topic', label: 'TOPIC' },
            { key: 'scope', label: 'SCOPE' },
            { key: 'layer', label: 'LAYER' },
            { key: 'updatedAt', label: 'UPDATED' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${result.total} match(es)\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  memory
    .command('remember')
    .argument('<text>', 'memory content (free text)')
    .description('Write a new memory entry')
    .requiredOption('--scope <scope>', 'shared | agent')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--topic <topic>', 'memory topic; defaults to first 60 chars of content')
    .option('--summary <summary>', 'optional one-line summary')
    .option('--source <source>', 'sourceRef tag', 'cli')
    .option('--tags <tags...>', 'space-separated tags')
    .option('--layer <layer>', 'session | persistent | skill', 'persistent')
    .action(async (text: string, opts: Record<string, string | string[] | undefined>) => {
      try {
        const scope = opts.scope as 'shared' | 'agent';
        const currentAgentId = app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? DEFAULT_AGENT_ID;
        const agentId = (opts.agent as string | undefined) ?? (scope === 'agent' ? currentAgentId : undefined);
        const entry = await services.memory.writeMemoryEntry(
          buildServiceContext(app),
          {
            scope,
            ...(agentId ? { agentId } : {}),
            layer: (opts.layer ?? 'persistent') as 'session' | 'persistent' | 'skill',
            topic: (opts.topic as string | undefined) ?? text.split(/\s+/).slice(0, 8).join(' ').slice(0, 60),
            ...(opts.summary ? { summary: String(opts.summary) } : {}),
            content: text,
            sourceRef: (opts.source as string | undefined) ?? 'cli',
            ...(Array.isArray(opts.tags) ? { tags: opts.tags } : {}),
          },
          { currentAgentId },
        );
        app.stdout.write(`memory entry created: ${entry.id} (scope=${entry.scope}, layer=${entry.layer})\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  memory
    .command('list')
    .description('List entries in a scope (no keyword)')
    .option('--scope <scope>', 'platform | shared | agent', 'shared')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--page-size <n>', 'page size', '50')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: Record<string, string | boolean | undefined>) => {
      const mode = resolveOutputMode(opts as OutputFlags, app.stdout);
      try {
        const result = services.memory.queryMemory(buildServiceContext(app), {
          scope: opts.scope as 'platform' | 'shared' | 'agent',
          ...(opts.agent ? { agentId: String(opts.agent) } : {}),
          pageSize: String(opts.pageSize ?? 50),
        });
        if (mode === 'json') {
          renderListJson(result, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          result.items.map((item) => ({
            id: item.entry.id,
            topic: item.entry.topic,
            layer: item.entry.layer,
            verification: item.entry.verificationStatus,
            updatedAt: item.entry.updatedAt,
          })),
          [
            { key: 'id', label: 'ID' },
            { key: 'topic', label: 'TOPIC' },
            { key: 'layer', label: 'LAYER' },
            { key: 'verification', label: 'STATE' },
            { key: 'updatedAt', label: 'UPDATED' },
          ],
          { stdout: app.stdout },
        );
        app.stdout.write(`\n${result.total} entries\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  memory
    .command('show')
    .argument('<id>', 'memory entry id')
    .description('Show a single memory entry')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((id: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        // No direct getById in service yet — query and filter.
        const result = services.memory.queryMemory(buildServiceContext(app), { pageSize: '1000' });
        const hit = result.items.find((item) => item.entry.id === id);
        if (!hit) {
          throw new CommanderExit(1, `memory entry '${id}' not found`);
        }
        if (mode === 'json') {
          renderJson(hit.entry, { stdout: app.stdout });
          return;
        }
        renderHumanRecord(hit.entry as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        if (error instanceof CommanderExit) throw error;
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  memory
    .command('export')
    .description('Export memory entries to a JSON file')
    .option('--scope <scope>', 'platform | shared | agent', 'shared')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .requiredOption('-o, --output <file>', 'output JSON file path')
    .action(async (opts: { scope: string; agent?: string; output: string }) => {
      try {
        const result = services.memory.queryMemory(buildServiceContext(app), {
          scope: opts.scope as 'platform' | 'shared' | 'agent',
          ...(opts.agent ? { agentId: opts.agent } : {}),
          pageSize: '1000',
        });
        await writeFile(
          opts.output,
          JSON.stringify({ scope: opts.scope, count: result.total, entries: result.items.map((i) => i.entry) }, null, 2),
          'utf8',
        );
        app.stdout.write(`exported ${result.total} entries → ${opts.output}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}
