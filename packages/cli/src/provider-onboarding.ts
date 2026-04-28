import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { buildHaroPaths, config as haroConfig, type ProviderRegistry } from '@haro/core';
import type { AgentProvider } from '@haro/core/provider';
import { readLocalCodexAuth, type LocalCodexAuth } from '@haro/provider-codex';
import {
  getProviderCatalogEntry,
  providerEnvFileSystemdReference,
  resolveProviderEnvFile,
  secretRefToEnvVar,
  type ProviderCatalogEntry,
} from './provider-catalog.js';

export type ProviderIssueCode =
  | 'PROVIDER_SECRET_MISSING'
  | 'PROVIDER_ENV_FILE_UNREADABLE'
  | 'PROVIDER_HEALTHCHECK_FAILED'
  | 'PROVIDER_MODEL_LIST_FAILED'
  | 'PROVIDER_PROJECT_SECRET_INHERITED'
  | 'PROVIDER_REGISTRY_EMPTY';

export type ProviderIssueSeverity = 'info' | 'warning' | 'error';

export interface ProviderDoctorIssue {
  code: ProviderIssueCode;
  severity: ProviderIssueSeverity;
  component: 'provider';
  evidence: string;
  remediation: string;
  fixable: boolean;
}

export interface ProviderEnvFileSummary {
  path: string;
  exists: boolean;
  readable: boolean;
  containsSecret: boolean;
  mode?: string;
  systemdReference: string;
}

export interface ProviderSecretSummary {
  envVar: string;
  secretRef: string;
  currentProcess: 'present' | 'missing';
  source: 'current-process' | 'systemd-env-file' | 'missing';
  envFile: ProviderEnvFileSummary;
}

export interface ProviderConfigSourceSummary {
  globalPath: string;
  projectPath?: string;
  global: Record<string, unknown>;
  project: Record<string, unknown>;
  effective: Record<string, unknown>;
  secretRefSource: 'project' | 'global' | 'default';
}

export interface ProviderDoctorResult {
  provider: string;
  displayName: string;
  ok: boolean;
  healthy: boolean | null;
  issues: ProviderDoctorIssue[];
  secret: ProviderSecretSummary;
  config: ProviderConfigSourceSummary;
  models?: Array<{ id: string; maxContextTokens?: number }>;
  /** FEAT-029 — when codex provider is in chatgpt mode, surface ride-along auth status. */
  chatgptAuth?: {
    authMode: 'env' | 'chatgpt' | 'auto';
    detected: boolean;
    hasAuth: boolean;
    accountId: string | null;
    lastRefresh: string | null;
    authFilePath: string;
  };
  /** FEAT-029 R9 — codex binary PATH visibility for ChatGPT auth remediation. */
  codexBinary?: {
    name: 'codex';
    onPath: boolean;
    path?: string;
  };
}

export interface ProviderDoctorInput {
  entry: ProviderCatalogEntry;
  providerRegistry: ProviderRegistry;
  root?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  checkHealth?: boolean;
  checkModels?: boolean;
  /** FEAT-029 — inject a fake codex auth probe for hermetic tests / diagnostics. */
  readCodexAuth?: () => LocalCodexAuth;
}

export type ProviderScope = 'global' | 'project';

export interface ProviderConfigWriteResult {
  path: string;
  config: haroConfig.HaroConfig;
}

export interface ProviderEnvFileWriteResult {
  path: string;
  envVars: readonly string[];
  mode: string;
}

type ProviderWithModels = AgentProvider & {
  listModels?: () => Promise<readonly { id: string; maxContextTokens?: number }[]>;
};

export function parseProviderScope(value: unknown): ProviderScope {
  if (value === 'global' || value === 'project') return value;
  throw new Error(`Invalid provider scope: ${String(value)} (expected global or project)`);
}

