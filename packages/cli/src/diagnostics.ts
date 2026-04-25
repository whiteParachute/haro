import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { db as haroDb, fs as haroFs, type HaroPaths, type ProviderRegistry } from '@haro/core';
import type { HaroConfig, LoadedConfig } from '@haro/core/config';
import type { ChannelRegistry } from './channel.js';
import { DEFAULT_PROVIDER_CATALOG, type ProviderCatalogEntry } from './provider-catalog.js';
import { runProviderDoctor } from './provider-onboarding.js';

export type SetupStageId =
  | 'prerequisites'
  | 'global-command'
  | 'data-directory'
  | 'configuration'
  | 'provider'
  | 'database'
  | 'web-service'
  | 'channels'
  | 'smoke-test';

export type StageStatus = 'ok' | 'warning' | 'error' | 'skipped' | 'fixed';
export type DoctorSeverity = 'info' | 'warning' | 'error';
export type DoctorComponent = 'cli' | 'config' | 'provider' | 'database' | 'web' | 'channel' | 'systemd';
export type SetupProfile = 'dev' | 'global' | 'systemd';

export interface DoctorIssue {
  code: string;
  severity: DoctorSeverity;
  component: DoctorComponent;
  evidence: string;
  remediation: string;
  fixable: boolean;
}

export interface SetupStageResult {
  id: SetupStageId;
  status: StageStatus;
  issues: DoctorIssue[];
  nextActions: string[];
  evidence: Record<string, unknown>;
  fixed?: string[];
}

export interface DiagnosticsReport {
  ok: boolean;
  profile: SetupProfile;
  mode: 'setup' | 'doctor';
  fixed: string[];
  stages: SetupStageResult[];
  issues: DoctorIssue[];
  nextActions: string[];
  config: { ok: boolean; sources: string[]; path: string };
  providers: Array<{ id: string; healthy: boolean; error?: string }>;
  channels: Array<{ id: string; displayName: string; source: string; healthy: boolean; error?: string }>;
  dataDir: { root: string; checks: Array<{ name: string; path: string; exists: boolean; writable: boolean }> };
  sqlite: { ok: boolean; dbFile: string; error?: string };
  web?: WebDiagnosticSummary;
}

export interface SetupRunDeps {
  nodeVersion?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (
    command: string,
    args: readonly string[],
  ) => { status: number | null; stdout?: string | null; stderr?: string | null; error?: Error };
}

export interface DiagnosticsInput {
  mode: 'setup' | 'doctor';
  profile?: SetupProfile;
  component?: DoctorComponent;
  checkOnly?: boolean;
  fix?: boolean;
  paths: HaroPaths;
  root?: string;
  loaded: LoadedConfig;
  providerRegistry: ProviderRegistry;
  providerCatalog?: readonly ProviderCatalogEntry[];
  channelRegistry: ChannelRegistry;
  deps?: SetupRunDeps;
}

interface WebDiagnosticSummary {
  expected: { host: string; port: number; url: string; envFile: string; userUnit: string };
  listener: { checked: boolean; listening: boolean; detail: string };
  apiKey: { mode: 'authenticated' | 'unauthenticated' };
  systemd: { active: string; enabled: string; available: boolean; unitPath: string };
  envFile: { path: string; exists: boolean; readable: boolean };
}

const DEFAULT_TASK = '列出当前目录下的 TypeScript 文件';
const DEFAULT_WEB_HOST = '127.0.0.1';
const DEFAULT_WEB_PORT = 3456;
const USER_UNIT_NAME = 'haro-web.service';

