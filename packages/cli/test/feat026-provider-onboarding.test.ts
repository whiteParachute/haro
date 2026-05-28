import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli, type RunCliOptions } from '../src/index.js';
import type { ProviderCatalogEntry } from '../src/provider-catalog.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(async () => 'chatgpt'),
  isCancel: vi.fn(() => false),
}));

class StubProvider implements AgentProvider {
  readonly id: string;
  readonly calls: { listModels: number; healthCheck: number; queries: AgentQueryParams[] } = {
    listModels: 0,
    healthCheck: 0,
    queries: [],
  };

  constructor(
    input: {
      id?: string;
      healthy?: boolean;
      models?: Array<{ id: string; maxContextTokens?: number }>;
      listModelsError?: Error;
    } = {},
  ) {
    this.id = input.id ?? 'codex';
    this.healthy = input.healthy ?? true;
    this.models = input.models ?? [{ id: 'codex-primary' }, { id: 'codex-secondary' }];
    this.listModelsError = input.listModelsError;
  }

  private readonly healthy: boolean;
  private readonly models: Array<{ id: string; maxContextTokens?: number }>;
  private readonly listModelsError: Error | undefined;

  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }

  async healthCheck(): Promise<boolean> {
    this.calls.healthCheck += 1;
    return this.healthy;
  }

  async listModels(): Promise<readonly { id: string; maxContextTokens?: number }[]> {
    this.calls.listModels += 1;
    if (this.listModelsError) throw this.listModelsError;
    return this.models;
  }

  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    this.calls.queries.push(params);
    yield { type: 'result', content: `model=${params.model ?? '<none>'}`, responseId: 'resp-1' };
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  return registry;
}

function createProviderRegistry(provider: AgentProvider): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(provider);
  return registry;
}

function okCommand(command: string) {
  if (command === 'pnpm') return { status: 0, stdout: '10.33.0\n' };
  if (command === 'npm') return { status: 0, stdout: '10.9.0\n' };
  if (command === 'haro') return { status: 0, stdout: '0.1.0\n' };
  if (command === 'ss') return { status: 0, stdout: '' };
  if (command === 'systemctl') return { status: 0, stdout: 'active\n' };
  return { status: 0, stdout: '' };
}

async function runWithOutput(input: RunCliOptions & { root: string }) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: string[] = [];
  const err: string[] = [];
  stdout.on('data', (chunk) => out.push(String(chunk)));
  stderr.on('data', (chunk) => err.push(String(chunk)));
  const result = await runCli({
    stdout,
    stderr,
    loadAgentRegistry: async () => createAgentRegistry(),
    createAdditionalChannels: async () => [],
    ...input,
  });
  return { result, output: out.join(''), stderr: err.join('') };
}