export async function runProviderDoctor(input: ProviderDoctorInput): Promise<ProviderDoctorResult> {
  const env = input.env ?? process.env;
  const sources = readProviderConfigSources({
    root: input.root,
    projectRoot: input.projectRoot,
    providerId: input.entry.id,
  });
  const secretRef = stringValue(sources.effective.secretRef) ?? input.entry.auth.defaultSecretRef;
  const envVar = secretRefToEnvVar(secretRef, input.entry);
  const currentSecret = env[envVar]?.trim();
  const envFile = await readProviderEnvFileSummary(input.entry, env, secretRef);
  const secret: ProviderSecretSummary = {
    envVar,
    secretRef,
    currentProcess: currentSecret ? 'present' : 'missing',
    source: currentSecret ? 'current-process' : envFile.containsSecret ? 'systemd-env-file' : 'missing',
    envFile,
  };

  const issues: ProviderDoctorIssue[] = [];

  // FEAT-029 — codex provider chatgpt mode: ride-along ~/.codex/auth.json.
  // Surface auth status and downgrade "secret missing" to info when ChatGPT
  // login is the active auth path.
  let chatgptAuthSummary: ProviderDoctorResult['chatgptAuth'];
  let codexBinarySummary: ProviderDoctorResult['codexBinary'];
  let chatgptModeActive = false;
  if (input.entry.id === 'codex') {
    codexBinarySummary = resolveExecutableOnPath('codex', env);
    const declaredAuthMode = (() => {
      const raw = sources.effective.authMode;
      return raw === 'env' || raw === 'chatgpt' || raw === 'auto' ? raw : 'auto';
    })();
    let localAuth: LocalCodexAuth | null = null;
    if (declaredAuthMode === 'chatgpt' || declaredAuthMode === 'auto') {
      // FEAT-029 — when the caller passed an explicit env (tests / hermetic
      // diagnostics), forward it so `readLocalCodexAuth` does not read from
      // the developer's real ~/.codex/auth.json.
      localAuth = input.readCodexAuth
        ? input.readCodexAuth()
        : readLocalCodexAuth(input.env ? { env: input.env as Record<string, string | undefined> } : {});
    }
    chatgptAuthSummary = {
      authMode: declaredAuthMode,
      detected: localAuth?.detected ?? false,
      hasAuth: localAuth?.hasAuth ?? false,
      accountId: localAuth?.accountId ?? null,
      lastRefresh: localAuth?.lastRefresh ?? null,
      authFilePath: localAuth?.authFilePath ?? '',
    };
    if (declaredAuthMode === 'chatgpt') {
      chatgptModeActive = true;
      if (!localAuth?.hasAuth) {
        issues.push({
          code: 'PROVIDER_SECRET_MISSING',
          severity: 'error',
          component: 'provider',
          evidence: `authMode=chatgpt but no ChatGPT login was found at ${localAuth?.authFilePath ?? '~/.codex/auth.json'}.`,
          remediation: 'Run `haro provider setup codex` (or `codex login`) to sign in with ChatGPT.',
          fixable: false,
        });
      }
    } else if (declaredAuthMode === 'auto' && localAuth?.hasAuth && !currentSecret) {
      // auto mode + chatgpt auth present + no env API key → effective path is chatgpt.
      chatgptModeActive = true;
    }
  }

  if (envFile.exists && !envFile.readable) {
    issues.push({
      code: 'PROVIDER_ENV_FILE_UNREADABLE',
      severity: 'error',
      component: 'provider',
      evidence: `${envFile.path} exists but is not readable by the current user/process.`,
      remediation: `Fix permissions or rerun haro provider setup ${input.entry.id} --write-env-file with a safe secret source.`,
      fixable: false,
    });
  }

  if (!currentSecret && !chatgptModeActive) {
    const evidence = envFile.containsSecret
      ? `未检测到 ${envVar}；${envVar} is missing in the current process, but ${envFile.path} is readable and contains ${envVar} for systemd/service loading.`
      : `未检测到 ${envVar}；${envVar} is not set in the current process and was not found in ${envFile.path}.`;
    issues.push({
      code: 'PROVIDER_SECRET_MISSING',
      severity: 'error',
      component: 'provider',
      evidence,
      remediation: `Run haro provider setup ${input.entry.id}, export ${envVar}=<your-key>, or load ${envFile.path} before running Haro commands.`,
      fixable: false,
    });
  }

  if (
    sources.secretRefSource === 'global' &&
    input.projectRoot &&
    Object.keys(sources.global).length > 0 &&
    Object.keys(sources.project).length > 0
  ) {
    issues.push({
      code: 'PROVIDER_PROJECT_SECRET_INHERITED',
      severity: 'info',
      component: 'provider',
      evidence: `Project scope inherits ${input.entry.id}.secretRef from global config (${sources.globalPath}).`,
      remediation: `To make inheritance explicit, run haro provider setup ${input.entry.id} --scope project --secret-ref ${secretRef} --non-interactive.`,
      fixable: false,
    });
  }

  const provider = input.providerRegistry.tryGet(input.entry.id) as ProviderWithModels | undefined;
  let healthy: boolean | null = null;
  let models: ProviderDoctorResult['models'];
  if (!provider && (input.checkHealth !== false || input.checkModels === true)) {
    issues.push({
      code: 'PROVIDER_REGISTRY_EMPTY',
      severity: 'error',
      component: 'provider',
      evidence: `Provider '${input.entry.id}' is not registered in the current CLI runtime.`,
      remediation: 'Reinstall Haro or verify the provider package is included in this CLI build.',
      fixable: false,
    });
  } else if (provider && currentSecret && input.checkHealth !== false) {
    try {
      healthy = await provider.healthCheck();
      if (!healthy) {
        issues.push({
          code: 'PROVIDER_HEALTHCHECK_FAILED',
          severity: 'error',
          component: 'provider',
          evidence: `${input.entry.id}: healthCheck() returned false`,
          remediation: `Run haro provider doctor ${input.entry.id} after verifying ${envVar}, baseUrl, and network access.`,
          fixable: false,
        });
      }
    } catch (error) {
      healthy = false;
      issues.push({
        code: 'PROVIDER_HEALTHCHECK_FAILED',
        severity: 'error',
        component: 'provider',
        evidence: `${input.entry.id}: ${error instanceof Error ? error.message : String(error)}`,
        remediation: `Run haro provider doctor ${input.entry.id} after verifying ${envVar}, baseUrl, and network access.`,
        fixable: false,
      });
    }
  }

  if (provider && currentSecret && input.checkModels === true) {
    if (typeof provider.listModels !== 'function') {
      issues.push({
        code: 'PROVIDER_MODEL_LIST_FAILED',
        severity: 'error',
        component: 'provider',
        evidence: `Provider '${input.entry.id}' does not expose listModels().`,
        remediation: `Upgrade or reinstall the provider package before running haro provider models ${input.entry.id}.`,
        fixable: false,
      });
    } else {
      try {
        models = (await provider.listModels()).map((model) => ({
          id: model.id,
          ...(model.maxContextTokens !== undefined ? { maxContextTokens: model.maxContextTokens } : {}),
        }));
      } catch (error) {
        issues.push({
          code: 'PROVIDER_MODEL_LIST_FAILED',
          severity: 'error',
          component: 'provider',
          evidence: `${input.entry.id}: ${error instanceof Error ? error.message : String(error)}`,
          remediation: `Run haro provider setup ${input.entry.id} and verify ${envVar} before listing models.`,
          fixable: false,
        });
      }
    }
  }

  return {
    provider: input.entry.id,
    displayName: input.entry.displayName,
    ok: !issues.some((issue) => issue.severity === 'error'),
    healthy,
    issues,
    secret,
    config: sources,
    ...(models ? { models } : {}),
    ...(chatgptAuthSummary ? { chatgptAuth: chatgptAuthSummary } : {}),
    ...(codexBinarySummary ? { codexBinary: codexBinarySummary } : {}),
  };
}

