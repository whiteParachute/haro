/**
 * Standalone launcher for the Haro proposal review Web API. The Web surface is
 * intentionally narrow: it serves auth plus approval-request review endpoints;
 * the hosted Haro Web service owns the daily frontier intake loop without
 * requiring AgentDock code changes.
 */

import { createWebApp } from './index.js';
import { startWebServer } from './server.js';

interface ParsedFlags {
  port: number;
  host: string;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const env = process.env;
  let port = Number.parseInt(env.HARO_WEB_API_PORT ?? '3456', 10);
  let host = env.HARO_WEB_API_HOST ?? '127.0.0.1';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      if (!value) throw new Error('--port requires a value');
      port = Number.parseInt(value, 10);
      i += 1;
    } else if (arg?.startsWith('--port=')) {
      port = Number.parseInt(arg.slice('--port='.length), 10);
    } else if (arg === '--host' || arg === '-H') {
      const value = argv[i + 1];
      if (!value) throw new Error('--host requires a value');
      host = value;
      i += 1;
    } else if (arg?.startsWith('--host=')) {
      host = arg.slice('--host='.length);
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        `Usage: pnpm -F @haro/web-api start [-- --port <n>] [--host <addr>]\n` +
          `Env:   HARO_WEB_API_PORT, HARO_WEB_API_HOST\n`,
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return { port, host };
}

async function main(): Promise<void> {
  const { port, host } = parseFlags(process.argv.slice(2));
  const app = createWebApp();
  const handle = startWebServer(app, { port, host });
  await handle.ready;
  process.stdout.write(`@haro/web-api proposal review listening on ${handle.url}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start @haro/web-api: ${message}\n`);
  process.exit(1);
});
