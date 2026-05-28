/**
 * `haro memory` command tree (FEAT-039 R4).
 *
 * Haro-owned memory write surfaces were retired in FEAT-081X/F-2.
 * Haro-owned CLI memory read/forensic surfaces were retired in FEAT-081X/F-4.
 * The command shape is intentionally preserved for compatibility, but all
 * actions fail closed and do not read/export/recover/migrate real memory data.
 */

import type { Command } from 'commander';
import { CommanderExit, type AppContext } from '../index.js';

export const MEMORY_REMEMBER_RETIRED_MESSAGE =
  'Haro-owned memory write surfaces have been retired in FEAT-081X/F-2; use AgentDock memory / aria-memory-vault for durable memory writes. Haro now keeps only AgentDock self-evolution sidecar workflows plus protected historical memory data that is not written by this CLI.';

export const MEMORY_CLI_READ_RETIRED_MESSAGE =
  'Haro-owned CLI memory read/forensic surfaces have been retired in FEAT-081X/F-4. Haro now keeps only AgentDock self-evolution sidecar proposal/review workflows; real historical ~/.haro memory data is not read, deleted, exported, recovered, or migrated by these commands. Use AgentDock memory / aria-memory-vault ownership paths for memory access.';

function failClosedMemoryCliRead(app: AppContext): never {
  app.stderr.write(`${MEMORY_CLI_READ_RETIRED_MESSAGE}\n`);
  throw new CommanderExit(1, MEMORY_CLI_READ_RETIRED_MESSAGE);
}

export function registerMemoryCommands(program: Command, app: AppContext): void {
  const memory = program.command('memory').description('Retired Memory Fabric command group (FEAT-081X/F-4)');

  memory
    .command('query')
    .argument('<query>', 'retired free-text query (FTS5)')
    .description('Retired CLI memory read surface')
    .option('--scope <scope>', 'platform | shared | agent')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--layer <layer>', 'session | persistent | skill')
    .option('--verification <status>', 'unverified | verified | conflicted | rejected')
    .option('--page-size <n>', 'page size')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((_query: string, _opts: Record<string, string | boolean | undefined>) => {
      failClosedMemoryCliRead(app);
    });

  memory
    .command('remember')
    .argument('<text>', 'memory content (free text)')
    .description('Retired memory write surface')
    .option('--scope <scope>', 'shared | agent')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--topic <topic>', 'memory topic; defaults to first 60 chars of content')
    .option('--summary <summary>', 'optional one-line summary')
    .option('--source <source>', 'sourceRef tag', 'cli')
    .option('--tags <tags...>', 'space-separated tags')
    .option('--layer <layer>', 'session | persistent | skill', 'persistent')
    .action((_text: string, _opts: Record<string, string | string[] | undefined>) => {
      app.stderr.write(`${MEMORY_REMEMBER_RETIRED_MESSAGE}\n`);
      throw new CommanderExit(1, MEMORY_REMEMBER_RETIRED_MESSAGE);
    });

  memory
    .command('list')
    .description('Retired CLI memory list surface')
    .option('--scope <scope>', 'platform | shared | agent', 'shared')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .option('--page-size <n>', 'page size', '50')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((_opts: Record<string, string | boolean | undefined>) => {
      failClosedMemoryCliRead(app);
    });

  memory
    .command('show')
    .argument('<id>', 'memory entry id')
    .description('Retired CLI memory show surface')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((_id: string, _opts: { json?: boolean; human?: boolean }) => {
      failClosedMemoryCliRead(app);
    });

  memory
    .command('recover-snapshot')
    .description('Retired CLI memory snapshot recovery surface')
    .option('--db <path>', 'override v1 db path (defaults to <haro root>/haro.db)')
    .option('--from <bak>', 'explicit .bak.<ISO> snapshot (must be next to --db; default: newest)')
    .option('-y, --yes', 'skip confirmation')
    .option('--quiet', 'skip preview banner')
    .action((_opts: { db?: string; from?: string; yes?: boolean; quiet?: boolean }) => {
      failClosedMemoryCliRead(app);
    });

  memory
    .command('export')
    .description('Retired CLI memory export surface')
    .option('--scope <scope>', 'platform | shared | agent', 'shared')
    .option('--agent <id>', 'agent id (required when scope=agent)')
    .requiredOption('-o, --output <file>', 'output JSON file path')
    .action((_opts: { scope: string; agent?: string; output: string }) => {
      failClosedMemoryCliRead(app);
    });
}