export async function listProviderModels(
  registry: ProviderRegistry,
  providerId: string,
): Promise<Array<{ id: string; maxContextTokens?: number }>> {
  const provider = registry.get(providerId) as ProviderWithModels;
  if (typeof provider.listModels !== 'function') {
    throw new Error(`Provider '${providerId}' does not expose listModels()`);
  }
  return (await provider.listModels()).map((model) => ({
    id: model.id,
    ...(model.maxContextTokens !== undefined ? { maxContextTokens: model.maxContextTokens } : {}),
  }));
}

export async function assertProviderModelExists(
  registry: ProviderRegistry,
  providerId: string,
  modelId: string,
): Promise<void> {
  const models = await listProviderModels(registry, providerId);
  if (!models.some((item) => item.id === modelId)) {
    throw new Error(`Provider '${providerId}' does not expose model '${modelId}'`);
  }
}

export function readProviderConfigSources(input: {
  root?: string;
  projectRoot?: string;
  providerId: string;
}): ProviderConfigSourceSummary {
  const globalPath = buildHaroPaths(input.root).configFile;
  const projectPath = input.projectRoot ? join(input.projectRoot, '.haro', 'config.yaml') : undefined;
  const globalConfig = readProviderConfigAtPath(globalPath, input.providerId);
  const projectConfig = projectPath ? readProviderConfigAtPath(projectPath, input.providerId) : {};
  const effective = { ...globalConfig, ...projectConfig };
  const secretRefSource =
    stringValue(projectConfig.secretRef) !== undefined
      ? 'project'
      : stringValue(globalConfig.secretRef) !== undefined
        ? 'global'
        : 'default';
  return {
    globalPath,
    ...(projectPath ? { projectPath } : {}),
    global: globalConfig,
    project: projectConfig,
    effective,
    secretRefSource,
  };
}

