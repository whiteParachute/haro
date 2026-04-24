import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentRegistry, AgentRunner, ProviderRegistry, db as haroDb } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';
import type { ChannelRegistration, ManagedChannel } from '../src/channel.js';

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

  it('FEAT-013: haro run routes through ScenarioRouter before reaching Runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-router-run-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    const runnerCalls: Array<Parameters<AgentRunner['run']>[0]> = [];
    const ingressSessionIds: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['run', '列出当前目录下的 TypeScript 文件'],
      root,
      stdout,
      createSessionId: createIdFactory(['workflow-run-1', 'leaf-run-1']),
      createConversationId: createRecordingIdFactory(
        ['cli-bootstrap-run-1', 'channel-run-1'],
        ingressSessionIds,
      ),
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'text', content: 'Scanning workspace…' };
              yield {
                type: 'result',
                content: 'src/index.ts\nsrc/runtime/runner.ts',
                responseId: 'resp-run-1',
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createRunner: ({ agentRegistry, providerRegistry, logger, root: haroRoot, projectRoot, createSessionId }) => {
        const runner = new AgentRunner({
          agentRegistry,
          providerRegistry,
          logger,
          root: haroRoot,
          projectRoot,
          createSessionId,
        });
        const originalRun = runner.run.bind(runner);
        runner.run = async (input) => {
          runnerCalls.push(input);
          return originalRun(input);
        };
        return runner;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('src/index.ts');
    expect(runnerCalls).toHaveLength(1);

    const db = openDatabase(root);
    try {
      const workflowCheckpoint = db
        .prepare(
          'SELECT workflow_id, node_id, state FROM workflow_checkpoints ORDER BY created_at ASC, id ASC LIMIT 1',
        )
        .get() as
        | { workflow_id: string; node_id: string; state: string }
        | undefined;
      const session = db
        .prepare('SELECT id FROM sessions ORDER BY started_at ASC LIMIT 1')
        .get() as { id: string } | undefined;

      expect(workflowCheckpoint).toBeDefined();
      expect(session).toBeDefined();
      expect(ingressSessionIds).toEqual(['cli-bootstrap-run-1', 'channel-run-1']);
      expect(workflowCheckpoint?.workflow_id).toBe('workflow-run-1');
      expect(workflowCheckpoint?.workflow_id).not.toBe(ingressSessionIds[1]);
      expect(session?.id).toBe('leaf-run-1');

      const state = JSON.parse(workflowCheckpoint!.state) as {
        routingDecision: { executionMode: string };
        rawContextRefs: Array<{ kind: string; ref: string }>;
        leafSessionRefs: Array<{ nodeId: string; sessionId: string; providerResponseId?: string }>;
      };
      expect(state.routingDecision.executionMode).toBe('single-agent');
      expect(state.rawContextRefs).toEqual([{ kind: 'input', ref: 'channel://cli/sessions/channel-run-1' }]);
      expect(state.leafSessionRefs).toEqual([
        {
          nodeId: workflowCheckpoint!.node_id,
          sessionId: 'leaf-run-1',
          providerResponseId: 'resp-run-1',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('FEAT-013: team-mode requests warn and fall back to single-agent without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-router-team-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const outputChunks: string[] = [];
    const errorChunks: string[] = [];
    stdout.on('data', (chunk) => outputChunks.push(String(chunk)));
    stderr.on('data', (chunk) => errorChunks.push(String(chunk)));

    const result = await runCli({
      argv: ['run', '请分析这个复杂系统故障，跨文件定位根因并拆分信息维度'],
      root,
      stdout,
      stderr,
      createSessionId: createIdFactory(['workflow-team-1', 'leaf-team-1']),
      createConversationId: createIdFactory(['cli-bootstrap-team-1', 'channel-team-1']),
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield {
                type: 'result',
                content: 'team fallback executed',
                responseId: 'resp-team-1',
              };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(0);
    expect(outputChunks.join('')).toContain('team fallback executed');
    expect(errorChunks.join('')).toContain('WARN [FEAT-014]');
    expect(errorChunks.join('')).toContain('workflow-team-1');

    const db = openDatabase(root);
    try {
      const workflowCheckpoint = db
        .prepare(
          'SELECT workflow_id, state FROM workflow_checkpoints ORDER BY created_at ASC, id ASC LIMIT 1',
        )
        .get() as { workflow_id: string; state: string } | undefined;
      const session = db
        .prepare('SELECT id FROM sessions ORDER BY started_at ASC LIMIT 1')
        .get() as { id: string } | undefined;

      expect(workflowCheckpoint?.workflow_id).toBe('workflow-team-1');
      expect(session?.id).toBe('leaf-team-1');

      const state = JSON.parse(workflowCheckpoint!.state) as {
        routingDecision: { executionMode: string; orchestrationMode?: string };
        branchState: { fallbackExecutionMode?: string; teamOrchestratorPending?: boolean };
        leafSessionRefs: Array<{ sessionId: string; providerResponseId?: string }>;
      };
      expect(state.routingDecision.executionMode).toBe('team');
      expect(state.routingDecision.orchestrationMode).toBe('hub-spoke');
      expect(state.branchState).toEqual({
        fallbackExecutionMode: 'single-agent',
        teamOrchestratorPending: true,
      });
      expect(state.leafSessionRefs[0]).toEqual({
        nodeId: 'leaf-1',
        sessionId: 'leaf-team-1',
        providerResponseId: 'resp-team-1',
      });
    } finally {
      db.close();
    }
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'feishu',
          enabled: false,
        }),
      ],
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
      createAdditionalChannels: async () => [],
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
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(report).toHaveProperty('config');
    expect(report).toHaveProperty('providers');
    expect(report).toHaveProperty('channels');
    expect(report).toHaveProperty('dataDir');
    expect(report).toHaveProperty('sqlite');
  });

  it('doctor reports enabled external channel healthCheck() status and ignores disabled channels', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-doctor-channels-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));
    const feishuHealthCheck = vi.fn(async () => true);
    const telegramHealthCheck = vi.fn(async () => false);
    const disabledHealthCheck = vi.fn(async () => true);

    const result = await runCli({
      argv: ['doctor'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({ id: 'feishu', enabled: true, healthCheck: feishuHealthCheck }),
        createTestChannelRegistration({
          id: 'telegram',
          enabled: true,
          healthCheck: telegramHealthCheck,
        }),
        createTestChannelRegistration({ id: 'disabled-channel', enabled: false, healthCheck: disabledHealthCheck }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(feishuHealthCheck).toHaveBeenCalledTimes(1);
    expect(telegramHealthCheck).toHaveBeenCalledTimes(1);
    expect(disabledHealthCheck).not.toHaveBeenCalled();

    const report = JSON.parse(chunks.join('')) as {
      channels: Array<{ id: string; healthy: boolean; source: string }>;
    };
    expect(report.channels).toHaveLength(2);
    expect(report.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'feishu', healthy: true, source: 'package' }),
        expect.objectContaining({ id: 'telegram', healthy: false, source: 'package' }),
      ]),
    );
  });

  it('FEAT-015 R5: haro web --help exposes port and host options without starting the dashboard', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-web-help-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['web', '--help'],
      root,
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
      createAdditionalChannels: async () => [],
    });

    const output = chunks.join('');
    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('web');
    expect(output).toContain('Usage: haro web [options]');
    expect(output).toContain('--port <port>');
    expect(output).toContain('--host <host>');
    expect(output).not.toContain('Haro web dashboard listening');
  });

  it('FEAT-012 AC1/AC4: setup writes default model and prints next steps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-setup-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['setup'],
      root,
      stdout,
      setupDeps: {
        nodeVersion: 'v22.3.0',
        env: { OPENAI_API_KEY: 'test-key' },
        runCommand: () => ({ status: 0, stdout: '10.33.0\n' }),
      },
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            models: [{ id: 'codex-primary' }],
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('setup');
    const config = parseYaml(readFileSync(join(root, 'config.yaml'), 'utf8')) as {
      providers?: { codex?: { defaultModel?: string } };
    };
    expect(config.providers?.codex?.defaultModel).toBe('codex-primary');
    const output = chunks.join('');
    expect(output).toContain('Haro setup / onboard');
    expect(output).toContain('haro doctor');
    expect(output).toContain('haro run "列出当前目录下的 TypeScript 文件"');
    expect(output).toContain('haro channel setup feishu');
  });

  it('FEAT-012 AC2: onboard aliases setup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-onboard-'));
    roots.push(root);

    const result = await runCli({
      argv: ['onboard'],
      root,
      stdout: new PassThrough(),
      setupDeps: {
        nodeVersion: 'v22.3.0',
        env: { OPENAI_API_KEY: 'test-key' },
        runCommand: () => ({ status: 0, stdout: '10.33.0\n' }),
      },
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            models: [{ id: 'codex-primary' }],
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('setup');
    const config = parseYaml(readFileSync(join(root, 'config.yaml'), 'utf8')) as {
      providers?: { codex?: { defaultModel?: string } };
    };
    expect(config.providers?.codex?.defaultModel).toBe('codex-primary');
  });

  it('FEAT-012 AC3: setup reports missing OPENAI_API_KEY without persisting credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-setup-missing-key-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['setup'],
      root,
      stdout,
      setupDeps: {
        nodeVersion: 'v22.3.0',
        env: {},
        runCommand: () => ({ status: 0, stdout: '10.33.0\n' }),
      },
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(1);
    const output = chunks.join('');
    expect(output).toContain('未检测到 OPENAI_API_KEY');
    expect(output).toContain('export OPENAI_API_KEY=<your-key>');
    expect(output).toContain('haro doctor');
    const configText = readFileSync(join(root, 'config.yaml'), 'utf8');
    expect(configText).not.toContain('apiKey');
    expect(configText).not.toContain('test-key');
  });

  it('FEAT-008 AC1: channel list shows cli + feishu with enablement state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-channel-list-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['channel', 'list'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'feishu',
          enabled: false,
        }),
        createTestChannelRegistration({
          id: 'telegram',
          enabled: false,
        }),
      ],
    });

    expect(result.exitCode).toBe(0);
    const output = chunks.join('');
    expect(output).toContain('cli\tenabled\tbuiltin');
    expect(output).toContain('feishu\tdisabled\tpackage');
    expect(output).toContain('telegram\tdisabled\tpackage');
  });

  it('FEAT-008 AC2: channel setup feishu persists enabled config via wizard', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-channel-setup-'));
    roots.push(root);
    const stdout = new PassThrough();
    const stdin = new PassThrough();

    const runPromise = runCli({
      argv: ['channel', 'setup', 'feishu'],
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'feishu',
          enabled: false,
          setup: async () => ({
            ok: true,
            config: {
              enabled: true,
              appId: 'cli_test_app',
              appSecret: 'secret_value',
              transport: 'websocket',
              sessionScope: 'per-user',
            },
            message: 'Feishu configured',
          }),
        }),
      ],
    });

    const result = await runPromise;
    expect(result.exitCode).toBe(0);
    const config = parseYaml(readFileSync(join(root, 'config.yaml'), 'utf8')) as {
      channels: { feishu: { enabled: boolean; appId: string; appSecret: string; sessionScope: string } };
    };
    expect(config.channels.feishu).toMatchObject({
      enabled: true,
      appId: 'cli_test_app',
      appSecret: 'secret_value',
      sessionScope: 'per-user',
    });
  });

  it('FEAT-008 AC8: channel doctor feishu exits non-zero and prints reason on credential failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-channel-doctor-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['channel', 'doctor', 'feishu'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'feishu',
          enabled: true,
          doctor: async () => ({
            ok: false,
            code: '401',
            message: 'Unauthorized',
          }),
        }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(chunks.join('')).toContain('Unauthorized');
  });

  it('FEAT-008 AC7: cli runtime still works when no external channel package is registered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-no-feishu-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['run', 'hello'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'still works', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('still works');
  });

  it('FEAT-009 AC1: channel setup telegram persists enabled config via existing channel commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-telegram-setup-'));
    roots.push(root);
    const stdout = new PassThrough();

    const result = await runCli({
      argv: ['channel', 'setup', 'telegram'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'telegram',
          enabled: false,
          setup: async () => ({
            ok: true,
            config: {
              enabled: true,
              botToken: '${TELEGRAM_BOT_TOKEN}',
              transport: 'long-polling',
              allowedUpdates: ['message'],
              sessionScope: 'per-user',
            },
            message: 'Telegram configured',
          }),
        }),
      ],
    });

    expect(result.exitCode).toBe(0);
    const config = parseYaml(readFileSync(join(root, 'config.yaml'), 'utf8')) as {
      channels: { telegram: { enabled: boolean; botToken: string; transport: string; sessionScope: string } };
    };
    expect(config.channels.telegram).toMatchObject({
      enabled: true,
      botToken: '${TELEGRAM_BOT_TOKEN}',
      transport: 'long-polling',
      sessionScope: 'per-user',
    });
  });

  it('FEAT-009 AC5: channel doctor telegram exits non-zero and prints Unauthorized on bad token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-telegram-doctor-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['channel', 'doctor', 'telegram'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'telegram',
          enabled: true,
          doctor: async () => ({
            ok: false,
            code: '401',
            message: 'Unauthorized',
          }),
        }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(chunks.join('')).toContain('Unauthorized');
  });

  it('FEAT-009 AC7: cli still works when telegram package is absent but feishu remains registered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-telegram-plug-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['channel', 'list'],
      root,
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
      createAdditionalChannels: async () => [
        createTestChannelRegistration({
          id: 'feishu',
          enabled: true,
        }),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('feishu\tenabled\tpackage');
    expect(chunks.join('')).not.toContain('telegram');
  });

  it('FEAT-010 AC1/AC3: skills list shows preinstalled skills and uninstall protects memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-skills-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const listResult = await runCli({
      argv: ['skills', 'list'],
      root,
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

    expect(listResult.exitCode).toBe(0);
    expect(chunks.join('')).toContain('memory\tenabled\tpreinstalled');
    expect(chunks.join('')).toContain('eat\tenabled\tpreinstalled');

    const uninstall = await runCli({
      argv: ['skills', 'uninstall', 'memory'],
      root,
      stderr: new PassThrough(),
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
    expect(uninstall.exitCode).toBe(1);
  });

  it('FEAT-010 AC4: explicit /memory triggers the skill and writes usage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-memory-skill-'));
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
              yield { type: 'result', content: 'provider should not run', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    stdin.write('/memory 查一下 xxx\n');
    stdin.end();
    await runPromise;

    const usageDb = require('better-sqlite3')(join(root, 'skills', 'usage.sqlite'));
    try {
      const row = usageDb.prepare('SELECT use_count FROM skill_usage WHERE skill_id = ?').get('memory') as { use_count: number };
      expect(row.use_count).toBe(1);
    } finally {
      usageDb.close();
    }
    expect(chunks.join('')).not.toContain('provider should not run');
  });

  it('FEAT-010 AC8: description matching picks remember before eat', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-remember-auto-'));
    roots.push(root);
    const stdout = new PassThrough();
    const result = await runCli({
      argv: ['run', '记住这个偏好：以后默认中文回答'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'provider should not run', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(0);
    const usageDb = require('better-sqlite3')(join(root, 'skills', 'usage.sqlite'));
    try {
      const remember = usageDb.prepare('SELECT use_count FROM skill_usage WHERE skill_id = ?').get('remember') as { use_count: number };
      const eat = usageDb.prepare('SELECT use_count FROM skill_usage WHERE skill_id = ?').get('eat') as { use_count?: number } | undefined;
      expect(remember.use_count).toBe(1);
      expect(eat?.use_count ?? 0).toBe(0);
    } finally {
      usageDb.close();
    }
  });

  it('FEAT-011 AC12: haro eat bridges into the skills runtime and writes archives/memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-eat-'));
    roots.push(root);
    const stdout = new PassThrough();
    const sourceFile = join(root, 'eat-source.md');
    writeFileSync(
      sourceFile,
      ['Principle: Keep interfaces narrow', 'Rule: Always validate input.', 'Workflow: 1. Inspect 2. Apply'].join('\n'),
      'utf8',
    );

    const result = await runCli({
      argv: ['eat', sourceFile, '--yes', '--as', 'path'],
      root,
      stdout,
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: 'provider should not run', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, 'archive', 'eat-proposals'))).toBe(true);
    expect(existsSync(join(root, 'memory', 'agents', 'haro-assistant', 'index.md'))).toBe(true);
  });

  it('FEAT-011 AC7/AC9: haro shit dry-run and rollback bridge into the skills runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-shit-'));
    roots.push(root);
    const stdout = new PassThrough();
    const skillDir = join(root, 'user-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: custom-skill\ndescription: \"Custom\"\n---\n\nBody\n', 'utf8');

    const install = await runCli({
      argv: ['skills', 'install', skillDir],
      root,
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
    expect(install.exitCode).toBe(0);

    const dryRunOut = new PassThrough();
    const chunks: string[] = [];
    dryRunOut.on('data', (chunk) => chunks.push(String(chunk)));
    const dryRun = await runCli({
      argv: ['shit', '--scope', 'skills', '--days', '0', '--dry-run'],
      root,
      stdout: dryRunOut,
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
    expect(dryRun.exitCode).toBe(0);
    expect(chunks.join('')).toContain('custom-skill');

    const execOut = new PassThrough();
    const execChunks: string[] = [];
    execOut.on('data', (chunk) => execChunks.push(String(chunk)));
    const archived = await runCli({
      argv: ['shit', '--scope', 'skills', '--days', '0', '--confirm-high'],
      root,
      stdout: execOut,
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
    expect(archived.exitCode).toBe(0);
    const archiveRoot = join(root, 'archive');
    const archiveEntries = require('node:fs').readdirSync(archiveRoot).filter((name: string) => name.startsWith('shit-')).sort();
    expect(archiveEntries.length).toBeGreaterThan(0);

    const rollback = await runCli({
      argv: ['shit', 'rollback', archiveEntries[archiveEntries.length - 1]!],
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
    expect(rollback.exitCode).toBe(0);
    expect(existsSync(join(root, 'skills', 'user', 'custom-skill', 'SKILL.md'))).toBe(true);
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
      createAdditionalChannels: async () => [],
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
      createAdditionalChannels: async () => [],
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

  it('haro run wires the default memoryWrapupHook and writes an impression file on success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-memory-wrapup-'));
    roots.push(root);

    const result = await runCli({
      argv: ['run', '记录这次 CLI 执行'],
      root,
      stdout: new PassThrough(),
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            query: async function* () {
              yield { type: 'result', content: '本轮执行已完成', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    const impressionsDir = join(root, 'memory', 'agents', 'haro-assistant', 'impressions');
    const impressionFiles = readdirSync(impressionsDir).filter((file) => file.endsWith('.md'));
    expect(impressionFiles).toHaveLength(1);
    const impression = readFileSync(join(impressionsDir, impressionFiles[0]!), 'utf8');
    expect(impression).toContain('记录这次 CLI 执行');
    expect(impression).toContain('本轮执行已完成');
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

  it('M4: haro update reports latest version and upgrade command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-update-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['update'],
      root,
      stdout,
      fetchLatestNpmVersion: async () => '9.9.9',
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
    expect(result.action).toBe('update');
    const output = chunks.join('');
    expect(output).toContain('发现新版本');
    expect(output).toContain('0.1.0 → 9.9.9');
    expect(output).toContain('npm install -g @haro/cli@latest');
  });

  it('M4: haro update --check prints preview without install prompt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-update-check-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['update', '--check'],
      root,
      stdout,
      fetchLatestNpmVersion: async () => '9.9.9',
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
    const output = chunks.join('');
    expect(output).toContain('升级命令');
  });

  it('M4: haro update reports already on latest when versions match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-update-latest-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['update'],
      root,
      stdout,
      fetchLatestNpmVersion: async () => '0.1.0',
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
    const output = chunks.join('');
    expect(output).toContain('当前已是最新版本 0.1.0');
  });

  it('M4: haro update exits non-zero when registry is unreachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-update-fail-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['update'],
      root,
      stdout,
      fetchLatestNpmVersion: async () => {
        throw new Error('npm registry returned 404');
      },
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

    expect(result.exitCode).toBe(1);
    const output = chunks.join('');
    expect(output).toContain('无法检查更新');
  });

  it('M4-fix: haro update runs even when local config is broken', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-update-bad-config-'));
    roots.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'config.yaml'), 'providers:\n  codex:\n    defaultModel: 123\n');
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['update'],
      root,
      stdout,
      fetchLatestNpmVersion: async () => '9.9.9',
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('update');
    const output = chunks.join('');
    expect(output).toContain('发现新版本');
  });

  it('M4-fix: setup passes when npm is available but pnpm is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-cli-setup-npm-only-'));
    roots.push(root);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk) => chunks.push(String(chunk)));

    const result = await runCli({
      argv: ['setup'],
      root,
      stdout,
      setupDeps: {
        nodeVersion: 'v22.3.0',
        env: { OPENAI_API_KEY: 'test-key' },
        runCommand: (cmd: string, _args: readonly string[]) => {
          if (cmd === 'pnpm') {
            return { status: 1, stdout: '', stderr: 'command not found' };
          }
          if (cmd === 'npm') {
            return { status: 0, stdout: '10.9.0\n' };
          }
          return { status: 0, stdout: '' };
        },
      },
      createProviderRegistry: async () =>
        createProviderRegistry(
          new StubProvider({
            models: [{ id: 'codex-primary' }],
            query: async function* () {
              yield { type: 'result', content: 'ok', responseId: 'resp-1' };
            },
          }),
        ),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('setup');
    const output = chunks.join('');
    expect(output).toContain('npm 10.9.0');
    expect(output).not.toContain('未检测到可用的包管理器');
  });
});