describe('provider onboarding wizard [FEAT-026]', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  function expectProviderRetired(text: string): void {
    expect(text).toContain('retired');
    expect(text).toContain('FEAT-081X');
    expect(text).toContain('AgentDock/ModelHub');
    expect(text).toContain('self-evolution sidecar proposal/review workflows');
  }

  function expectProviderSetupUnavailable(text: string): void {
    expect(text).toMatch(/retired|Retired|unknown command|unknown option|too many arguments/);
    expect(text).not.toContain('PROVIDER_SETUP_RETIRED');
  }

  it('FEAT-081X: provider list is retired and no longer exposes standalone catalog management', async () => {
    const root = tempRoot('haro-feat026-list-');
    const extra: ProviderCatalogEntry = {
      id: 'mockai',
      displayName: 'Mock AI',
      description: 'test-only provider catalog entry',
      auth: { type: 'env', envVars: ['MOCK_API_KEY'], secretRefKey: 'secretRef', defaultSecretRef: 'env:MOCK_API_KEY' },
      configurableFields: [{ key: 'tenant', label: 'Tenant', type: 'string', description: 'tenant id' }],
      modelDiscovery: 'unsupported',
    };
    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'list', '--human'],
      root,
      providerCatalog: [extra],
      createProviderRegistry: async () => createProviderRegistry(new StubProvider({ id: 'mockai' })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.action).toBe('provider');
    expect(output).toBe('');
    expectProviderRetired(stderr);
    expect(stderr).not.toContain('mockai');
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
  });

  it('FEAT-081R: provider setup is physically removed, unknown command fails closed and never writes config', async () => {
    const root = tempRoot('haro-feat081r-setup-removed-');
    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--non-interactive'],
      root,
      setupDeps: { env: {}, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    const text = `${output}
${stderr}`;
    expect(result.action).toBe('provider');
    expect(result.exitCode).toBe(1);
    expectProviderSetupUnavailable(text);
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    expect(text).not.toContain('PROVIDER_SECRET_MISSING');
    expect(text).not.toContain('apiKey');
  });

  it('FEAT-081R: provider setup --json remains removed and fails closed without writes', async () => {
    const root = tempRoot('haro-feat081r-setup-json-removed-');
    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--json'],
      root,
      setupDeps: { env: { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    const text = `${output}
${stderr}`;
    expect(result.action).toBe('provider');
    expect(result.exitCode).toBe(1);
    expectProviderSetupUnavailable(text);
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    expect(text).not.toContain('test-provider-secret-123');
    expect(text).not.toContain('PROVIDER_SETUP_RETIRED');
  });

  it('FEAT-081X: provider root/models/doctor/select/env are retired without calling provider management logic', async () => {
    const root = tempRoot('haro-feat026-select-');
    const provider = new StubProvider({ models: [{ id: 'codex-primary' }, { id: 'codex-secondary', maxContextTokens: 200_000 }] });
    const env = { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root };
    const commands: Array<readonly string[]> = [
      ['provider'],
      ['provider', 'models', 'codex'],
      ['provider', 'models', 'codex', '--json'],
      ['provider', 'doctor', 'codex'],
      ['provider', 'doctor', 'codex', '--json'],
      ['provider', 'select', 'codex', 'codex-secondary', '--scope', 'project'],
      ['provider', 'env', 'codex'],
      ['provider', 'env', 'codex', '--json'],
    ];

    for (const argv of commands) {
      const retired = await runWithOutput({
        argv,
        root,
        setupDeps: { env, runCommand: okCommand },
        createProviderRegistry: async () => createProviderRegistry(provider),
      });
      expect(retired.result.exitCode, argv.join(' ')).toBe(1);
      expect(retired.output, argv.join(' ')).toBe('');
      expectProviderRetired(retired.stderr);
      expect(retired.stderr).not.toContain(env.OPENAI_API_KEY);
      expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    }

    expect(provider.calls.listModels).toBe(0);
    expect(provider.calls.healthCheck).toBe(0);
  });

  it('R6: AgentRunner selection uses providers.codex.defaultModel from config when no CLI override exists', async () => {
    const root = tempRoot('haro-feat026-run-default-model-');
    writeFileSync(join(root, 'config.yaml'), 'providers:\n  codex:\n    defaultModel: codex-secondary\n');
    const provider = new StubProvider({ models: [{ id: 'codex-primary' }, { id: 'codex-secondary' }] });
    const { result, output } = await runWithOutput({
      argv: ['run', '实现一个 TypeScript helper'],
      root,
      setupDeps: { env: { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(provider),
    });

    expect(result.exitCode).toBe(0);
    expect(output).toContain('model=codex-secondary');
  });

  it('FEAT-081R: project-scoped provider setup is unknown command and does not mutate project config', async () => {
    const root = tempRoot('haro-feat081r-project-root-');
    const projectRoot = tempRoot('haro-feat081r-project-');
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });
    const configPath = join(projectRoot, '.haro', 'config.yaml');
    writeFileSync(configPath, 'providers:\n  codex:\n    defaultModel: codex-keep\n');
    const before = readFileSync(configPath, 'utf8');
    const env = { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root };

    const result = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--scope', 'project', '--base-url', 'https://api.example.test/v1', '--non-interactive'],
      root,
      projectRoot,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider({ models: [{ id: 'codex-keep' }] })),
    });

    expect(result.result.exitCode).toBe(1);
    expectProviderSetupUnavailable(`${result.output}
${result.stderr}`);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    expect(readFileSync(configPath, 'utf8')).not.toContain('https://api.example.test/v1');
    expect(readFileSync(configPath, 'utf8')).not.toContain('test-provider-secret-123');
    expect(readFileSync(configPath, 'utf8')).not.toContain('apiKey');
  });

  it('FEAT-081R: unknown setup ignores --write-env-file and does not write secrets', async () => {
    const root = tempRoot('haro-feat081r-envfile-root-');
    const envFile = join(root, 'providers.env');
    const secret = 'test-provider-secret-123';
    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--non-interactive', '--write-env-file', '--env-file', envFile],
      root,
      setupDeps: { env: { OPENAI_API_KEY: secret, HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(1);
    expectProviderSetupUnavailable(`${output}
${stderr}`);
    expect(existsSync(envFile)).toBe(false);
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    expect(`${output}
${stderr}`).not.toContain(secret);
  });

  it('FEAT-081X: provider doctor is retired and does not inspect provider env files', async () => {
    const root = tempRoot('haro-feat026-systemd-root-');
    const configHome = join(root, 'xdg');
    const envDir = join(configHome, 'haro');
    mkdirSync(envDir, { recursive: true });
    const envFile = join(envDir, 'providers.env');
    const secret = 'systemd-provider-secret-123';
    writeFileSync(envFile, `OPENAI_API_KEY=${JSON.stringify(secret)}\n`, { mode: 0o600 });
    chmodSync(envFile, 0o600);

    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'doctor', 'codex', '--json'],
      root,
      setupDeps: { env: { HOME: root, XDG_CONFIG_HOME: configHome }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(1);
    expect(output.trim()).toBe('');
    expectProviderRetired(stderr);
    expect(stderr).not.toContain('systemd-provider-secret-123');
    expect(stderr).not.toContain(envFile);
    expect(output).not.toContain(secret);
  });

  it('FEAT-081X: provider env is retired and does not reveal current process secrets', async () => {
    const root = tempRoot('haro-feat026-env-');
    const secret = 'visible-nowhere-secret-123';
    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'env', 'codex', '--human'],
      root,
      setupDeps: { env: { OPENAI_API_KEY: secret, HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(1);
    expect(output).toBe('');
    expectProviderRetired(stderr);
    expect(output).not.toContain(secret);
    expect(stderr).not.toContain(secret);
  });

  it('FEAT-081R: unknown interactive setup fails and does not run the ChatGPT wizard or codex login', async () => {
    const root = tempRoot('haro-feat081r-tty-root-');
    const codexHome = join(root, 'codex-home');
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    const fakeCodex = join(binDir, 'codex');
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
` +
        `const fs = require('node:fs');
` +
        `const path = require('node:path');
` +
        `if (process.argv[2] !== 'login') process.exit(2);
` +
        `fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
` +
        `fs.writeFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({ tokens: { access_token: 'access-token-raw', refresh_token: 'refresh-token-raw' } }));
`,
      { mode: 0o755 },
    );
    chmodSync(fakeCodex, 0o755);
    const env = { HOME: root, CODEX_HOME: codexHome, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` };
    vi.stubEnv('CODEX_HOME', codexHome);
    vi.stubEnv('PATH', env.PATH);
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = true;

    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'setup', 'codex'],
      root,
      stdin,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    const text = `${output}
${stderr}`;
    expect(result.exitCode).toBe(1);
    expectProviderSetupUnavailable(text);
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(false);
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    expect(text).not.toContain('access-token-raw');
    expect(text).not.toContain('refresh-token-raw');
  });

  it('FEAT-081R: unknown --auth-mode chatgpt setup does not read or persist codex auth', async () => {
    const root = tempRoot('haro-feat081r-noninteractive-root-');
    const codexHome = join(root, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'access-token-raw',
          refresh_token: 'refresh-token-raw',
        },
      }),
    );
    const env = { HOME: root, CODEX_HOME: codexHome };
    vi.stubEnv('CODEX_HOME', codexHome);

    const { result, output, stderr } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--auth-mode', 'chatgpt', '--non-interactive'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    const text = `${output}
${stderr}`;
    expect(result.exitCode).toBe(1);
    expectProviderSetupUnavailable(text);
    expect(existsSync(join(root, 'config.yaml'))).toBe(false);
    expect(text).not.toContain('access-token-raw');
    expect(text).not.toContain('refresh-token-raw');
  });
});
