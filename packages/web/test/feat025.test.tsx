import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderStats, listProviderFallbacks, listSessionEvents } from '../src/api/client';
import { DashboardWebSocketClient } from '../src/api/ws';
import { EventFilterBar } from '../src/components/logs/EventFilterBar';
import { EventTable } from '../src/components/logs/EventTable';
import { LiveSessionMonitor } from '../src/components/monitor/LiveSessionMonitor';
import { ProviderStatsTable } from '../src/components/monitor/ProviderStatsTable';
import { InvokeAgentPage } from '../src/pages/InvokeAgentPage';
import { LogsPage } from '../src/pages/LogsPage';
import { MonitorPage } from '../src/pages/MonitorPage';
import type { LogSessionEventRecord, ProviderStatsResponse } from '../src/types';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.emit('close', {}); }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.emit('open', {}); }
  message(data: unknown): void { this.emit('message', { data: JSON.stringify(data) }); }
  private emit(type: string, event: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const providerStats: ProviderStatsResponse = {
  generatedAt: '2026-04-26T00:00:00.000Z',
  windows: {
    '24h': [{ provider: 'codex', model: 'gpt-a', callCount: 2, successCount: 1, failureCount: 1, fallbackCount: 3, avgLatencyMs: 200, inputTokens: 10, outputTokens: 5, estimatedCost: 0.01 }],
    '7d': [{ provider: 'codex', model: 'gpt-a', callCount: 3, successCount: 2, failureCount: 1, fallbackCount: 3, avgLatencyMs: 300, inputTokens: 30, outputTokens: 15, estimatedCost: 0.03 }],
    all: [{ provider: 'codex', model: 'gpt-a', callCount: 4, successCount: 3, failureCount: 1, fallbackCount: 3, avgLatencyMs: 400, inputTokens: 70, outputTokens: 35, estimatedCost: 0.07 }],
  },
};

describe('FEAT-025 runtime logs and provider monitoring UI', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls logs and provider stats REST contracts with filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/logs/session-events')) return jsonResponse({ success: true, data: { items: [eventFixture], limit: 50 } });
      if (url.includes('/api/v1/logs/provider-fallbacks')) return jsonResponse({ success: true, data: { items: [fallbackFixture], limit: 50 } });
      if (url.endsWith('/api/v1/providers/stats')) return jsonResponse({ success: true, data: providerStats });
      return jsonResponse({ error: 'unexpected' }, { status: 404 });
    }));

    await listSessionEvents({ sessionId: 's1', eventType: 'result', from: '2026-04-26T00:00', to: '2026-04-26T23:59', limit: 50 });
    await listProviderFallbacks({ sessionId: 's1', limit: 50 });
    await getProviderStats();

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/logs/session-events?sessionId=s1&eventType=result&from=2026-04-26T00%3A00&to=2026-04-26T23%3A59&limit=50',
      '/api/v1/logs/provider-fallbacks?sessionId=s1&limit=50',
      '/api/v1/providers/stats',
    ]);
  });

  it('renders filter bar, event table formatted JSON and fallback/provider stats pages without marketing hero copy', () => {
    const filterHtml = renderToString(<EventFilterBar filters={{ sessionId: 's1', eventType: 'result' }} onChange={() => undefined} onApply={() => undefined} />);
    const eventHtml = renderToString(<EventTable events={[eventFixture]} />);
    const statsHtml = renderToString(<ProviderStatsTable windows={providerStats.windows} />);
    const logsHtml = renderToString(<LogsPage />);
    const invokeHtml = renderToString(<InvokeAgentPage />);

    expect(filterHtml).toContain('sessionId');
    expect(filterHtml).toContain('eventType');
    expect(eventHtml).toContain('payload JSON');
    expect(eventHtml).toContain('&quot;keep&quot;: true');
    expect(statsHtml).toContain('Provider stats · 24h');
    expect(statsHtml).toContain('Provider stats · 7d');
    expect(statsHtml).toContain('Provider stats · all');
    expect(statsHtml).toContain('200 ms');
    expect(statsHtml).toContain('10 in / 5 out');
    expect(logsHtml).not.toContain('hero');
    expect(invokeHtml).not.toContain('hero');
  });

  it('restores system and sessions subscriptions after reconnect', () => {
    const timers: Array<() => void> = [];
    const client = new DashboardWebSocketClient({
      WebSocketImpl: FakeWebSocket as never,
      setTimeoutFn: ((fn: () => void) => { timers.push(fn); return timers.length as never; }) as never,
      clearTimeoutFn: (() => undefined) as never,
    });
    client.connect();
    client.send({ type: 'subscribe', channel: 'system' });
    client.send({ type: 'subscribe', channel: 'sessions' });
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: 'session.update', sessionId: 's1', status: 'running' });
    first.close();
    timers.shift()?.();
    const second = FakeWebSocket.instances[1]!;
    second.open();

    expect(second.sent.map((item) => JSON.parse(item))).toEqual([
      { type: 'authenticate' },
      { type: 'subscribe', channel: 'system' },
      { type: 'subscribe', channel: 'sessions' },
      { type: 'subscribe', channel: 'sessions', sessionId: 's1' },
    ]);
  });

  it('renders LiveSessionMonitor and MonitorPage read-only provider alerts', () => {
    const monitorHtml = renderToString(<LiveSessionMonitor connected sessions={[{ sessionId: 's1', status: 'running', updatedAt: 'now' }]} activeSessions={1} gatewayConnected={false} uptimeSeconds={10} />);
    const pageHtml = renderToString(<MonitorPage />);

    expect(monitorHtml).toContain('s1');
    expect(monitorHtml).toContain('active sessions');
    expect(pageHtml).toContain('Runtime Monitor');
    expect(pageHtml).toContain('不会自动切换 provider');
    expect(pageHtml).not.toContain('修改 provider selection rules</button>');
  });
});

const eventFixture: LogSessionEventRecord = {
  id: 1,
  sessionId: 's1',
  agentId: 'assistant',
  provider: 'codex',
  model: 'gpt-a',
  eventType: 'result',
  payload: { type: 'result', nested: { keep: true } },
  latencyMs: 42,
  createdAt: '2026-04-26T00:00:00.000Z',
};

const fallbackFixture = {
  id: 1,
  sessionId: 's1',
  originalProvider: 'codex',
  originalModel: 'gpt-a',
  fallbackProvider: 'codex',
  fallbackModel: 'gpt-b',
  trigger: 'rate_limit',
  ruleId: 'rule-a',
  createdAt: '2026-04-26T00:00:01.000Z',
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}
