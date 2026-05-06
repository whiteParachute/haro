import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelRegistry, type ChannelLogger } from '@haro/channel';
import { WebChannel } from '@haro/channel-web';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

const channelLogger: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface Harness {
  app: ReturnType<typeof createWebApp>;
  channel: WebChannel;
  registry: ChannelRegistry;
  root: string;
  inboundCount: { current: number };
}

describe('web channel REST [FEAT-031]', () => {
  const roots: string[] = [];
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.HARO_WEB_API_KEY;
    delete process.env.HARO_WEB_API_KEY;
  });

  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
    if (originalApiKey === undefined) delete process.env.HARO_WEB_API_KEY;
    else process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  async function setup({ enabled = true }: { enabled?: boolean } = {}): Promise<Harness> {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-channel-route-'));
    roots.push(root);
    const channel = new WebChannel({
      root,
      logger: channelLogger,
      createSessionId: makeCounter('s'),
      createMessageId: makeCounter('m'),
      createFileId: makeCounter('f'),
    });
    const registry = new ChannelRegistry();
    registry.register({
      channel,
      enabled,
      removable: true,
      source: 'builtin',
      displayName: 'Web',
    });
    const inboundCount = { current: 0 };
    if (enabled) {
      await channel.start({
        config: { enabled: true },
        logger: channelLogger,
        onInbound: async () => {
          inboundCount.current += 1;
        },
      });
    }
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { root, projectRoot: root, channelRegistry: registry },
    });
    return { app, channel, registry, root, inboundCount };
  }

  it('creates a session via POST /sessions and lists it', async () => {
    const { app } = await setup();
    const create = await app.request('/api/v1/channels/web/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { sessionId: string } };
    expect(created.data.sessionId).toBe('s-1');

    const list = await app.request('/api/v1/channels/web/sessions');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { items: Array<{ sessionId: string }> } };
    expect(body.data.items.map((s) => s.sessionId)).toEqual(['s-1']);
  });

  it('round-trips an inbound message + history fetch [AC1]', async () => {
    const { app, inboundCount } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };
    const sessionId = create.data.sessionId;

    const send = await app.request(`/api/v1/channels/web/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello world' }),
    });
    expect(send.status).toBe(201);
    expect(inboundCount.current).toBe(1);

    const history = await (
      await app.request(`/api/v1/channels/web/sessions/${sessionId}/messages?limit=10`)
    ).json() as { data: { items: Array<{ content: unknown; role: string }> } };
    expect(history.data.items).toHaveLength(1);
    expect(history.data.items[0]!.content).toBe('hello world');
    expect(history.data.items[0]!.role).toBe('user');
  });

  it('serves history when disabled but blocks writes [AC3]', async () => {
    // Seed a session + message before disabling.
    const { app, channel, registry } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };
    await app.request(`/api/v1/channels/web/sessions/${create.data.sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });

    await channel.stop();
    registry.disable('web');

    // Read-only routes still work (history, listing) so the Dashboard can
    // show prior conversations.
    const list = await app.request('/api/v1/channels/web/sessions');
    expect(list.status).toBe(200);
    const history = await app.request(
      `/api/v1/channels/web/sessions/${create.data.sessionId}/messages`,
    );
    expect(history.status).toBe(200);

    // Write routes return 503 with the disabled code.
    const send = await app.request('/api/v1/channels/web/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(send.status).toBe(503);
    const body = (await send.json()) as { code: string };
    expect(body.code).toBe('WEB_CHANNEL_DISABLED');
  });

  it('rejects an oversized image upload with 413 [AC2]', async () => {
    const { app } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };
    const sessionId = create.data.sessionId;

    const form = new FormData();
    form.set('sessionId', sessionId);
    const oversize = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'image/png' });
    form.set('file', oversize, 'photo.png');
    const upload = await app.request('/api/v1/channels/web/upload', { method: 'POST', body: form });
    expect(upload.status).toBe(413);
    const body = (await upload.json()) as { code: string };
    expect(body.code).toBe('too_large');
  });

  it('rejects a path-traversal filename with 400 [AC5]', async () => {
    const { app } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };

    const form = new FormData();
    form.set('sessionId', create.data.sessionId);
    form.set('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), '../../etc/passwd');
    const upload = await app.request('/api/v1/channels/web/upload', { method: 'POST', body: form });
    expect(upload.status).toBe(400);
    const body = (await upload.json()) as { code: string };
    expect(body.code).toBe('forbidden_path_segment');
  });

  it('uploads a small file then downloads it [R5/R6]', async () => {
    const { app } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };
    const sessionId = create.data.sessionId;

    const form = new FormData();
    form.set('sessionId', sessionId);
    form.set('file', new Blob([Buffer.from('payload')], { type: 'text/plain' }), 'note.txt');
    const upload = await app.request('/api/v1/channels/web/upload', { method: 'POST', body: form });
    expect(upload.status).toBe(201);
    const uploadBody = (await upload.json()) as { data: { id: string; filename: string } };
    expect(uploadBody.data.filename).toBe('note.txt');

    const download = await app.request(`/api/v1/channels/web/files/${uploadBody.data.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('payload');
  });

  it('paginates 100 messages by 50 without duplication [AC6]', async () => {
    const { app } = await setup();
    const create = await (
      await app.request('/api/v1/channels/web/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).json() as { data: { sessionId: string } };
    const sessionId = create.data.sessionId;

    for (let i = 0; i < 100; i += 1) {
      await app.request(`/api/v1/channels/web/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `msg-${i.toString().padStart(3, '0')}` }),
      });
    }

    const page1 = (await (
      await app.request(`/api/v1/channels/web/sessions/${sessionId}/messages?limit=50`)
    ).json()) as { data: { items: Array<{ id: string }>; nextCursor: number | null } };
    expect(page1.data.items).toHaveLength(50);
    expect(page1.data.nextCursor).not.toBeNull();
    const firstIds = new Set(page1.data.items.map((m) => m.id));

    const page2Url = `/api/v1/channels/web/sessions/${sessionId}/messages?limit=50&before=${page1.data.nextCursor}`;
    const page2 = (await (await app.request(page2Url)).json()) as {
      data: { items: Array<{ id: string }>; nextCursor: number | null };
    };
    expect(page2.data.items).toHaveLength(50);
    for (const m of page2.data.items) expect(firstIds.has(m.id)).toBe(false);
    expect(page2.data.nextCursor).toBeNull();
  });
});

function makeCounter(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
