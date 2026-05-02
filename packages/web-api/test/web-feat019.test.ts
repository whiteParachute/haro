import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelRegistry, type ManagedChannel, type OutboundMessage } from '@haro/channel';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function createChannelRegistry(health = true): ChannelRegistry {
  const registry = new ChannelRegistry();
  registry.register({
    channel: new FakeChannel('feishu', health),
    enabled: false,
    removable: true,
    source: 'package',
    displayName: 'Feishu',
  });
  return registry;
}

class FakeChannel implements ManagedChannel {
  constructor(readonly id: string, private readonly healthy: boolean) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_sessionId: string, _msg: OutboundMessage): Promise<void> {}
  capabilities() {
    return {
      streaming: true,
      richText: true,
      attachments: false,
      threading: true,
      requiresWebhook: true,
    };
  }
  async healthCheck(): Promise<boolean> { return this.healthy; }
  async doctor() { return { ok: this.healthy, message: this.healthy ? 'healthy' : 'unhealthy' }; }
  async setup() { return { ok: true, config: { tokenRef: 'env:FEISHU_TOKEN' }, message: 'setup ok' }; }
}

describe('web dashboard channel and agent management REST [FEAT-019]', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function tempRoot(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it('implements Agent YAML CRUD, validation, id mismatch, and defaultAgent delete guard', async () => {
    const root = tempRoot('haro-feat019-agents-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, projectRoot: root } });
    const yaml = 'id: web-agent\nname: Web Agent\nsystemPrompt: |\n  First paragraph for summary.\ntools: []\n';

    const createResponse = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml }),
    });
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).data.id).toBe('web-agent');

    const list = await (await app.request('/api/v1/agents')).json();
    expect(list.data[0]).toMatchObject({ id: 'web-agent', summary: 'First paragraph for summary.' });
    expect(list.data[0]).not.toHaveProperty('description');
    expect(list.data[0]).not.toHaveProperty('type');

    const yamlResponse = await (await app.request('/api/v1/agents/web-agent/yaml')).json();
    expect(yamlResponse.data.yaml).toContain('id: web-agent');
    expect(yamlResponse.data.updatedAt).toEqual(expect.any(String));

    const unknownField = await app.request('/api/v1/agents/web-agent/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: `${yaml}description: no\n` }),
    });
    const unknownBody = await unknownField.json();
    expect(unknownField.status).toBe(200);
    expect(unknownBody.data).toMatchObject({ ok: false });
    expect(unknownBody.data.issues[0]).toMatchObject({ code: 'unknown-field' });

    const mismatch = await app.request('/api/v1/agents/web-agent/yaml', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: yaml.replace('id: web-agent', 'id: other-agent') }),
    });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).issues[0]).toMatchObject({ code: 'id-mismatch' });

    expect((await app.request('/api/v1/agents/haro-assistant', { method: 'DELETE' })).status).toBe(400);
    expect((await app.request('/api/v1/agents/web-agent', { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/v1/agents/web-agent')).status).toBe(404);
  });

  it('implements Channel lifecycle endpoints and persists channel config', async () => {
    const root = tempRoot('haro-feat019-channels-');
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { root, projectRoot: root, channelRegistry: createChannelRegistry() },
    });

    const listResponse = await app.request('/api/v1/channels');
    const list = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(list.data[0]).toMatchObject({ id: 'feishu', enabled: false, health: 'disabled' });
    expect(list.data[0].capabilities.streaming).toBe(true);

    const enabled = await (await app.request('/api/v1/channels/feishu/enable', { method: 'POST' })).json();
    expect(enabled.data).toMatchObject({ id: 'feishu', enabled: true, health: 'healthy' });
    expect(readFileSync(join(root, 'config.yaml'), 'utf8')).toContain('enabled: true');

    const doctor = await (await app.request('/api/v1/channels/feishu/doctor')).json();
    expect(doctor.data).toEqual({ ok: true, message: 'healthy' });

    const setup = await (await app.request('/api/v1/channels/feishu/setup', { method: 'POST' })).json();
    expect(setup.data).toMatchObject({ ok: true, message: 'setup ok' });
    expect(readFileSync(join(root, 'config.yaml'), 'utf8')).toContain('tokenRef');

    expect((await app.request('/api/v1/channels/feishu', { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/v1/channels/feishu/doctor')).status).toBe(404);
  });

  it('implements Gateway status, doctor, stop, and logs endpoints without spawning by default', async () => {
    const root = tempRoot('haro-feat019-gateway-');
    const logFile = join(root, 'logs', 'gateway.log');
    mkdirSync(join(root, 'logs'), { recursive: true });
    writeFileSync(logFile, '2026-04-25T00:00:00.000Z boot\n2026-04-25T00:00:01.000Z ready\n', 'utf8');
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { root, projectRoot: root, channelRegistry: createChannelRegistry() },
    });

    const status = await (await app.request('/api/v1/gateway')).json();
    expect(status.data).toMatchObject({ status: 'stopped', running: false, connectedChannelCount: 0 });

    await app.request('/api/v1/channels/feishu/enable', { method: 'POST' });
    const doctor = await (await app.request('/api/v1/gateway/doctor')).json();
    expect(doctor.data).toMatchObject({ ok: true, gateway: { running: false } });
    expect(doctor.data.channels[0]).toEqual({ id: 'feishu', healthy: true });

    const logs = await (await app.request('/api/v1/gateway/logs?lines=1')).json();
    expect(logs.data.lines).toEqual(['2026-04-25T00:00:01.000Z ready']);
    expect((await app.request('/api/v1/gateway/stop', { method: 'POST' })).status).toBe(200);
    expect(existsSync(join(root, 'gateway.pid'))).toBe(false);
  });
});