export function writeProviderConfig(input: {
  scope: ProviderScope;
  root?: string;
  projectRoot?: string;
  entry: ProviderCatalogEntry;
  patch: Record<string, unknown>;
}): ProviderConfigWriteResult {
  const targetPath =
    input.scope === 'global'
      ? buildHaroPaths(input.root).configFile
      : join(input.projectRoot ?? process.cwd(), '.haro', 'config.yaml');
  const raw = readYamlObject(targetPath);
  const providers = objectValue(raw.providers);
  const currentProvider = objectValue(providers[input.entry.id]);
  providers[input.entry.id] = { ...currentProvider, ...input.patch };
  raw.providers = providers;
  const parsed = haroConfig.parseHaroConfig(targetPath, raw);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, stringifyYaml(parsed), 'utf8');
  return { path: targetPath, config: parsed };
}

export function writeProviderEnvFile(input: {
  entry: ProviderCatalogEntry;
  env?: NodeJS.ProcessEnv;
  envFile?: string;
}): ProviderEnvFileWriteResult {
  const env = input.env ?? process.env;
  const envFile = input.envFile ?? resolveProviderEnvFile(env);
  const missing = input.entry.auth.envVars.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Cannot write provider env file: missing ${missing.join(', ')} in the current process.`);
  }
  mkdirSync(dirname(envFile), { recursive: true });
  const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const next = mergeEnvFile(existing, input.entry.auth.envVars, env);
  const tmp = `${envFile}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, envFile);
  chmodSync(envFile, 0o600);
  return { path: envFile, envVars: input.entry.auth.envVars, mode: '0600' };
}

