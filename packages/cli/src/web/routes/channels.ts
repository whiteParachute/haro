import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { buildHaroPaths, config as haroConfig } from '@haro/core';
import type { ChannelRegistryEntry, ChannelSetupContext } from '@haro/channel';
import { stringify as stringifyYaml } from 'yaml';
import { requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export interface ChannelSummary {
  id: string;
  displayName: string;
  enabled: boolean;
  removable: boolean;
  source: 'preinstalled' | 'user' | 'config';
  capabilities: ReturnType<ChannelRegistryEntry['channel']['capabilities']>;
  health: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
  lastCheckedAt: string;
  configSource: string;
  config: Record<string, unknown>;
  error?: string;
}

export function createChannelsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', async (c) => c.json({ success: true, data: await listChannelSummaries(runtime) }));

  route.post('/:id/enable', requireWebPermission('config-write'), async (c) => {
    const entry = getChannelEntry(runtime, c.req.param('id'));
    if (!entry.ok) return c.json({ error: entry.error }, entry.status);
    runtime.channelRegistry!.enable(entry.value.id);
    await updateChannelConfig(runtime, entry.value.id, { enabled: true });
    return c.json({ success: true, data: await summarizeChannel(runtime, entry.value) });
  });

  route.post('/:id/disable', requireWebPermission('config-write'), async (c) => {
    const entry = getChannelEntry(runtime, c.req.param('id'));
    if (!entry.ok) return c.json({ error: entry.error }, entry.status);
    await entry.value.channel.stop();
    runtime.channelRegistry!.disable(entry.value.id);
    await updateChannelConfig(runtime, entry.value.id, { enabled: false });
    return c.json({ success: true, data: await summarizeChannel(runtime, entry.value) });
  });

  route.delete('/:id', requireWebPermission('config-write'), async (c) => {
    const entry = getChannelEntry(runtime, c.req.param('id'));
    if (!entry.ok) return c.json({ error: entry.error }, entry.status);
    try {
      await entry.value.channel.stop();
      runtime.channelRegistry!.remove(entry.value.id);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    await removeChannelConfig(runtime, entry.value.id);
    await rm(join(buildHaroPaths(runtime.root).dirs.channels, entry.value.id), { recursive: true, force: true });
    return c.json({ success: true, data: { id: entry.value.id, deleted: true } });
  });

  route.get('/:id/doctor', async (c) => {
    const entry = getChannelEntry(runtime, c.req.param('id'));
    if (!entry.ok) return c.json({ error: entry.error }, entry.status);
    const context = createChannelSetupContext(runtime, entry.value.id);
    const report = typeof entry.value.channel.doctor === 'function'
      ? await entry.value.channel.doctor(context)
      : await fallbackChannelDoctor(entry.value);
    return c.json({ success: true, data: report });
  });

  route.post('/:id/setup', requireWebPermission('config-write'), async (c) => {
    const entry = getChannelEntry(runtime, c.req.param('id'));
    if (!entry.ok) return c.json({ error: entry.error }, entry.status);
    if (typeof entry.value.channel.setup !== 'function') {
      return c.json({ error: `Channel '${entry.value.id}' does not provide setup()` }, 400);
    }
    const result = await entry.value.channel.setup(createChannelSetupContext(runtime, entry.value.id));
    if (!result.ok) return c.json({ success: false, data: result, error: result.message }, 400);
    await updateChannelConfig(runtime, entry.value.id, { ...result.config, enabled: true });
    runtime.channelRegistry!.enable(entry.value.id);
    return c.json({ success: true, data: result });
  });

  return route;
}

async function listChannelSummaries(runtime: WebRuntime): Promise<ChannelSummary[]> {
  const registered = await Promise.all(
    (runtime.channelRegistry?.list() ?? []).map((entry) => summarizeChannel(runtime, entry)),
  );
  return registered.sort((left, right) => left.id.localeCompare(right.id));
}

async function summarizeChannel(runtime: WebRuntime, entry: ChannelRegistryEntry): Promise<ChannelSummary> {
  const checkedAt = new Date().toISOString();
  const config = readChannelConfig(ensureLoadedConfig(runtime).config, entry.id);
  const base = {
    id: entry.id,
    displayName: entry.displayName,
    enabled: entry.enabled,
    removable: entry.removable,
    source: entry.source === 'builtin' ? 'preinstalled' : 'user',
    capabilities: entry.channel.capabilities(),
    lastCheckedAt: checkedAt,
    configSource: resolveConfigSource(runtime),
    config,
  } satisfies Omit<ChannelSummary, 'health' | 'error'>;

  if (!entry.enabled) return { ...base, health: 'disabled' };
  try {
    const healthy = await entry.channel.healthCheck();
    return { ...base, health: healthy ? 'healthy' : 'unhealthy' };
  } catch (error) {
    return {
      ...base,
      health: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getChannelEntry(
  runtime: WebRuntime,
  id: string,
): { ok: true; value: ChannelRegistryEntry } | { ok: false; status: 404; error: string } {
  if (!runtime.channelRegistry?.has(id)) {
    return { ok: false, status: 404, error: `Channel '${id}' not found` };
  }
  return { ok: true, value: runtime.channelRegistry.getEntry(id) };
}

function ensureLoadedConfig(runtime: WebRuntime): haroConfig.LoadedConfig {
  runtime.loaded ??= haroConfig.loadHaroConfig({
    globalRoot: runtime.root,
    projectRoot: runtime.projectRoot ?? process.cwd(),
  });
  return runtime.loaded;
}

function readChannelConfig(config: { channels?: haroConfig.HaroConfig['channels'] }, id: string): Record<string, unknown> {
  const channels = (config.channels ?? {}) as Record<string, unknown>;
  const value = channels[id];
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

async function updateChannelConfig(runtime: WebRuntime, id: string, patch: Record<string, unknown>): Promise<void> {
  const loaded = ensureLoadedConfig(runtime);
  const channels = ((loaded.config.channels ??= {}) as Record<string, unknown>);
  channels[id] = { ...readChannelConfig(loaded.config, id), ...patch };
  await persistLoadedConfig(runtime);
}

async function removeChannelConfig(runtime: WebRuntime, id: string): Promise<void> {
  const channels = ensureLoadedConfig(runtime).config.channels as Record<string, unknown> | undefined;
  if (channels && id in channels) delete channels[id];
  await persistLoadedConfig(runtime);
}

async function persistLoadedConfig(runtime: WebRuntime): Promise<void> {
  const file = buildHaroPaths(runtime.root).configFile;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, stringifyYaml(ensureLoadedConfig(runtime).config), 'utf8');
  if (!ensureLoadedConfig(runtime).sources.includes(file)) ensureLoadedConfig(runtime).sources.push(file);
}

function resolveConfigSource(runtime: WebRuntime): string {
  const sources = ensureLoadedConfig(runtime).sources;
  return sources.at(-1) ?? 'defaults';
}

function createChannelSetupContext(runtime: WebRuntime, id: string): ChannelSetupContext {
  const paths = buildHaroPaths(runtime.root);
  return {
    root: paths.root,
    config: readChannelConfig(ensureLoadedConfig(runtime).config, id),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    logger: runtime.logger,
  };
}

async function fallbackChannelDoctor(entry: ChannelRegistryEntry) {
  const ok = await entry.channel.healthCheck();
  return { ok, message: ok ? 'healthy' : 'unhealthy' };
}
