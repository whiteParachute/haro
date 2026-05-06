import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardWebSocketClient } from '../src/api/ws';
import { ChatContainer } from '../src/components/chat/ChatContainer';
import { ChatPage } from '../src/pages/ChatPage';
import { LAST_CHAT_CONFIG_STORAGE_KEY, useChatStore } from '../src/stores/chat';
import { useSessionsStore } from '../src/stores/sessions';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = WebSocket.CONNECTING;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.emit('close', {}); }
  open(): void { this.readyState = WebSocket.OPEN; this.emit('open', {}); }
  message(data: unknown): void { this.emit('message', { data: JSON.stringify(data) }); }
  private emit(type: string, event: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

describe('FEAT-016 web client and stores', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items: [], total: 0 } }), { headers: { 'content-type': 'application/json' } })));
    FakeWebSocket.instances = [];
    useChatStore.setState({ sessionId: null, status: 'idle', messages: [], error: null, config: {}, ws: null });
    useSessionsStore.setState({ items: [], total: 0, detail: null, events: [], loading: false, error: null });
  });

  afterEach(() => {
    useChatStore.getState().disconnect();
    vi.unstubAllGlobals();
  });

  it('WebSocket client authenticates, restores observed sessions, and exposes exponential backoff', () => {
    storage.setItem('haro:web-api-key', 'secret');
    const client = new DashboardWebSocketClient({ WebSocketImpl: FakeWebSocket as never });
    client.send({ type: 'subscribe', channel: 'sessions', sessionId: 's1' });
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(client.reconnectDelay(0)).toBe(1000);
    expect(client.reconnectDelay(1)).toBe(2000);
    expect(client.reconnectDelay(2)).toBe(4000);
    expect(client.reconnectDelay(10)).toBe(30000);
    expect(socket.sent.map((item) => JSON.parse(item))).toEqual([
      { type: 'authenticate' },
      { type: 'subscribe', channel: 'sessions', sessionId: 's1' },
    ]);
  });

  it('chat store persists last config, handles slash commands, and folds Web Channel deltas [FEAT-031]', async () => {
    // Web Channel routes back the chat surface — fetch is exercised for both
    // the channels probe (GET /api/v1/channels) and the inbound POST flow.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/v1/channels')) {
        return new Response(
          JSON.stringify({ success: true, data: [{ id: 'web', enabled: true }] }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/v1/channels/web/sessions') || url.endsWith('/v1/channels/web/sessions')) {
        return new Response(
          JSON.stringify({ success: true, data: { sessionId: 's1', title: null, ownerUserId: null, createdAt: '', updatedAt: '' } }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ success: true, data: { id: 'm1', sessionId: 's1', role: 'user', content: 'hello', attachments: [], metadata: {}, createdAt: 1 } }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DashboardWebSocketClient({ WebSocketImpl: FakeWebSocket as never });
    useChatStore.getState().connect(client);
    FakeWebSocket.instances[0]!.open();
    await useChatStore
      .getState()
      .sendMessage({ agentId: 'assistant', providerId: 'codex', modelId: 'gpt-test', content: 'hello' });
    expect(JSON.parse(storage.getItem(LAST_CHAT_CONFIG_STORAGE_KEY)!)).toEqual({
      agentId: 'assistant',
      providerId: 'codex',
      modelId: 'gpt-test',
    });
    expect(useChatStore.getState().sessionId).toBe('s1');

    FakeWebSocket.instances[0]!.message({
      type: 'channels.web.event',
      sessionId: 's1',
      event: { kind: 'session.update', sessionId: 's1', status: 'running' },
    });
    FakeWebSocket.instances[0]!.message({
      type: 'channels.web.event',
      sessionId: 's1',
      event: { kind: 'agent', sessionId: 's1', delta: 'hi ' },
    });
    FakeWebSocket.instances[0]!.message({
      type: 'channels.web.event',
      sessionId: 's1',
      event: { kind: 'agent', sessionId: 's1', delta: 'done' },
    });

    expect(useChatStore.getState().status).toBe('running');
    expect(useChatStore.getState().messages.at(-1)?.content).toBe('hi done');

    useChatStore.getState().cancelCurrent();
    expect(JSON.parse(FakeWebSocket.instances[0]!.sent.at(-1)!)).toEqual({ type: 'chat.cancel', sessionId: 's1' });
    expect(useChatStore.getState().status).toBe('cancelled');

    FakeWebSocket.instances[0]!.message({
      type: 'channels.web.event',
      sessionId: 's1',
      event: { kind: 'session.update', sessionId: 's1', status: 'completed' },
    });
    expect(useChatStore.getState().status).toBe('cancelled');

    expect(useChatStore.getState().applySlashCommand('/agent empty')).toBe(true);
    expect(useChatStore.getState().config.agentId).toBe('empty');
  });

  it('chat store enters read-only mode when /api/v1/channels reports web disabled [FEAT-031 AC3]', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: [{ id: 'web', enabled: false }] }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new DashboardWebSocketClient({ WebSocketImpl: FakeWebSocket as never });
    useChatStore.getState().connect(client);
    FakeWebSocket.instances[0]!.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useChatStore.getState().channelEnabled).toBe(false);
    expect(useChatStore.getState().status).toBe('disabled');
  });

  it('sessions store calls REST API and component/page rendering keeps progressive disclosure copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items: [{ sessionId: 's1', agentId: 'assistant', status: 'completed', createdAt: '2026-04-24T00:00:00.000Z' }], total: 1 } }), { headers: { 'content-type': 'application/json' } })));
    await useSessionsStore.getState().loadSessions({ status: 'completed', limit: 20 });
    expect(useSessionsStore.getState().items[0].sessionId).toBe('s1');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/api/v1/sessions?');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('status=completed');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('pageSize=20');

    expect(renderToString(<ChatContainer messages={[]} />)).toContain('历史消息按需加载');
    expect(renderToString(<ChatPage />)).toContain('运行配置');
  });
});
