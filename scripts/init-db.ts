#!/usr/bin/env node
import { initHaroDatabase } from '../packages/core/src/db/init.js';

function parseArgs(argv: string[]): { dbFile?: string; root?: string; quiet: boolean } {
  const out: { dbFile?: string; root?: string; quiet: boolean } = { quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db' || a === '--db-file') out.dbFile = argv[++i];
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--quiet' || a === '-q') out.quiet = true;
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = initHaroDatabase({ dbFile: args.dbFile, root: args.root });
  if (!args.quiet) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          dbFile: result.dbFile,
          journalMode: result.journalMode,
          fts5: result.fts5Available,
          tables: result.tables,
        },
        null,
        2,
      ) + '\n',
    );
  }
}

main();