function createTestChannelRegistration(input: {
  id: string;
  enabled: boolean;
  setup?: ManagedChannel['setup'];
  doctor?: ManagedChannel['doctor'];
  healthCheck?: ManagedChannel['healthCheck'];
}): ChannelRegistration {
  const channel: ManagedChannel = {
    id: input.id,
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    async send() {
      return undefined;
    },
    capabilities() {
      return {
        streaming: false,
        richText: false,
        attachments: true,
        threading: false,
        requiresWebhook: false,
      } as const;
    },
    healthCheck: input.healthCheck ?? (async () => true),
    ...(input.setup ? { setup: input.setup } : {}),
    ...(input.doctor ? { doctor: input.doctor } : {}),
  };
  return {
    channel,
    enabled: input.enabled,
    removable: true,
    source: 'package',
    displayName: input.id,
  };
}

function createIdFactory(ids: string[]): () => string {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    if (!value) {
      throw new Error('ran out of deterministic ids');
    }
    return value;
  };
}

function createRecordingIdFactory(ids: string[], bucket: string[]): () => string {
  const next = createIdFactory(ids);
  return () => {
    const value = next();
    bucket.push(value);
    return value;
  };
}

function openDatabase(root: string): {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  close(): void;
} {
  const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
    database: {
      prepare(sql: string): {
        get(...args: unknown[]): unknown;
        all(...args: unknown[]): unknown[];
      };
      close(): void;
    };
  };
  return opened.database;
}