export async function runDiagnostics(input: DiagnosticsInput): Promise<DiagnosticsReport> {
  const profile = input.profile ?? 'global';
  const deps = normalizeDeps(input.deps);
  const fixed: string[] = [];
  const ctx = { ...input, profile, deps, fixed };

  if (input.fix && !input.checkOnly) {
    await applySafeFixes(ctx);
  }

  const allStages = await buildStages(ctx);
  const stages = filterStages(allStages, input.component);
  const issues = stages.flatMap((stage) => stage.issues);
  const nextActions = unique([
    ...stages.flatMap((stage) => stage.nextActions),
    ...(input.mode === 'setup' ? ['haro doctor', 'haro channel setup feishu'] : []),
  ]);
  const providerStage = allStages.find((stage) => stage.id === 'provider');
  const channelStage = allStages.find((stage) => stage.id === 'channels');
  const dataStage = allStages.find((stage) => stage.id === 'data-directory');
  const dbStage = allStages.find((stage) => stage.id === 'database');
  const webStage = allStages.find((stage) => stage.id === 'web-service');

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    profile,
    mode: input.mode,
    fixed,
    stages,
    issues,
    nextActions,
    config: {
      ok: !allStages.some((stage) => stage.id === 'configuration' && stage.status === 'error'),
      sources: input.loaded.sources,
      path: input.paths.configFile,
    },
    providers: ((providerStage?.evidence.providers as DiagnosticsReport['providers'] | undefined) ?? []),
    channels: ((channelStage?.evidence.channels as DiagnosticsReport['channels'] | undefined) ?? []),
    dataDir: {
      root: input.paths.root,
      checks: ((dataStage?.evidence.checks as DiagnosticsReport['dataDir']['checks'] | undefined) ?? []),
    },
    sqlite: ((dbStage?.evidence.sqlite as DiagnosticsReport['sqlite'] | undefined) ?? {
      ok: false,
      dbFile: input.paths.dbFile,
      error: 'database stage not executed',
    }),
    ...(webStage?.evidence.web ? { web: webStage.evidence.web as WebDiagnosticSummary } : {}),
  };
}

async function buildStages(ctx: DiagnosticsInput & { profile: SetupProfile; deps: RequiredDeps; fixed: string[] }): Promise<SetupStageResult[]> {
  const provider = await checkProvider(ctx);
  return [
    checkPrerequisites(ctx),
    checkGlobalCommand(ctx),
    await checkDataDirectory(ctx),
    await checkConfiguration(ctx),
    provider,
    checkDatabase(ctx),
    await checkWebService(ctx),
    await checkChannels(ctx),
    checkSmokeTest(provider),
  ];
}

async function applySafeFixes(ctx: DiagnosticsInput & { profile: SetupProfile; deps: RequiredDeps; fixed: string[] }): Promise<void> {
  haroFs.ensureHaroDirectories(ctx.root);
  mkdirSync(join(ctx.paths.root, 'data'), { recursive: true });
  ctx.fixed.push('created-haro-directories');

  for (const dir of [ctx.paths.root, ...Object.values(ctx.paths.dirs), join(ctx.paths.root, 'data')]) {
    try {
      if (isUserOwned(dir)) {
        chmodSync(dir, 0o700);
        ctx.fixed.push(`chmod-700:${dir}`);
      }
    } catch {
      // Permission tightening is best-effort; diagnostics will report any remaining problem.
    }
  }

  persistDefaultConfig({ paths: ctx.paths, config: ctx.loaded.config });
  ctx.fixed.push('wrote-default-config');

  haroDb.initHaroDatabase({ root: ctx.root, dbFile: ctx.paths.dbFile });
  ctx.fixed.push('initialized-sqlite');

  if (ctx.profile === 'systemd' || ctx.component === 'web' || ctx.component === 'systemd') {
    const result = writeUserSystemdUnit(ctx);
    ctx.fixed.push(...result.fixed);
  }
}

function checkPrerequisites(ctx: { deps: RequiredDeps }): SetupStageResult {
  const nodeVersion = ctx.deps.nodeVersion;
  const nodeOk = isSupportedNode(nodeVersion);
  const pnpm = ctx.deps.runCommand('pnpm', ['--version']);
  const npm = ctx.deps.runCommand('npm', ['--version']);
  const pnpmVersion = pnpm.stdout?.trim() ?? '';
  const npmVersion = npm.stdout?.trim() ?? '';
  const pkgOk = (pnpm.status === 0 && pnpmVersion.length > 0) || (npm.status === 0 && npmVersion.length > 0);
  const issues: DoctorIssue[] = [];
  if (!nodeOk) {
    issues.push({
      code: 'CLI_NODE_UNSUPPORTED',
      severity: 'error',
      component: 'cli',
      evidence: `current Node.js is ${nodeVersion}`,
      remediation: 'Install Node.js 22 or newer, then rerun haro setup --check.',
      fixable: false,
    });
  }
  if (!pkgOk) {
    issues.push({
      code: 'CLI_PACKAGE_MANAGER_MISSING',
      severity: 'warning',
      component: 'cli',
      evidence: 'Neither pnpm nor npm returned a version.',
      remediation: 'Install pnpm or ensure npm is available on PATH.',
      fixable: false,
    });
  }
  return stage('prerequisites', issues, [], {
    node: { version: nodeVersion, ok: nodeOk },
    packageManager: { ok: pkgOk, pnpm: pnpmVersion || null, npm: npmVersion || null },
  });
}

