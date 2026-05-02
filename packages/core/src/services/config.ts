/**
 * Config get/set/unset by dot-path (FEAT-039 R10).
 *
 * Both CLI (`haro config set/get/unset`) and Web API config write share
 * the same patch helpers. Secret-bearing paths (e.g. `providers.*.apiKey`)
 * are unconditionally rejected — secrets must come from environment or
 * `secretRef`-style indirection, never plain YAML.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadHaroConfig, parseHaroConfig, HaroConfigValidationError } from '../config/index.js';
import type { HaroConfig, LoadedConfig, ConfigValidationIssue } from '../config/index.js';
import { buildHaroPaths } from '../paths.js';
import { HaroError } from '../errors/index.js';
import type { ServiceContext } from './types.js';

export type ConfigScope = 'global' | 'project';

/**
 * Path patterns that must never live in YAML. Each pattern is matched
 * literally as a dot-path prefix or with `*` wildcards — see
 * `isSecretPath`.
 */
export const SECRET_PATH_PATTERNS: readonly string[] = [
  'providers.*.apiKey',
  'providers.*.token',
  'providers.*.password',
  'providers.*.secret',
  'channels.*.apiKey',
  'channels.*.token',
  'channels.*.appSecret',
  'channels.*.botToken',
  'channels.*.password',
];

export interface ConfigGetResult {
  key: string;
  value: unknown;
  source: 'project' | 'global' | 'defaults' | 'absent';
  path?: string;
}

export interface ConfigSetResult {
  key: string;
  value: unknown;
  scope: ConfigScope;
  path: string;
}

export interface ConfigUnsetResult {
  key: string;
  scope: ConfigScope;
  path: string;
  removed: boolean;
}

export function getConfigValue(ctx: ServiceContext, key: string): ConfigGetResult {
  const loaded = loadConfig(ctx);
  const paths = scopePaths(ctx);

  // Source resolution: project > global > defaults
  if (existsSync(paths.project)) {
    const projectYaml = readYamlObject(paths.project);
    if (hasPath(projectYaml, key)) {
      return { key, value: getPath(projectYaml, key), source: 'project', path: paths.project };
    }
  }
  if (existsSync(paths.global)) {
    const globalYaml = readYamlObject(paths.global);
    if (hasPath(globalYaml, key)) {
      return { key, value: getPath(globalYaml, key), source: 'global', path: paths.global };
    }
  }
  const merged = loaded.config as unknown as Record<string, unknown>;
  if (hasPath(merged, key)) {
    return { key, value: getPath(merged, key), source: 'defaults' };
  }
  return { key, value: undefined, source: 'absent' };
}

export function setConfigValue(
  ctx: ServiceContext,
  key: string,
  value: unknown,
  scope: ConfigScope,
): ConfigSetResult {
  // Reject the key itself AND any nested key the value would introduce —
  // otherwise `set channels.feishu '{"appSecret":"..."}'` slips secrets
  // past the leaf-only check (Codex adversarial review 2026-05-02 high).
  assertNoSecretPaths(key, value);
  const target = scopePaths(ctx)[scope];
  const yaml = readYamlObject(target);
  setPath(yaml, key, value);
  validatePatched(ctx, scope, yaml);
  writeYamlFile(target, yaml);
  return { key, value, scope, path: target };
}

/**
 * Walk `value` and reject if any effective dot-path (the key itself, or
 * `${key}.${child}` for any nested child) matches a secret pattern.
 */
function assertNoSecretPaths(key: string, value: unknown): void {
  const offenders: string[] = [];
  walkPaths(key, value, (effectivePath) => {
    if (isSecretPath(effectivePath)) offenders.push(effectivePath);
  });
  if (offenders.length === 0) return;
  throw new HaroError(
    'CONFIG_SECRET_REJECTED',
    offenders.length === 1
      ? `Refusing to write secret-bearing path '${offenders[0]}' to YAML`
      : `Refusing to write secret-bearing paths to YAML: ${offenders.join(', ')}`,
    {
      remediation:
        'Secret values must come from environment variables or a secretRef. Use `haro provider setup` for provider credentials.',
      details: { offenders },
    },
  );
}

function walkPaths(prefix: string, value: unknown, visit: (path: string) => void): void {
  visit(prefix);
  if (!isRecord(value)) return;
  for (const [child, nested] of Object.entries(value)) {
    walkPaths(`${prefix}.${child}`, nested, visit);
  }
}

export function unsetConfigValue(ctx: ServiceContext, key: string, scope: ConfigScope): ConfigUnsetResult {
  const target = scopePaths(ctx)[scope];
  if (!existsSync(target)) {
    return { key, scope, path: target, removed: false };
  }
  const yaml = readYamlObject(target);
  const removed = deletePath(yaml, key);
  if (removed) {
    validatePatched(ctx, scope, yaml);
    writeYamlFile(target, yaml);
  }
  return { key, scope, path: target, removed };
}

export function isSecretPath(key: string): boolean {
  const segments = key.split('.');
  return SECRET_PATH_PATTERNS.some((pattern) => matchSegments(segments, pattern.split('.')));
}

function matchSegments(actual: readonly string[], pattern: readonly string[]): boolean {
  if (actual.length !== pattern.length) return false;
  return actual.every((segment, idx) => pattern[idx] === '*' || pattern[idx] === segment);
}

function loadConfig(ctx: ServiceContext): LoadedConfig {
  return loadHaroConfig({
    ...(ctx.root ? { globalRoot: ctx.root } : {}),
    ...(ctx.projectRoot ? { projectRoot: ctx.projectRoot } : { projectRoot: process.cwd() }),
  });
}

function scopePaths(ctx: ServiceContext): Record<ConfigScope, string> {
  const paths = buildHaroPaths(ctx.root);
  const projectRoot = ctx.projectRoot ?? process.cwd();
  return {
    global: paths.configFile,
    project: join(projectRoot, '.haro', 'config.yaml'),
  };
}

function readYamlObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = parseYaml(readFileSync(path, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function writeYamlFile(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(value), 'utf8');
}

function validatePatched(ctx: ServiceContext, scope: ConfigScope, patched: Record<string, unknown>): void {
  const merged = loadConfig(ctx).config as unknown as Record<string, unknown>;
  const candidate = scope === 'project'
    ? deepMerge(merged, patched)
    : deepMerge(patched, readYamlObject(scopePaths(ctx).project));
  try {
    parseHaroConfig(`config ${scope} write`, candidate);
  } catch (error) {
    if (error instanceof HaroConfigValidationError) {
      throw new HaroError('CONFIG_INVALID', error.message, {
        details: { issues: error.issues as unknown as Record<string, unknown>[] },
        remediation: 'Fix the listed issues and retry',
      });
    }
    throw error;
  }
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (isRecord(v) && isRecord(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function hasPath(value: Record<string, unknown>, path: string): boolean {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function getPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function deletePath(target: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (!isRecord(cursor[key])) return false;
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts.at(-1)!;
  if (!(last in cursor)) return false;
  delete cursor[last];
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { HaroConfig, LoadedConfig, ConfigValidationIssue };
