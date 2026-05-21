import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { LEGACY_SURFACE_WARNING, runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';

  capabilities() {
    return {
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<readonly { id: string }[]> {
    return [{ id: 'codex-primary' }];
  }

  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: `echo:${params.prompt}`, responseId: 'resp-1' };
  }
}

interface Capture {
  stream: NodeJS.WritableStream;
  read: () => string;
}

function captureStream(): Capture {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  return registry;
}

function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new StubProvider());
  return registry;
}

function runWithCapturedOutput(root: string, argv: readonly string[]) {
  const stdout = captureStream();
  const stderr = captureStream();
  return {
    stdout,
    stderr,
    result: runCli({
      argv,
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => new Date('2026-05-21T09:00:00.000Z'),
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    }),
  };
}

function expectJsonLines(output: string): void {
  const lines = output.trim().split('\n').filter(Boolean);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(() => JSON.parse(line)).not.toThrow();
  }
}

describe('legacy workbench surface warnings', () => {
  const roots: string[] = [];

  function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints a legacy warning for haro run without changing the original output path', async () => {
    const root = tempRoot('haro-legacy-run-');
    const { result, stdout } = runWithCapturedOutput(root, ['run', 'hello']);

    await expect(result).resolves.toMatchObject({ exitCode: 0, action: 'run' });
    expect(stdout.read()).toContain(LEGACY_SURFACE_WARNING);
    expect(stdout.read()).toContain('echo:hello');
  });

  it('prints a legacy warning for haro chat send', async () => {
    const root = tempRoot('haro-legacy-chat-');
    const { result, stdout } = runWithCapturedOutput(root, ['chat', '--send', 'hello']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.read()).toContain(LEGACY_SURFACE_WARNING);
  });

  it('prints a legacy warning for human memory output but keeps JSON output clean', async () => {
    const root = tempRoot('haro-legacy-memory-');
    const human = runWithCapturedOutput(root, ['memory', 'list', '--human']);

    await expect(human.result).resolves.toMatchObject({ exitCode: 0 });
    expect(human.stdout.read()).toContain(LEGACY_SURFACE_WARNING);

    const json = runWithCapturedOutput(root, ['memory', 'list', '--json']);
    await expect(json.result).resolves.toMatchObject({ exitCode: 0 });
    expect(json.stdout.read()).not.toContain(LEGACY_SURFACE_WARNING);
    expectJsonLines(json.stdout.read());
  });

  it('prints a legacy warning for human provider and channel surfaces', async () => {
    const root = tempRoot('haro-legacy-provider-');
    const provider = runWithCapturedOutput(root, ['provider', 'list', '--human']);

    await expect(provider.result).resolves.toMatchObject({ exitCode: 0 });
    expect(provider.stdout.read()).toContain(LEGACY_SURFACE_WARNING);

    const channel = runWithCapturedOutput(root, ['channel', 'list', '--human']);
    await expect(channel.result).resolves.toMatchObject({ exitCode: 0 });
    expect(channel.stdout.read()).toContain(LEGACY_SURFACE_WARNING);
  });

  it('does not pollute JSON provider output', async () => {
    const root = tempRoot('haro-legacy-provider-json-');
    const { result, stdout } = runWithCapturedOutput(root, ['provider', 'list', '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.read()).not.toContain(LEGACY_SURFACE_WARNING);
    expectJsonLines(stdout.read());
  });

  it('does not print the legacy warning for the AgentDock sidecar observe command', async () => {
    const root = tempRoot('haro-sidecar-observe-');
    const { result, stdout } = runWithCapturedOutput(root, [
      'observe',
      '--source',
      'fake',
      '--limit',
      '1',
      '--human',
    ]);

    await expect(result).resolves.toMatchObject({ exitCode: 0, action: 'observe' });
    expect(stdout.read()).not.toContain(LEGACY_SURFACE_WARNING);
    expect(stdout.read()).toContain('Observation batch:');
  });
});
