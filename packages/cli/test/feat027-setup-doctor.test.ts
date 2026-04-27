import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli, type RunCliOptions } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';
  constructor(private readonly health = true) {}
  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }
  async healthCheck(): Promise<boolean> {
    return this.health;
  }
  async listModels(): Promise<readonly { id: string }[]> {
    return [{ id: 'codex-primary' }];
  }
  async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: 'ok', responseId: 'resp-1' };
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  return registry;
}

function createProviderRegistry(provider = new StubProvider()): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(provider);
  return registry;
}

function okCommand(command: string, args: readonly string[] = []) {
  if (command === 'pnpm') return { status: 0, stdout: '10.33.0\n' };
  if (command === 'npm') return { status: 0, stdout: '10.9.0\n' };
  if (command === 'haro') return { status: 0, stdout: '0.1.0\n' };
  if (command === 'ss') return { status: 0, stdout: '' };
  if (command === 'systemctl' && args.includes('is-active')) return { status: 0, stdout: 'active\n' };
  if (command === 'systemctl' && args.includes('is-enabled')) return { status: 0, stdout: 'enabled\n' };
  if (command === 'systemctl') return { status: 0, stdout: '' };
  return { status: 0, stdout: '' };
}

// FEAT-029 — diagnostics tests must be hermetic about codex CLI auth state;
// inject a "no chatgpt login" probe so tests pass on dev machines where the
// developer has run `codex login`.
const noChatgptAuth = () => ({
  detected: false,
  hasAuth: false,
  authMode: null,
  accountId: null,
  lastRefresh: null,
  authFilePath: '/tmp/no-codex-home/auth.json',
});

async function runJson(root: string, argv: string[], opts: Partial<RunCliOptions> = {}) {
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on('data', (chunk) => chunks.push(String(chunk)));
  const result = await runCli({
    argv,
    root,
    stdout,
    setupDeps: {
      nodeVersion: 'v22.3.0',
      env: { OPENAI_API_KEY: 'test-key' },
      runCommand: okCommand,
      readCodexAuth: noChatgptAuth,
    },
    createProviderRegistry: async () => createProviderRegistry(),
    loadAgentRegistry: async () => createAgentRegistry(),
    createAdditionalChannels: async () => [],
    ...opts,
  });
  return { result, json: JSON.parse(chunks.join('')) as Record<string, any>, output: chunks.join('') };
}

