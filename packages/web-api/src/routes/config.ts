import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { buildHaroPaths, config as haroConfig } from '@haro/core';
import { requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';
import { readChannelSummaries } from './status.js';

const COMMON_FIELD_PATHS = [
  'logging.level',
  'logging.stdout',
  'logging.file',
  'defaultAgent',
  'providers.codex.enabled',
  'providers.codex.secretRef',
  'providers.codex.baseUrl',
  'providers.codex.defaultModel',
  'runtime.taskTimeoutMs',
  'memory.path',
  'evolution.metabolism.shitInterval',
  'evolution.metabolism.shitAutoTrigger',
  'evolution.metabolism.eatAutoTrigger',
] as const;

export function createConfigRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', async (c) => {
    const loaded = loadConfig(runtime);
    const sources = readSourceDetails(runtime, loaded.sources);
    return c.json({
      success: true,
      data: {
        config: loaded.config,
        rawYaml: stringifyYaml(loaded.config),
        sources,
        fieldSources: readFieldSources(runtime, sources),
        channels: await readChannelSummaries(runtime),
      },
    });
  });

  route.get('/sources', (c) => {
    const loaded = loadConfig(runtime);
    const sources = readSourceDetails(runtime, loaded.sources);
    return c.json({
      success: true,
      data: {
        sources,
        fieldSources: readFieldSources(runtime, sources),
      },
    });
  });

  route.put('/', requireWebPermission('config-write'), async (c) => {
    const parsed = await parseConfigPayload(c.req.json.bind(c.req));
    if (!parsed.ok) return c.json({ error: parsed.error, issues: parsed.issues }, 400);

    const validation = validateWithLoader(runtime, parsed.config);
    if (!validation.ok) return c.json({ error: validation.error, issues: validation.issues }, 400);

    const projectConfigPath = projectConfigFile(runtime);
    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(projectConfigPath, stringifyYaml(parsed.config), 'utf8');

    const loaded = loadConfig(runtime);
    const sources = readSourceDetails(runtime, loaded.sources);
    return c.json({
      success: true,
      data: {
        saved: true,
        path: projectConfigPath,
        config: loaded.config,
        sources,
        fieldSources: readFieldSources(runtime, sources),
      },
    });
  });

  return route;
}

function loadConfig(runtime: WebRuntime): haroConfig.LoadedConfig {
  return haroConfig.loadHaroConfig({
    globalRoot: runtime.root,
    projectRoot: projectRoot(runtime),
  });
}

function projectRoot(runtime: WebRuntime): string {
  return runtime.projectRoot ?? process.cwd();
}

function projectConfigFile(runtime: WebRuntime): string {
  return join(projectRoot(runtime), '.haro', 'config.yaml');
}

async function parseConfigPayload(readJson: () => Promise<unknown>): Promise<
  | { ok: true; config: haroConfig.HaroConfig }
  | { ok: false; error: string; issues: haroConfig.ConfigValidationIssue[] }
> {
  let body: unknown;
  try {
    body = await readJson();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON', issues: [{ path: '<root>', message: 'Request body must be valid JSON' }] };
  }
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object', issues: [{ path: '<root>', message: 'Request body must be a JSON object' }] };
  }

  let rawConfig: unknown;
  if ('rawYaml' in body) {
    if (typeof body.rawYaml !== 'string') {
      return { ok: false, error: 'Field rawYaml must be a string', issues: [{ path: 'rawYaml', message: 'Field rawYaml must be a string' }] };
    }
    try {
      rawConfig = parseYaml(body.rawYaml) ?? {};
    } catch (error) {
      return { ok: false, error: 'Invalid YAML', issues: [{ path: 'rawYaml', message: error instanceof Error ? error.message : String(error) }] };
    }
  } else if ('config' in body) {
    rawConfig = body.config;
  } else {
    rawConfig = body;
  }

  try {
    return { ok: true, config: haroConfig.parseHaroConfig('web config request', rawConfig) };
  } catch (error) {
    if (error instanceof haroConfig.HaroConfigValidationError) {
      return { ok: false, error: error.message, issues: error.issues };
    }
    throw error;
  }
}

function validateWithLoader(runtime: WebRuntime, config: haroConfig.HaroConfig):
  | { ok: true }
  | { ok: false; error: string; issues: haroConfig.ConfigValidationIssue[] } {
  const tempRoot = mkdtempSync(join(tmpdir(), 'haro-web-config-'));
  try {
    const tempProjectConfig = join(tempRoot, '.haro', 'config.yaml');
    mkdirSync(dirname(tempProjectConfig), { recursive: true });
    writeFileSync(tempProjectConfig, stringifyYaml(config), 'utf8');
    haroConfig.loadHaroConfig({ globalRoot: runtime.root, projectRoot: tempRoot });
    return { ok: true };
  } catch (error) {
    if (error instanceof haroConfig.HaroConfigValidationError) {
      return { ok: false, error: error.message, issues: error.issues };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), issues: [{ path: '<root>', message: error instanceof Error ? error.message : String(error) }] };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readSourceDetails(runtime: WebRuntime, loadedSources: string[]) {
  const paths = buildHaroPaths(runtime.root);
  const globalConfigPath = paths.configFile;
  const projectPath = projectConfigFile(runtime);
  return [
    { id: 'defaults', label: 'Default values', path: null, present: true, active: loadedSources.includes('defaults') },
    { id: 'global', label: 'Global config', path: globalConfigPath, present: existsSync(globalConfigPath), active: loadedSources.includes(globalConfigPath) },
    { id: 'project', label: 'Project config', path: projectPath, present: existsSync(projectPath), active: loadedSources.includes(projectPath) },
    { id: 'cli', label: 'CLI overrides', path: null, present: loadedSources.includes('cli'), active: loadedSources.includes('cli') },
  ];
}

type SourceDetails = ReturnType<typeof readSourceDetails>;

function readFieldSources(runtime: WebRuntime, sources: SourceDetails): Record<string, { source: string; path?: string; value: unknown }> {
  const globalSource = sources.find((source) => source.id === 'global');
  const projectSource = sources.find((source) => source.id === 'project');
  const globalConfig = readYamlObject(globalSource?.path ?? undefined);
  const projectConfig = readYamlObject(projectSource?.path ?? undefined);
  const loaded = loadConfig(runtime).config as Record<string, unknown>;
  const channelPaths = Object.keys((loaded.channels as Record<string, unknown> | undefined) ?? {}).map((id) => `channels.${id}`);
  const fields = [...COMMON_FIELD_PATHS, ...channelPaths];
  const result: Record<string, { source: string; path?: string; value: unknown }> = {};

  for (const field of fields) {
    if (hasPath(projectConfig, field)) {
      result[field] = { source: 'project', path: projectSource?.path ?? undefined, value: getPath(projectConfig, field) };
    } else if (hasPath(globalConfig, field)) {
      result[field] = { source: 'global', path: globalSource?.path ?? undefined, value: getPath(globalConfig, field) };
    } else {
      result[field] = { source: 'defaults', value: getPath(loaded, field) };
    }
  }
  return result;
}

function readYamlObject(path: string | undefined): Record<string, unknown> {
  if (!path || !existsSync(path)) return {};
  const parsed = parseYaml(readFileSync(path, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
