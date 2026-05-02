import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
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

  it('AC6/R7: provider list is catalog-driven and exposes configurable fields', async () => {
    const root = tempRoot('haro-feat026-list-');
    const extra: ProviderCatalogEntry = {
      id: 'mockai',
      displayName: 'Mock AI',
      description: 'test-only provider catalog entry',
      auth: { type: 'env', envVars: ['MOCK_API_KEY'], secretRefKey: 'secretRef', defaultSecretRef: 'env:MOCK_API_KEY' },
      configurableFields: [{ key: 'tenant', label: 'Tenant', type: 'string', description: 'tenant id' }],
      modelDiscovery: 'unsupported',
    };
    const { result, output } = await runWithOutput({
      argv: ['provider', 'list', '--human'],
      root,
      providerCatalog: [extra],
      createProviderRegistry: async () => createProviderRegistry(new StubProvider({ id: 'mockai' })),
    });

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('provider');
    expect(output).toContain('mockai');
    expect(output).toContain('fields=tenant');
  });

  it('AC1: setup without OPENAI_API_KEY explains the safe secret path and never writes apiKey to YAML/output', async () => {
    const root = tempRoot('haro-feat026-missing-secret-');
    const { result, output } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--non-interactive'],
      root,
      setupDeps: { env: {}, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(1);
    expect(output).toContain('PROVIDER_SECRET_MISSING');
    expect(output).toContain('haro provider setup codex');
    const configText = readFileSync(join(root, 'config.yaml'), 'utf8');
    expect(configText).toContain('secretRef: env:OPENAI_API_KEY');
    expect(configText).not.toContain('apiKey');
    expect(output).not.toContain('sk-test');
  });

  it('AC2/R5/R6: models use live listModels, select persists defaults, doctor is healthy, and haro model shows the same model', async () => {
    const root = tempRoot('haro-feat026-select-');
    const provider = new StubProvider({ models: [{ id: 'codex-primary' }, { id: 'codex-secondary', maxContextTokens: 200_000 }] });
    const env = { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root };

    const models = await runWithOutput({
      argv: ['provider', 'models', 'codex'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(provider),
    });
    expect(models.result.exitCode).toBe(0);
    expect(models.output).toContain('codex-secondary');
    expect(provider.calls.listModels).toBeGreaterThan(0);

    const select = await runWithOutput({
      argv: ['provider', 'select', 'codex', 'codex-secondary'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(provider),
    });
    expect(select.result.exitCode).toBe(0);

    const doctor = await runWithOutput({
      argv: ['provider', 'doctor', 'codex', '--json'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(provider),
    });
    // FEAT-039 R11/AC12: --json now wraps in a CliRecordEnvelope.
    const doctorEnvelope = JSON.parse(doctor.output) as {
      ok: true;
      data: { ok: boolean; secret: { currentProcess: string }; issues: unknown[] };
    };
    expect(doctor.result.exitCode).toBe(0);
    expect(doctorEnvelope.data.ok).toBe(true);
    expect(doctorEnvelope.data.secret.currentProcess).toBe('present');

    const model = await runWithOutput({
      argv: ['model', '--human'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(provider),
    });
    expect(model.output).toContain('codex/codex-secondary');

    const config = parseYaml(readFileSync(join(root, 'config.yaml'), 'utf8')) as {
      providers?: { codex?: { defaultModel?: string; secretRef?: string; enabled?: boolean } };
    };
    expect(config.providers?.codex).toMatchObject({ enabled: true, secretRef: 'env:OPENAI_API_KEY', defaultModel: 'codex-secondary' });
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

  it('AC3/AC4: non-interactive project setup writes only non-sensitive config and is idempotent', async () => {
    const root = tempRoot('haro-feat026-project-root-');
    const projectRoot = tempRoot('haro-feat026-project-');
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });
    writeFileSync(join(projectRoot, '.haro', 'config.yaml'), 'providers:\n  codex:\n    defaultModel: codex-keep\n');
    const env = { OPENAI_API_KEY: 'test-provider-secret-123', HOME: root };
    const common = {
      argv: ['provider', 'setup', 'codex', '--scope', 'project', '--base-url', 'https://api.example.test/v1', '--non-interactive'],
      root,
      projectRoot,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider({ models: [{ id: 'codex-keep' }] })),
    } satisfies RunCliOptions & { root: string };

    const first = await runWithOutput(common);
    const afterFirst = readFileSync(join(projectRoot, '.haro', 'config.yaml'), 'utf8');
    const second = await runWithOutput(common);
    const afterSecond = readFileSync(join(projectRoot, '.haro', 'config.yaml'), 'utf8');

    expect(first.result.exitCode).toBe(0);
    expect(second.result.exitCode).toBe(0);
    expect(afterSecond).toBe(afterFirst);
    const config = parseYaml(afterSecond) as { providers?: { codex?: Record<string, unknown> } };
    expect(config.providers?.codex).toMatchObject({
      defaultModel: 'codex-keep',
      baseUrl: 'https://api.example.test/v1',
      enabled: true,
      secretRef: 'env:OPENAI_API_KEY',
    });
    expect(afterSecond).not.toContain('test-provider-secret-123');
    expect(afterSecond).not.toContain('apiKey');
  });

  it('D1: --write-env-file is explicit, atomic-safe, chmods 0600, and redacts terminal output', async () => {
    const root = tempRoot('haro-feat026-envfile-root-');
    const envFile = join(root, 'providers.env');
    const secret = 'test-provider-secret-123';
    const { result, output } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--non-interactive', '--write-env-file', '--env-file', envFile],
      root,
      setupDeps: { env: { OPENAI_API_KEY: secret, HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(envFile)).toBe(true);
    expect((statSync(envFile).mode & 0o777).toString(8).padStart(4, '0')).toBe('0600');
    expect(readFileSync(envFile, 'utf8')).toContain('OPENAI_API_KEY=');
    expect(output).toContain('values masked');
    expect(output).not.toContain(secret);
  });

  it('AC5: doctor distinguishes current shell missing secret from a readable provider env file for systemd/service loading', async () => {
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

    // Codex adversarial review (2026-05-02): a failing doctor must NOT emit an
    // ok:true record envelope; that lets piped consumers misread the failure.
    // The renderer now writes a CliErrorEnvelope to stderr instead, and stdout
    // for --json carries nothing.
    expect(result.exitCode).toBe(1);
    expect(output.trim()).toBe('');
    const envelope = JSON.parse(stderr.trim().split('\n').filter(Boolean).at(-1)!) as {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: { report?: {
          ok: boolean;
          secret: { source: string; envFile: { path: string; containsSecret: boolean; readable: boolean } };
          issues: Array<{ code: string; evidence: string }>;
        } };
      };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('PROVIDER_DOCTOR_FAILED');
    const json = envelope.error.details!.report!;
    expect(json.ok).toBe(false);
    expect(json.secret.source).toBe('systemd-env-file');
    expect(json.secret.envFile).toMatchObject({ path: envFile, containsSecret: true, readable: true });
    expect(json.issues[0]).toMatchObject({ code: 'PROVIDER_SECRET_MISSING' });
    expect(json.issues[0].evidence).toContain('current process');
    expect(json.issues[0].evidence).toContain(envFile);
    expect(output).not.toContain(secret);
  });

  it('provider env masks current process secrets while showing template and sources', async () => {
    const root = tempRoot('haro-feat026-env-');
    const secret = 'visible-nowhere-secret-123';
    const { result, output } = await runWithOutput({
      argv: ['provider', 'env', 'codex', '--human'],
      root,
      setupDeps: { env: { OPENAI_API_KEY: secret, HOME: root }, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(0);
    expect(output).toContain('OPENAI_API_KEY=<your-provider-secret>');
    expect(output).toContain('present (masked)');
    expect(output).not.toContain(secret);
  });

  it('FEAT-029: TTY wizard completes ChatGPT path, writes only authMode, and never echoes tokens', async () => {
    const root = tempRoot('haro-feat029-tty-root-');
    const codexHome = join(root, 'codex-home');
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    const fakeCodex = join(binDir, 'codex');
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node\n` +
        `const fs = require('node:fs');\n` +
        `const path = require('node:path');\n` +
        `if (process.argv[2] !== 'login') process.exit(2);\n` +
        `fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });\n` +
        `fs.writeFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', last_refresh: '2026-04-27T11:30:00Z', tokens: { access_token: 'access-token-raw', refresh_token: 'refresh-token-raw', account_id: 'user_2NfXabcdefghXaxL' } }));\n`,
      { mode: 0o755 },
    );
    chmodSync(fakeCodex, 0o755);
    const env = { HOME: root, CODEX_HOME: codexHome, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` };
    vi.stubEnv('CODEX_HOME', codexHome);
    vi.stubEnv('PATH', env.PATH);
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = true;

    const { result, output } = await runWithOutput({
      argv: ['provider', 'setup', 'codex'],
      root,
      stdin,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(0);
    expect(output).toContain('Auth mode: chatgpt');
    expect(output).toContain('ChatGPT login detected');
    expect(output).toContain('user_2…XaxL');
    expect(output).not.toContain('access-token-raw');
    expect(output).not.toContain('refresh-token-raw');
    const configText = readFileSync(join(root, 'config.yaml'), 'utf8');
    const config = parseYaml(configText) as { providers?: { codex?: Record<string, unknown> } };
    expect(config.providers?.codex).toMatchObject({ enabled: true, secretRef: 'env:OPENAI_API_KEY', authMode: 'chatgpt' });
    expect(config.providers?.codex).not.toHaveProperty('tokens');
    expect(configText).not.toContain('access-token-raw');
    expect(configText).not.toContain('refresh-token-raw');

    const envReport = await runWithOutput({
      argv: ['provider', 'env', 'codex', '--human'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });
    expect(envReport.result.exitCode).toBe(0);
    expect(envReport.output).toContain('ChatGPT subscription auth via ~/.codex/auth.json');
    expect(envReport.output).not.toContain('OPENAI_API_KEY=<your-provider-secret>');
    expect(envReport.output).not.toContain('access-token-raw');

    const doctor = await runWithOutput({
      argv: ['provider', 'doctor', 'codex', '--human'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });
    expect(doctor.result.exitCode).toBe(0);
    expect(doctor.output).toContain('ChatGPT auth.json');
    expect(doctor.output).toContain('Codex binary:');
    expect(doctor.output).not.toContain('refresh-token-raw');
  });

  it('FEAT-029: non-interactive --auth-mode chatgpt validates existing codex auth without spawning', async () => {
    const root = tempRoot('haro-feat029-noninteractive-root-');
    const codexHome = join(root, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-04-27T11:30:00Z',
        tokens: {
          access_token: 'access-token-raw',
          refresh_token: 'refresh-token-raw',
          account_id: 'user_2NfXabcdefghXaxL',
        },
      }),
    );
    const env = { HOME: root, CODEX_HOME: codexHome };
    vi.stubEnv('CODEX_HOME', codexHome);

    const { result, output } = await runWithOutput({
      argv: ['provider', 'setup', 'codex', '--auth-mode', 'chatgpt', '--non-interactive'],
      root,
      setupDeps: { env, runCommand: okCommand },
      createProviderRegistry: async () => createProviderRegistry(new StubProvider()),
    });

    expect(result.exitCode).toBe(0);
    expect(output).toContain('Auth mode: chatgpt');
    const configText = readFileSync(join(root, 'config.yaml'), 'utf8');
    expect(configText).toContain('authMode: chatgpt');
    expect(configText).not.toContain('access-token-raw');
    expect(output).not.toContain('refresh-token-raw');
  });
});