describe('guided setup and doctor remediation [FEAT-027]', () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function tempRoot(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it('setup --check --json returns staged results with issue contract and next actions', async () => {
    const root = tempRoot('haro-feat027-setup-check-');
    const { result, json } = await runJson(root, ['setup', '--check', '--json'], {
      setupDeps: { nodeVersion: 'v22.3.0', env: {}, runCommand: okCommand, readCodexAuth: noChatgptAuth },
    });

    expect(result.action).toBe('setup');
    expect(result.exitCode).toBe(1);
    expect(json.command).toBe('setup');
    expect(json.profile).toBe('global');
    expect(json.stages.map((stage: { id: string }) => stage.id)).toEqual([
      'prerequisites',
      'global-command',
      'data-directory',
      'configuration',
      'provider',
      'database',
      'web-service',
      'channels',
      'smoke-test',
    ]);
    expect(json.issues[0]).toEqual(expect.objectContaining({ code: expect.any(String), severity: expect.any(String), component: expect.any(String), evidence: expect.any(String), remediation: expect.any(String), fixable: expect.any(Boolean) }));
    expect(json.nextActions).toEqual(expect.arrayContaining(['haro doctor', 'haro provider setup codex']));
    expect(existsSync(join(root, 'setup-state.json'))).toBe(false);
  });

  it('setup --profile global reports missing global command with actionable remediation', async () => {
    const root = tempRoot('haro-feat027-global-missing-');
    const runCommand = (command: string, args: readonly string[]) => {
      if (command === 'haro') return { status: 127, stderr: 'haro: command not found' };
      return okCommand(command, args);
    };
    const { json } = await runJson(root, ['setup', '--profile', 'global', '--check', '--json'], {
      setupDeps: { nodeVersion: 'v22.3.0', env: { OPENAI_API_KEY: 'test-key' }, runCommand, readCodexAuth: noChatgptAuth },
    });
    const globalStage = json.stages.find((stage: { id: string }) => stage.id === 'global-command');
    expect(globalStage.status).toBe('error');
    expect(globalStage.issues[0]).toMatchObject({ code: 'CLI_GLOBAL_COMMAND_MISSING', component: 'cli', fixable: false });
    expect(globalStage.issues[0].remediation).toContain('npm install -g @haro/cli');
  });

  it('setup --profile systemd --repair creates a user-level systemd unit only under user config', async () => {
    const root = tempRoot('haro-feat027-systemd-');
    const configHome = join(root, 'xdg');
    const calls: string[] = [];
    const runCommand = (command: string, args: readonly string[]) => {
      calls.push([command, ...args].join(' '));
      return okCommand(command, args);
    };
    const { json } = await runJson(root, ['setup', '--profile', 'systemd', '--repair', '--json'], {
      setupDeps: { nodeVersion: 'v22.3.0', env: { OPENAI_API_KEY: 'test-key', XDG_CONFIG_HOME: configHome }, runCommand, readCodexAuth: noChatgptAuth },
    });
    const unit = join(configHome, 'systemd', 'user', 'haro-web.service');
    expect(existsSync(unit)).toBe(true);
    expect(readFileSync(unit, 'utf8')).toContain('ExecStart=haro web --host 127.0.0.1 --port 3456');
    expect(readFileSync(unit, 'utf8')).not.toContain('OPENAI_API_KEY');
    expect(calls).toEqual(expect.arrayContaining(['systemctl --user daemon-reload', 'systemctl --user enable haro-web.service']));
    expect(json.fixed).toEqual(expect.arrayContaining([expect.stringContaining('wrote-user-systemd-unit')]));
  });

  it('doctor --component web --json filters to web-service diagnostics', async () => {
    const root = tempRoot('haro-feat027-web-doctor-');
    const { json } = await runJson(root, ['doctor', '--component', 'web', '--json']);
    expect(json.command).toBe('doctor');
    expect(json.stages.map((stage: { id: string }) => stage.id)).toEqual(['web-service']);
    expect(json.web.expected.port).toBe(3456);
    expect(json.web.systemd.active).toBe('active');
    expect(json.web.apiKey.mode).toBe('unauthenticated');
    expect(json.issues.every((issue: { component: string }) => issue.component === 'web' || issue.component === 'systemd')).toBe(true);
  });

  it('doctor --fix repairs directories and sqlite idempotently without setup-state.json', async () => {
    const root = tempRoot('haro-feat027-doctor-fix-');
    const first = await runJson(root, ['doctor', '--fix', '--json']);
    expect(first.result.exitCode).toBe(0);
    expect(existsSync(join(root, 'data'))).toBe(true);
    expect(existsSync(join(root, 'haro.db'))).toBe(true);
    const second = await runJson(root, ['doctor', '--fix', '--json']);
    expect(second.result.exitCode).toBe(0);
    expect(second.json.sqlite.ok).toBe(true);
    expect(existsSync(join(root, 'setup-state.json'))).toBe(false);
  });

  it('smoke-test marks offline dry-run passed when provider secret is missing', async () => {
    const root = tempRoot('haro-feat027-offline-smoke-');
    const { json } = await runJson(root, ['setup', '--check', '--json'], {
      setupDeps: { nodeVersion: 'v22.3.0', env: {}, runCommand: okCommand, readCodexAuth: noChatgptAuth },
    });
    const smoke = json.stages.find((stage: { id: string }) => stage.id === 'smoke-test');
    expect(smoke.status).toBe('warning');
    expect(smoke.evidence.offlineDryRun).toBe('passed');
    expect(smoke.evidence.providerCall).toBe('skipped-provider-missing');
    expect(smoke.nextActions).toContain('haro provider setup codex');
  });

  it('smoke-test reports provider call failure as an error when provider is configured but unhealthy', async () => {
    const root = tempRoot('haro-feat027-provider-failed-');
    const { json } = await runJson(root, ['setup', '--check', '--json'], {
      createProviderRegistry: async () => createProviderRegistry(new StubProvider(false)),
    });
    const smoke = json.stages.find((stage: { id: string }) => stage.id === 'smoke-test');
    expect(smoke.status).toBe('error');
    expect(smoke.issues[0]).toMatchObject({ code: 'SMOKE_PROVIDER_CALL_FAILED', severity: 'error', component: 'provider', fixable: false });
  });

  it('onboard remains a setup alias for new check/json flags', async () => {
    const root = tempRoot('haro-feat027-onboard-');
    const { result, json } = await runJson(root, ['onboard', '--check', '--json']);
    expect(result.action).toBe('setup');
    expect(json.command).toBe('setup');
    expect(json.stages).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'provider' })]));
  });
});