function checkGlobalCommand(ctx: { profile: SetupProfile; deps: RequiredDeps }): SetupStageResult {
  if (ctx.profile === 'dev') {
    return stage('global-command', [], ['pnpm haro setup --profile dev'], { required: false, reason: 'dev profile uses pnpm haro / local source entrypoint' }, 'skipped');
  }
  const result = ctx.deps.runCommand('haro', ['--version']);
  const ok = result.status === 0;
  const issues: DoctorIssue[] = ok
    ? []
    : [
        {
          code: 'CLI_GLOBAL_COMMAND_MISSING',
          severity: 'error',
          component: 'cli',
          evidence: result.error?.message ?? result.stderr?.trim() ?? 'haro command is not available on PATH',
          remediation: 'Install globally with npm install -g @haro/cli or pnpm add -g @haro/cli, then ensure the global bin directory is on PATH.',
          fixable: false,
        },
      ];
  return stage('global-command', issues, ok ? [] : ['npm install -g @haro/cli@latest', 'haro setup --check'], {
    required: true,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
  });
}

async function checkDataDirectory(ctx: { paths: HaroPaths }): Promise<SetupStageResult> {
  const entries = {
    root: ctx.paths.root,
    logs: ctx.paths.dirs.logs,
    data: join(ctx.paths.root, 'data'),
    agents: ctx.paths.dirs.agents,
    skills: ctx.paths.dirs.skills,
    channels: ctx.paths.dirs.channels,
    memory: ctx.paths.dirs.memory,
  };
  const checks = await Promise.all(
    Object.entries(entries).map(async ([name, path]) => ({
      name,
      path,
      exists: existsSync(path),
      writable: await isWritable(path),
    })),
  );
  const issues: DoctorIssue[] = checks
    .filter((item) => !item.exists || !item.writable)
    .map((item) => ({
      code: item.exists ? 'DATA_DIRECTORY_NOT_WRITABLE' : 'DATA_DIRECTORY_MISSING',
      severity: 'error',
      component: 'database' as const,
      evidence: `${item.name}: ${item.path} exists=${item.exists} writable=${item.writable}`,
      remediation: 'Run haro doctor --fix to create Haro directories and tighten user-owned directory permissions.',
      fixable: true,
    }));
  return stage('data-directory', issues, issues.length > 0 ? ['haro doctor --fix'] : [], { checks });
}

async function checkConfiguration(ctx: { paths: HaroPaths; loaded: LoadedConfig; checkOnly?: boolean; mode: 'setup' | 'doctor'; providerRegistry: ProviderRegistry }): Promise<SetupStageResult> {
  const existingModel = ctx.loaded.config.providers?.codex?.defaultModel;
  const selectedModel = existingModel ?? (ctx.mode === 'setup' && !ctx.checkOnly ? await resolveDefaultModel(ctx.providerRegistry).catch(() => undefined) : undefined);
  const configExists = existsSync(ctx.paths.configFile);
  const issues: DoctorIssue[] = configExists
    ? []
    : [
        {
          code: 'CONFIG_FILE_MISSING',
          severity: 'warning',
          component: 'config',
          evidence: `${ctx.paths.configFile} does not exist`,
          remediation: 'Run haro setup --repair or haro doctor --fix to write a non-sensitive default config.',
          fixable: true,
        },
      ];

  if (ctx.mode === 'setup' && !ctx.checkOnly) {
    persistDefaultConfig({ paths: ctx.paths, config: ctx.loaded.config, selectedModel });
  }

  return stage('configuration', issues, issues.length > 0 ? ['haro setup --repair'] : [], {
    sources: ctx.loaded.sources,
    configFile: ctx.paths.configFile,
    exists: configExists,
    defaultProvider: 'codex',
    defaultModel: selectedModel ?? null,
  });
}

