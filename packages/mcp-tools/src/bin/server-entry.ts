/**
 * CLI entry for the per-session MCP server subprocess (FEAT-032 R10 / D1).
 *
 * Usage (typically spawned by AgentRunner):
 *   node dist/bin/server-entry.js <session-context-json> [<config-json>]
 *
 * The first arg is a JSON-encoded SessionContext; the second is optional
 * config (root / dbFile so the subprocess can open its own MemoryFabric /
 * EvolutionAssetRegistry / cron service-context view).
 *
 * **Subprocess scaffolding caveat (Codex review BLOCKER #1 / #3)**: A
 * subprocess spawned this way has its own empty ChannelRegistry — it cannot
 * deliver `send_message` to the parent process's live channels because IPC
 * marshaling of channel adapters is not implemented in this FEAT. The
 * subprocess will return TARGET_NOT_FOUND for any channelId. For the
 * production "agent uses MCP tools" path Haro currently embeds McpServer
 * in-process via `createDefaultRegistry({ audit })` and passes the parent's
 * deps directly. The subprocess entry exists so AgentRunner can satisfy the
 * spec-mandated per-session lifecycle (R10 / AC6) and so future provider
 * wiring can plug a real client onto it; the lifecycle test in
 * `packages/core/test/mcp-session.test.ts` already verifies SIGTERM →
 * SIGKILL behaviour with a real subprocess.
 */

import process from 'node:process';
import { createMemoryFabric } from '@haro/core/memory';
import { ChannelRegistry } from '@haro/channel';
import { createEvolutionAssetRegistry } from '@haro/core/evolution';
import { buildHaroPaths } from '@haro/core/paths';

import { ToolInvocationAuditWriter } from '../audit.js';
import { createDefaultRegistry } from '../index.js';
import { McpServer } from '../server.js';
import { StdioTransport } from '../transport.js';
import type { SessionContext, ToolDependencies } from '../types.js';

interface BootArgs {
  session: SessionContext;
  root?: string;
  dbFile?: string;
}

async function main(): Promise<void> {
  const sessionArg = process.argv[2];
  const configArg = process.argv[3] ?? '{}';
  if (!sessionArg) {
    process.stderr.write('mcp-tools server-entry: missing session-context argument\n');
    process.exit(2);
  }
  let parsed: BootArgs;
  try {
    parsed = {
      session: JSON.parse(sessionArg) as SessionContext,
      ...(JSON.parse(configArg) as { root?: string; dbFile?: string }),
    };
  } catch (err) {
    process.stderr.write(
      `mcp-tools server-entry: failed to parse arguments: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
    return;
  }

  const paths = buildHaroPaths(parsed.root);
  const memoryDir = paths.dirs.memory;
  const dbFile = parsed.dbFile ?? paths.dbFile;
  const memory = createMemoryFabric({ root: memoryDir, dbFile });
  const evolution = createEvolutionAssetRegistry({
    ...(parsed.root ? { root: parsed.root } : {}),
    ...(dbFile ? { dbFile } : {}),
  });
  const channels = new ChannelRegistry();
  process.stderr.write(
    `[mcp-tools] server-entry: ChannelRegistry is empty in this subprocess (FEAT-032 scaffolding). ` +
      `'send_message' will return TARGET_NOT_FOUND until provider wiring lands.\n`,
  );

  const audit = new ToolInvocationAuditWriter({
    ...(parsed.root ? { root: parsed.root } : {}),
    ...(dbFile ? { dbFile } : {}),
  });
  const registry = createDefaultRegistry({ audit });
  const transport = new StdioTransport();
  const deps: ToolDependencies = {
    channels,
    memory,
    evolution,
    serviceContext: {
      ...(parsed.root ? { root: parsed.root } : {}),
      ...(dbFile ? { dbFile } : {}),
    },
  };
  const server = new McpServer({
    transport,
    registry,
    session: parsed.session,
    deps,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`mcp-tools server-entry: ${signal} received, shutting down\n`);
    await server.stop();
    audit.close();
    if ('close' in memory && typeof memory.close === 'function') memory.close();
    // Detach stdin so the run() loop exits on the next tick. Without this the
    // process would wait for SIGKILL because StdioTransport only flips a flag
    // when close() is called and node keeps the read loop alive.
    process.stdin.unref?.();
    process.stdin.pause?.();
    // Give the run loop a tick to flush any final response, then exit cleanly
    // so AgentRunner's stop() resolves before the 5 s SIGKILL fallback fires.
    setTimeout(() => process.exit(0), 10).unref?.();
  };
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await server.run();
}

void main().catch((err) => {
  process.stderr.write(
    `mcp-tools server-entry crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
