import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { buildHaroPaths } from '../paths.js';
import { HaroConfig, parseHaroConfig } from './schema.js';

export interface LoadConfigOptions {
  globalRoot?: string;
  projectRoot?: string;
  cliOverrides?: Partial<HaroConfig>;
}

export interface LoadedConfig {
  config: HaroConfig;
  sources: string[];
}

const DEFAULT_CONFIG: HaroConfig = {
  logging: { level: 'info', stdout: true },
  channels: { cli: { enabled: true } },
  evolution: {
    metabolism: {
      shitInterval: '30d',
      shitAutoTrigger: false,
      eatAutoTrigger: false,
    },
  },
};

function readYamlFile(path: string, label: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  try {
    const parsed = parseYaml(text);
    return parsed ?? {};
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${label} YAML at ${path}: ${detail}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function deepMerge<T>(base: T, overlay: unknown): T {
  if (overlay === undefined) return base;
  if (!isPlainObject(overlay)) return overlay as T;
  if (!isPlainObject(base)) {
    return sanitize(overlay) as T;
  }
  const out: Record<string, unknown> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    base as Record<string, unknown>,
  );
  for (const key of Object.keys(overlay)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = deepMerge(out[key], (overlay as Record<string, unknown>)[key]);
  }
  return out as T;
}

function sanitize(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = sanitize(value[key]);
  }
  return out;
}

export function loadHaroConfig(opts: LoadConfigOptions = {}): LoadedConfig {
  const sources: string[] = ['defaults'];
  const globalPaths = buildHaroPaths(opts.globalRoot);
  const globalConfigPath = globalPaths.configFile;
  const projectConfigPath = opts.projectRoot
    ? join(opts.projectRoot, '.haro', 'config.yaml')
    : undefined;

  const rawGlobal = readYamlFile(globalConfigPath, 'global config');
  const globalCfg =
    rawGlobal !== undefined ? parseHaroConfig(globalConfigPath, rawGlobal) : undefined;
  if (globalCfg) sources.push(globalConfigPath);

  const rawProject =
    projectConfigPath !== undefined ? readYamlFile(projectConfigPath, 'project config') : undefined;
  const projectCfg =
    rawProject !== undefined ? parseHaroConfig(projectConfigPath!, rawProject) : undefined;
  if (projectCfg) sources.push(projectConfigPath!);

  let merged: HaroConfig = deepMerge(DEFAULT_CONFIG, globalCfg ?? {});
  merged = deepMerge(merged, projectCfg ?? {});
  if (opts.cliOverrides) {
    merged = deepMerge(merged, opts.cliOverrides);
    sources.push('cli');
  }

  return { config: merged, sources };
}