async function checkProvider(ctx: { providerRegistry: ProviderRegistry; providerCatalog?: readonly ProviderCatalogEntry[]; root?: string; deps: RequiredDeps }): Promise<SetupStageResult> {
  const catalog = ctx.providerCatalog ?? DEFAULT_PROVIDER_CATALOG;
  const entries = catalog.filter((entry) => ctx.providerRegistry.has(entry.id));
  const reports = await Promise.all(
    entries.map(async (entry) => {
      const report = await runProviderDoctor({
        entry,
        providerRegistry: ctx.providerRegistry,
        root: ctx.root,
        env: ctx.deps.env,
      });
      return {
        report,
        check: {
          id: entry.id,
          healthy: report.ok,
          secret: report.secret.currentProcess,
          secretSource: report.secret.source,
          envFile: report.secret.envFile,
          error: report.issues.find((issue) => issue.severity === 'error')?.evidence,
        },
      };
    }),
  );
  const issues: DoctorIssue[] = reports.flatMap((item) => item.report.issues);
  const checks = reports.map((item) => item.check);
  if (ctx.providerRegistry.list().length === 0) {
    issues.push({
      code: 'PROVIDER_REGISTRY_EMPTY',
      severity: 'error',
      component: 'provider',
      evidence: 'No providers are registered in the current CLI runtime.',
      remediation: 'Reinstall Haro or verify the CLI package includes @haro/provider-codex.',
      fixable: false,
    });
  }
  return stage('provider', issues, issues.length > 0 ? ['haro provider setup codex'] : [], { providers: checks, secret: checks.some((check) => check.secret === 'present') ? 'present' : 'missing' });
}

