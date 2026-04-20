import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry, AgentRunner, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';

  constructor(
    private readonly script: {
      health?: boolean;
      models?: Array<{ id: string }>;
      query: (params: AgentQueryParams) => AsyncGenerator<AgentEvent, void, void>;
    },
  ) {}

  capabilities() {
    return {
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    return this.script.health ?? true;
  }

  async listModels(): Promise<readonly { id: string }[]> {
    return this.script.models ?? [{ id: 'codex-primary' }];
  }

  query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    return this.script.query(params);
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({
    id: 'haro-assistant',
    name: 'Haro Assistant',
    systemPrompt: 'helpful',
  });
  registry.register({
    id: 'reviewer',
    name: 'Reviewer',
    systemPrompt: 'review',
  });
  return registry;
}

function createProviderRegistry(provider: AgentProvider): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(provider);
  return registry;
}

describe('runCli [FEAT-006]', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC1: haro run prints the result and exits 0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-run-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['run', '列出当前目录下的 TypeScript 文件'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'text', content: 'Scanning workspace…' };
              yield {
                type: 'result',
                content: 'src/index.ts\nsrc/runtime/runner.ts',
                responseId: 'resp-1',
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('run');
    expect(chunks.join('')).toContain('src/index.ts');
  });

  it('AC2/AC6: repl /help lists slash commands and /compress reports unsupported for codex', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-help-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const runPromise = runCli({
      argv: [],
      root,
      stdin,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    stdin.write('/help\n');
    stdin.write('/compress\n');
    stdin.end();

    const result = await runPromise;
    const output = chunks.join('');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('/model [provider] [model]');
    expect(output).toContain('/retry');
    expect(output).toContain('当前 Provider 不支持上下文压缩');
  });

  it('AC3: repl natural-language input routes through the runner and prints the result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-repl-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const runPromise = runCli({
      argv: [],
      root,
      stdin,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* (params) {
              yield {
                type: 'result',
                content: `echo:${params.prompt}`,
                responseId: 'resp-1',
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    stdin.write('你好，帮我总结一下\n');
    stdin.end();

    const result = await runPromise;
    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('echo:你好，帮我总结一下');
  });

  it('AC4: doctor reports config/providers/dataDir/sqlite and exits non-zero when checks fail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-doctor-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['doctor'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            health: false,
            query: async function* () {
              yield { type: 'error', code: 'unavailable', message: 'down', retryable: true };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(report).toHaveProperty('config');
    expect(report).toHaveProperty('providers');
    expect(report).toHaveProperty('dataDir');
    expect(report).toHaveProperty('sqlite');
  });

  it('/new clears the current continuation so the next task starts a fresh session context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-new-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const previousResponseIds: Array<string | undefined> = [];

    const runPromise = runCli({
      argv: [],
      root,
      stdin,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* (params) {
              previousResponseIds.push(params.sessionContext?.previousResponseId);
              yield {
                type: 'result',
                content: params.prompt,
                responseId: `resp-${previousResponseIds.length}`,
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    stdin.write('第一轮\n');
    stdin.write('/new\n');
    stdin.write('第二轮\n');
    stdin.end();
    const result = await runPromise;

    expect(result.exitCode).toBe(0);
    expect(previousResponseIds).toEqual([undefined, undefined]);
  });

  it('AC7: /retry creates a new session with a synthetic session_retry event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-retry-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stdin = new PassThrough();

    let call = 0;
    const runPromise = runCli({
      argv: [],
      root,
      stdin,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* (params) {
              call += 1;
              yield {
                type: 'result',
                content: `attempt-${call}:${params.prompt}`,
                responseId: `resp-${call}`,
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    stdin.write('第一次任务\n');
    stdin.write('/retry\n');
    stdin.end();
    await runPromise;

    const opened = require('@haro/core').db.initHaroDatabase({ root, keepOpen: true }) as {
      database: { prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown } };
    };
    const db = opened.database;
    try {
      const sessions = db.prepare('SELECT id FROM sessions ORDER BY started_at ASC').all() as Array<{ id: string }>;
      expect(sessions).toHaveLength(2);
      const retryEvent = db
        .prepare('SELECT event_type, event_data FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT 1')
        .get(sessions[1]!.id) as { event_type: string; event_data: string };
      expect(retryEvent.event_type).toBe('session_retry');
      expect(JSON.parse(retryEvent.event_data)).toEqual({ priorSessionId: sessions[0]!.id });
    } finally {
      (db as { close?: () => void }).close?.();
    }
  });

  it('AC8: haro run --no-memory skips memory wrapup for this session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-no-memory-'));
    roots.push(root);
    const stdout = new PassThrough();
    const wrapup = vi.fn(async () => undefined);

    const result = await runCli({
      argv: ['run', '--no-memory', '不要写记忆'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'done', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createRunner: ({ agentRegistry, providerRegistry, logger, root: haroRoot, projectRoot, createSessionId }) =>
        new AgentRunner({
          agentRegistry,
          providerRegistry,
          logger,
          root: haroRoot,
          projectRoot,
          createSessionId,
          memoryWrapupHook: wrapup,
        }),
    });

    expect(result.exitCode).toBe(0);
    expect(wrapup).not.toHaveBeenCalled();
  });

  it('config validation errors still exit non-zero and surface the offending path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-config-error-'));
    roots.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'config.yaml'), 'providers:\n  codex:\n    defaultModel: 123\n');
    const stderr = new PassThrough();
    const chunks: string[] = [];
    stderr.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({ argv: ['run', 'hello'], root, stderr });
    expect(result.exitCode).toBe(1);
    expect(result.action).toBe('config-error');
    expect(chunks.join('')).toContain('providers.codex.defaultModel');
  });

  it('haro model persists a CLI-local default provider/model state file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-model-'));
    roots.push(root);

    const result = await runCli({
      argv: ['model', 'codex', 'codex-primary'],
      root,
      stdout: new PassThrough(),
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(0);
    const state = JSON.parse(
      readFileSync(join(root, 'channels', 'cli', 'state.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(state).toMatchObject({
      defaultProvider: 'codex',
      defaultModel: 'codex-primary',
    });
  });
});