export function formatProviderDoctorHuman(result: ProviderDoctorResult): string {
  const lines = [
    `Provider doctor: ${result.provider} (${result.displayName})`,
    '',
    `Status: ${result.ok ? 'ok' : 'error'}`,
    `Secret ref: ${result.secret.secretRef}`,
    `Current process: ${result.secret.envVar}=${result.secret.currentProcess === 'present' ? 'present (masked)' : 'missing'}`,
    `Env file: ${result.secret.envFile.path} (${result.secret.envFile.exists ? 'exists' : 'missing'}, ${result.secret.envFile.readable ? 'readable' : 'not-readable'}, containsSecret=${result.secret.envFile.containsSecret})`,
    `Systemd EnvironmentFile: EnvironmentFile=${result.secret.envFile.systemdReference}`,
    `Config: global=${result.config.globalPath}${result.config.projectPath ? ` project=${result.config.projectPath}` : ''}`,
  ];
  if (isChatGptAuthActive(result)) {
    const chatgptAuth = result.chatgptAuth;
    if (!chatgptAuth) return `${lines.join('\n')}\n`;
    lines.push(
      `Auth mode: ${chatgptAuth.authMode}`,
      `ChatGPT auth.json: ${chatgptAuth.authFilePath || '~/.codex/auth.json'} (${chatgptAuth.hasAuth ? 'present' : 'missing'})`,
      `ChatGPT account_id: ${chatgptAuth.accountId ?? '…'}`,
      `ChatGPT last_refresh: ${chatgptAuth.lastRefresh ?? '<unknown>'}`,
    );
  }
  if (result.codexBinary) {
    lines.push(`Codex binary: ${result.codexBinary.onPath ? result.codexBinary.path : 'not found in PATH'}`);
  }
  if (result.models) {
    lines.push(`Models: ${result.models.map((model) => model.id).join(', ') || '<none>'}`);
  }
  if (result.issues.length > 0) {
    lines.push('', 'Issues:');
    for (const issue of result.issues) {
      lines.push(`- [${issue.severity}] ${issue.code}: ${issue.evidence}`);
      lines.push(`  Remediation: ${issue.remediation}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatProviderEnvHuman(result: ProviderDoctorResult): string {
  if (isChatGptAuthActive(result)) {
    const authPath = result.chatgptAuth?.authFilePath || '~/.codex/auth.json';
    const lines = [
      `Provider env: ${result.provider} (${result.displayName})`,
      '',
      `ChatGPT subscription auth via ~/.codex/auth.json`,
      `- authMode: ${result.chatgptAuth?.authMode ?? 'chatgpt'}`,
      `- auth.json: ${authPath}`,
      `- account_id: ${result.chatgptAuth?.accountId ?? '…'}`,
      `- last_refresh: ${result.chatgptAuth?.lastRefresh ?? '<unknown>'}`,
      `- codex binary: ${result.codexBinary?.onPath ? result.codexBinary.path : 'not found in PATH'}`,
      '',
      'No OPENAI_API_KEY export is required for this provider mode.',
    ];
    return `${lines.join('\n')}\n`;
  }

  const template = result.secret.envVar;
  const lines = [
    `Provider env: ${result.provider} (${result.displayName})`,
    '',
    'Current sources:',
    `- secretRef: ${result.secret.secretRef}`,
    `- current process: ${template}=${result.secret.currentProcess === 'present' ? 'present (masked)' : 'missing'}`,
    `- provider env file: ${result.secret.envFile.path}`,
    `  - exists=${result.secret.envFile.exists} readable=${result.secret.envFile.readable} containsSecret=${result.secret.envFile.containsSecret}`,
    `  - systemd: EnvironmentFile=${result.secret.envFile.systemdReference}`,
    '',
    'Template (do not paste secrets into YAML):',
    `${template}=<your-provider-secret>`,
    '',
    'Safe setup:',
    `1. Export ${template} in the shell before running Haro, or put it in ${result.secret.envFile.path} with mode 0600.`,
    `2. Run haro provider setup ${result.provider} --secret-ref ${result.secret.secretRef} --non-interactive.`,
    `3. For user systemd services, include EnvironmentFile=${result.secret.envFile.systemdReference}.`,
  ];
  return `${lines.join('\n')}\n`;
}

export function formatProviderList(entries: readonly ProviderCatalogEntry[]): string {
  const lines = entries.map((entry) => {
    const fields = entry.configurableFields.map((field) => field.key).join(',');
    const envVars = entry.auth.envVars.join(',');
    return [entry.id, entry.displayName, `auth=env:${envVars}`, `models=${entry.modelDiscovery}`, `fields=${fields}`].join('\t');
  });
  return `${lines.join('\n')}\n`;
}

export function buildProviderPatch(input: {
  entry: ProviderCatalogEntry;
  enabled?: boolean;
  model?: string;
  baseUrl?: string;
  secretRef?: string;
  authMode?: 'env' | 'chatgpt' | 'auto';
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    enabled: input.enabled ?? true,
    secretRef: input.secretRef ?? input.entry.auth.defaultSecretRef,
  };
  if (input.model) patch.defaultModel = input.model;
  if (input.baseUrl) patch.baseUrl = input.baseUrl;
  if (input.authMode) patch.authMode = input.authMode;
  return patch;
}

export function getCatalogEntryOrThrow(id: string, entries: readonly ProviderCatalogEntry[]): ProviderCatalogEntry {
  return getProviderCatalogEntry(id, entries);
}

async function readProviderEnvFileSummary(
  entry: ProviderCatalogEntry,
  env: NodeJS.ProcessEnv,
  secretRef: string,
): Promise<ProviderEnvFileSummary> {
  const path = resolveProviderEnvFile(env);
  const exists = existsSync(path);
  let readable = false;
  let containsSecret = false;
  let mode: string | undefined;
  if (exists) {
    try {
      const stat = statSync(path);
      mode = (stat.mode & 0o777).toString(8).padStart(4, '0');
    } catch {
      mode = undefined;
    }
    try {
      await access(path, constants.R_OK);
      readable = true;
      const envVar = secretRefToEnvVar(secretRef, entry);
      containsSecret = envFileContainsVar(readFileSync(path, 'utf8'), envVar);
    } catch {
      readable = false;
    }
  }
  return {
    path,
    exists,
    readable,
    containsSecret,
    ...(mode ? { mode } : {}),
    systemdReference: providerEnvFileSystemdReference(env),
  };
}

function readProviderConfigAtPath(path: string, providerId: string): Record<string, unknown> {
  const raw = readYamlObject(path);
  haroConfig.parseHaroConfig(path, raw);
  const providers = objectValue(raw.providers);
  return { ...objectValue(providers[providerId]) };
}

function readYamlObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = parseYaml(readFileSync(path, 'utf8')) ?? {};
  if (!isRecord(parsed)) return {};
  return { ...parsed };
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function envFileContainsVar(text: string, name: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`).test(line));
}

function mergeEnvFile(text: string, names: readonly string[], env: NodeJS.ProcessEnv): string {
  const pending = new Set(names);
  const lines = text.length > 0 ? text.replace(/\r\n/g, '\n').split('\n') : [];
  const next = lines.map((line) => {
    for (const name of names) {
      if (new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`).test(line)) {
        pending.delete(name);
        return `${name}=${quoteEnvValue(env[name] ?? '')}`;
      }
    }
    return line;
  });
  for (const name of pending) {
    next.push(`${name}=${quoteEnvValue(env[name] ?? '')}`);
  }
  const normalized = next.join('\n').replace(/\n*$/, '\n');
  return normalized;
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isChatGptAuthActive(result: ProviderDoctorResult): boolean {
  if (!result.chatgptAuth) return false;
  return result.chatgptAuth.authMode === 'chatgpt' || (result.chatgptAuth.authMode === 'auto' && result.chatgptAuth.hasAuth && result.secret.currentProcess === 'missing');
}

function resolveExecutableOnPath(name: 'codex', env: NodeJS.ProcessEnv): ProviderDoctorResult['codexBinary'] {
  const pathValue = env.PATH ?? process.env.PATH ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) {
        return { name, onPath: true, path: candidate };
      }
    } catch {
      // Continue scanning PATH.
    }
  }
  return { name, onPath: false };
}