function checkDatabase(ctx: { root?: string; paths: HaroPaths }): SetupStageResult {
  try {
    const result = haroDb.initHaroDatabase({ root: ctx.root, dbFile: ctx.paths.dbFile });
    return stage('database', [], [], {
      sqlite: { ok: true, dbFile: result.dbFile, journalMode: result.journalMode, fts5Available: result.fts5Available },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sqlite = { ok: false, dbFile: ctx.paths.dbFile, error: message };
    return stage('database', [
      {
        code: 'DATABASE_SQLITE_UNAVAILABLE',
        severity: 'error',
        component: 'database',
        evidence: message,
        remediation: 'Run haro doctor --fix to initialize SQLite; if it still fails, check disk space and better-sqlite3 FTS5 support.',
        fixable: true,
      },
    ], ['haro doctor --fix'], { sqlite });
  }
}

async function checkWebService(ctx: { paths: HaroPaths; profile: SetupProfile; deps: RequiredDeps }): Promise<SetupStageResult> {
  const web = readWebDiagnostics(ctx);
  const issues: DoctorIssue[] = [];
  if (ctx.profile === 'systemd' && web.systemd.active !== 'active') {
    issues.push({
      code: 'WEB_SYSTEMD_INACTIVE',
      severity: 'warning',
      component: 'systemd',
      evidence: `systemctl --user is-active ${USER_UNIT_NAME}: ${web.systemd.active}`,
      remediation: 'Run haro setup --profile systemd --repair or haro doctor --component web --fix to create/update the user-level service unit, then start it with systemctl --user start haro-web.service.',
      fixable: true,
    });
  }
  if (ctx.profile === 'systemd' && web.systemd.enabled !== 'enabled') {
    issues.push({
      code: 'WEB_SYSTEMD_NOT_ENABLED',
      severity: 'warning',
      component: 'systemd',
      evidence: `systemctl --user is-enabled ${USER_UNIT_NAME}: ${web.systemd.enabled}`,
      remediation: 'Run haro doctor --component web --fix to enable the user-level service.',
      fixable: true,
    });
  }
  if (!web.listener.listening) {
    issues.push({
      code: 'WEB_LISTENER_NOT_DETECTED',
      severity: ctx.profile === 'systemd' ? 'warning' : 'info',
      component: 'web',
      evidence: web.listener.detail,
      remediation: `Start the dashboard with haro web --host ${web.expected.host} --port ${web.expected.port}.`,
      fixable: false,
    });
  }
  if (web.apiKey.mode === 'unauthenticated') {
    issues.push({
      code: 'WEB_API_KEY_UNSET',
      severity: 'warning',
      component: 'web',
      evidence: 'HARO_WEB_API_KEY is not set; dashboard auth is disabled.',
      remediation: `Set HARO_WEB_API_KEY in ${web.expected.envFile} or the service environment before exposing the dashboard beyond localhost.`,
      fixable: false,
    });
  }
  if (web.envFile.exists && !web.envFile.readable) {
    issues.push({
      code: 'WEB_ENV_FILE_UNREADABLE',
      severity: 'warning',
      component: 'web',
      evidence: `${web.envFile.path} exists but is not readable`,
      remediation: 'Fix user file permissions so the Haro user service can read its env file.',
      fixable: false,
    });
  }
  return stage('web-service', issues, issues.some((issue) => issue.fixable) ? ['haro doctor --component web --fix'] : [], { web });
}

async function checkChannels(ctx: { channelRegistry: ChannelRegistry }): Promise<SetupStageResult> {
  const checks = await Promise.all(
    ctx.channelRegistry
      .listEnabled()
      .filter((entry) => entry.source === 'package')
      .map(async (entry) => {
        try {
          return { id: entry.id, displayName: entry.displayName, source: entry.source, healthy: await entry.channel.healthCheck() };
        } catch (err) {
          return { id: entry.id, displayName: entry.displayName, source: entry.source, healthy: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
  );
  const issues: DoctorIssue[] = checks
    .filter((check) => !check.healthy)
    .map((check) => ({
      code: 'CHANNEL_HEALTHCHECK_FAILED',
      severity: 'warning',
      component: 'channel' as const,
      evidence: check.error ? `${check.id}: ${check.error}` : `${check.id}: healthCheck() returned false`,
      remediation: `Run haro channel doctor ${check.id} or haro channel setup ${check.id}.`,
      fixable: false,
    }));
  return stage('channels', issues, issues.length > 0 ? unique(checks.filter((check) => !check.healthy).map((check) => `haro channel doctor ${check.id}`)) : [], { channels: checks });
}

function checkSmokeTest(providerStage: SetupStageResult): SetupStageResult {
  const missingSecret = providerStage.issues.some((issue) => issue.code === 'PROVIDER_SECRET_MISSING');
  const providerFailed = providerStage.issues.some((issue) => issue.code === 'PROVIDER_HEALTHCHECK_FAILED');
  if (missingSecret) {
    return stage('smoke-test', [
      {
        code: 'SMOKE_PROVIDER_SKIPPED_OFFLINE_PASSED',
        severity: 'warning',
        component: 'provider',
        evidence: 'Offline dry-run passed for CLI/config/database readiness; provider call skipped because OPENAI_API_KEY is missing.',
        remediation: 'Run haro provider setup codex, then rerun haro setup --check or haro doctor.',
        fixable: false,
      },
    ], ['haro provider setup codex', `haro run "${DEFAULT_TASK}"`], { offlineDryRun: 'passed', providerCall: 'skipped-provider-missing' });
  }
  if (providerFailed) {
    return stage('smoke-test', [
      {
        code: 'SMOKE_PROVIDER_CALL_FAILED',
        severity: 'error',
        component: 'provider',
        evidence: providerStage.issues.map((issue) => issue.evidence).join('; '),
        remediation: 'Fix provider connectivity with haro provider doctor codex before running live tasks.',
        fixable: false,
      },
    ], ['haro provider doctor codex'], { offlineDryRun: 'passed', providerCall: 'failed' });
  }
  return stage('smoke-test', [], [`haro run "${DEFAULT_TASK}"`], { offlineDryRun: 'passed', providerCall: 'health-check-passed' });
}

function readWebDiagnostics(ctx: { paths: HaroPaths; deps: RequiredDeps }): WebDiagnosticSummary {
  const host = ctx.deps.env.HARO_WEB_HOST?.trim() || DEFAULT_WEB_HOST;
  const port = parsePort(ctx.deps.env.HARO_WEB_PORT) ?? DEFAULT_WEB_PORT;
  const envFile = join(ctx.paths.root, 'web.env');
  const unitPath = userSystemdUnitPath(ctx.deps.env);
  const active = readSystemctlState(ctx.deps, 'is-active');
  const enabled = readSystemctlState(ctx.deps, 'is-enabled');
  const listener = readListener(ctx.deps, host, port);
  const envExists = existsSync(envFile);
  return {
    expected: { host, port, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`, envFile, userUnit: unitPath },
    listener,
    apiKey: { mode: ctx.deps.env.HARO_WEB_API_KEY && ctx.deps.env.HARO_WEB_API_KEY.trim() ? 'authenticated' : 'unauthenticated' },
    systemd: { active, enabled, available: active !== 'unavailable' || enabled !== 'unavailable', unitPath },
    envFile: { path: envFile, exists: envExists, readable: envExists ? canRead(envFile) : false },
  };
}

function writeUserSystemdUnit(ctx: { paths: HaroPaths; deps: RequiredDeps }): { fixed: string[] } {
  const fixed: string[] = [];
  const host = ctx.deps.env.HARO_WEB_HOST?.trim() || DEFAULT_WEB_HOST;
  const port = parsePort(ctx.deps.env.HARO_WEB_PORT) ?? DEFAULT_WEB_PORT;
  const unitPath = userSystemdUnitPath(ctx.deps.env);
  mkdirSync(dirname(unitPath), { recursive: true });
  const envFile = join(ctx.paths.root, 'web.env');
  const content = `[Unit]\nDescription=Haro Web Dashboard\nAfter=network.target\n\n[Service]\nType=simple\nEnvironment=HARO_HOME=${ctx.paths.root}\nEnvironmentFile=-${envFile}\nExecStart=haro web --host ${host} --port ${port}\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
  writeFileSync(unitPath, content, { encoding: 'utf8', mode: 0o644 });
  fixed.push(`wrote-user-systemd-unit:${unitPath}`);
  const reload = ctx.deps.runCommand('systemctl', ['--user', 'daemon-reload']);
  if (reload.status === 0) fixed.push('systemd-user-daemon-reload');
  const enable = ctx.deps.runCommand('systemctl', ['--user', 'enable', USER_UNIT_NAME]);
  if (enable.status === 0) fixed.push(`systemd-user-enable:${USER_UNIT_NAME}`);
  return { fixed };
}

function readSystemctlState(deps: RequiredDeps, action: 'is-active' | 'is-enabled'): string {
  const result = deps.runCommand('systemctl', ['--user', action, USER_UNIT_NAME]);
  if (result.status === 0) return result.stdout?.trim() || (action === 'is-active' ? 'active' : 'enabled');
  const detail = result.stdout?.trim() || result.stderr?.trim() || result.error?.message || '';
  if (/not found|No such file|ENOENT/i.test(detail)) return 'unavailable';
  return detail || (action === 'is-active' ? 'inactive' : 'disabled');
}

function readListener(deps: RequiredDeps, host: string, port: number): WebDiagnosticSummary['listener'] {
  const result = deps.runCommand('ss', ['-ltnp']);
  if (result.status !== 0) {
    return { checked: false, listening: false, detail: result.stderr?.trim() || result.error?.message || 'ss -ltnp unavailable' };
  }
  const stdout = result.stdout ?? '';
  const matches = stdout.split('\n').filter((line) => line.includes(`:${port}`));
  const listening = matches.length > 0;
  const expectedHostSeen = matches.some((line) => line.includes(`${host}:${port}`) || (host === '127.0.0.1' && line.includes(`localhost:${port}`)) || (host === '0.0.0.0' && line.includes(`*:${port}`)));
  return {
    checked: true,
    listening,
    detail: listening ? (expectedHostSeen ? matches.join('\n') : `port ${port} is listening but expected host ${host} was not confirmed: ${matches.join('\n')}`) : `no TCP listener found on port ${port}`,
  };
}

function persistDefaultConfig(input: { paths: HaroPaths; config: HaroConfig; selectedModel?: string }): void {
  input.config.providers ??= {};
  input.config.providers.codex ??= {};
  if (input.selectedModel) input.config.providers.codex.defaultModel = input.selectedModel;
  mkdirSync(dirname(input.paths.configFile), { recursive: true });
  writeFileSync(input.paths.configFile, stringifyYaml(input.config), 'utf8');
}

async function resolveDefaultModel(providerRegistry: ProviderRegistry): Promise<string | undefined> {
  const provider = providerRegistry.tryGet('codex') as { listModels?: () => Promise<readonly { id: string }[]> } | undefined;
  if (typeof provider?.listModels !== 'function') return undefined;
  const models = await provider.listModels();
  return models[0]?.id;
}

function stage(id: SetupStageId, issues: DoctorIssue[], nextActions: string[], evidence: Record<string, unknown>, forcedStatus?: StageStatus): SetupStageResult {
  return {
    id,
    status: forcedStatus ?? statusFromIssues(issues),
    issues,
    nextActions,
    evidence,
  };
}

function statusFromIssues(issues: DoctorIssue[]): StageStatus {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'ok';
}

function filterStages(stages: SetupStageResult[], component?: DoctorComponent): SetupStageResult[] {
  if (!component) return stages;
  const ids = new Set<SetupStageId>(componentStageIds(component));
  return stages.filter((stage) => ids.has(stage.id));
}

function componentStageIds(component: DoctorComponent): SetupStageId[] {
  switch (component) {
    case 'cli':
      return ['prerequisites', 'global-command'];
    case 'config':
      return ['configuration'];
    case 'provider':
      return ['provider', 'smoke-test'];
    case 'database':
      return ['data-directory', 'database'];
    case 'web':
    case 'systemd':
      return ['web-service'];
    case 'channel':
      return ['channels'];
  }
}

interface RequiredDeps {
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
  runCommand: NonNullable<SetupRunDeps['runCommand']>;
}

function normalizeDeps(deps?: SetupRunDeps): RequiredDeps {
  return {
    nodeVersion: deps?.nodeVersion ?? process.version,
    env: deps?.env ?? process.env,
    runCommand: deps?.runCommand ?? ((command, args) => spawnSync(command, args, { encoding: 'utf8' })),
  };
}

function isSupportedNode(version: string): boolean {
  const match = /^v?(\d+)/.exec(version);
  const major = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  return major >= 22;
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canRead(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isUserOwned(path: string): boolean {
  if (!existsSync(path)) return false;
  if (typeof process.getuid !== 'function') return true;
  return statSync(path).uid === process.getuid();
}

function userSystemdUnitPath(env: NodeJS.ProcessEnv): string {
  const configRoot = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.config');
  return join(configRoot, 'systemd', 'user', USER_UNIT_NAME);
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}

function unique(items: readonly string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.length > 0)));
}

export function formatDiagnosticsHuman(report: DiagnosticsReport): string {
  const lines = [
    report.mode === 'setup' ? `Haro setup / onboard (${report.profile})` : `Haro doctor (${report.profile})`,
    '',
    '阶段结果：',
  ];
  for (const stageResult of report.stages) {
    lines.push(`- ${stageResult.status.toUpperCase()} ${stageResult.id}`);
    if (stageResult.id === 'prerequisites') {
      const pm = stageResult.evidence.packageManager as { pnpm?: string | null; npm?: string | null } | undefined;
      const node = stageResult.evidence.node as { version?: string } | undefined;
      lines.push(`  - Node.js: ${node?.version ?? 'unknown'}`);
      lines.push(`  - 包管理器: ${pm?.pnpm ? `pnpm ${pm.pnpm}` : pm?.npm ? `npm ${pm.npm}` : '未检测到'}`);
    }
    for (const issue of stageResult.issues) {
      lines.push(`  - [${issue.severity}] ${issue.code}: ${issue.evidence}`);
      lines.push(`    修复建议：${issue.remediation}`);
    }
  }
  if (report.fixed.length > 0) {
    lines.push('', '已执行安全修复：', ...report.fixed.map((item) => `- ${item}`));
  }
  lines.push('', `配置文件：${report.config.path}`);
  lines.push(`SQLite：${report.sqlite.ok ? 'ok' : `error (${report.sqlite.error ?? 'unknown'})`}`);
  if (report.nextActions.length > 0) {
    lines.push('', '下一步：', ...report.nextActions.map((item, index) => `${index + 1}. ${item}`));
  }
  if (!report.ok) {
    lines.push('', '诊断结论：存在需要处理的错误。');
  } else {
    lines.push('', '诊断结论：基础检查通过。');
  }
  return `${lines.join('\n')}\n`;
}

export function parseSetupProfile(value: unknown): SetupProfile {
  if (value === 'dev' || value === 'global' || value === 'systemd') return value;
  throw new Error(`Invalid setup profile: ${String(value)} (expected dev, global, or systemd)`);
}

export function parseDoctorComponent(value: unknown): DoctorComponent | undefined {
  if (value === undefined) return undefined;
  if (value === 'provider' || value === 'web' || value === 'database' || value === 'channel' || value === 'config' || value === 'cli' || value === 'systemd') return value;
  throw new Error(`Invalid doctor component: ${String(value)}`);
}
