/** FEAT-032 R10 / AC6 — per-session MCP subprocess lifecycle. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSubprocessMcpFactory,
  createNoopMcpFactory,
} from '../src/runtime/mcp-session.js';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createSubprocessMcpFactory', () => {
  it('spawns and shuts down a real Node subprocess via SIGTERM in under 5s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-session-'));
    dirs.push(dir);
    const entry = join(dir, 'fake-server.js');
    writeFileSync(
      entry,
      `process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 5); });
       setInterval(() => {}, 1000);`,
    );
    const factory = createSubprocessMcpFactory({ serverEntry: entry, stderr: 'ignore' });
    const handle = await factory({
      session: { sessionId: 's-1', agentId: 'default' },
    });
    expect(handle.alive).toBe(true);
    const start = Date.now();
    await handle.stop({ timeoutMs: 5_000 });
    const elapsed = Date.now() - start;
    expect(handle.alive).toBe(false);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('SIGKILLs a hung subprocess after the configured timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-session-'));
    dirs.push(dir);
    const entry = join(dir, 'hang-server.js');
    writeFileSync(
      entry,
      `process.on('SIGTERM', () => { /* intentionally ignore */ });
       setInterval(() => {}, 1000);`,
    );
    const factory = createSubprocessMcpFactory({ serverEntry: entry, stderr: 'ignore' });
    const handle = await factory({
      session: { sessionId: 's-2', agentId: 'default' },
    });
    const start = Date.now();
    await handle.stop({ timeoutMs: 200 });
    const elapsed = Date.now() - start;
    expect(handle.alive).toBe(false);
    // Handle should resolve after the SIGKILL within a short window.
    expect(elapsed).toBeLessThan(2_500);
  });

  it('createNoopMcpFactory returns a handle that does nothing', async () => {
    const handle = await createNoopMcpFactory()({
      session: { sessionId: 's-3', agentId: 'a' },
    });
    expect(handle.alive).toBe(false);
    await handle.stop();
  });
});
