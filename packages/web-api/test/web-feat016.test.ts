import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry, db as haroDb, type AgentConfig, type AgentEvent, type RunAgentInput, type RunAgentResult } from '@haro/core';
import { createWebApp } from '../src/index.js';
import { startWebServer } from '../src/server.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function createRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({
    id: 'assistant',
    name: 'Assistant',
    systemPrompt: '  First paragraph with   extra whitespace.\n\nSecond paragraph should not appear.',
    tools: ['shell'],
    defaultProvider: 'codex',
    defaultModel: 'gpt-test',
  });
  registry.register({ id: 'empty', name: 'Empty', systemPrompt: '   ' });
  return registry;
}

function createRunner(sessionId = 'session-run-1') {
  return {
    run: async (input: RunAgentInput): Promise<RunAgentResult> => {
      const events: AgentEvent[] = [
        { type: 'text', content: 'hello ', delta: true },
        { type: 'tool_call', callId: 'call-1', toolName: 'shell', toolInput: { cmd: 'echo ok' } },
        { type: 'tool_result', callId: 'call-1', result: { ok: true } },
        { type: 'result', content: 'done', responseId: 'resp-1' },
      ];
      for (const event of events) input.onEvent?.(event, sessionId);
      return { sessionId, ruleId: 'test', provider: input.provider ?? 'codex', model: input.model ?? 'gpt-test', events, finalEvent: events[3] as Extract<AgentEvent, { type: 'result' }> };
    },
  };
}

describe('web dashboard agent interaction REST [FEAT-016]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const originalAllowDelete = process.env.HARO_WEB_ALLOW_SESSION_DELETE;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    if (originalAllowDelete === undefined) delete process.env.HARO_WEB_ALLOW_SESSION_DELETE;
    else process.env.HARO_WEB_ALLOW_SESSION_DELETE = originalAllowDelete;
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns Agent read-model summaries and details without description/type', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-feat016-'));
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { agentRegistry: createRegistry(), runner: createRunner() as never, root, projectRoot: root },
    });

    const listResponse = await app.request('/api/v1/agents');
    const list = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(list.data[0]).toEqual({
      id: 'assistant',
      name: 'Assistant',
      summary: 'First paragraph with extra whitespace.',
      defaultProvider: 'codex',
      defaultModel: 'gpt-test',
    });
    expect(list.data[0]).not.toHaveProperty('description');
    expect(list.data[0]).not.toHaveProperty('type');
    expect(list.data[1].summary).toBe('Empty');

    const detailResponse = await app.request('/api/v1/agents/assistant');
    const detail = await detailResponse.json();
    expect(detail.data.systemPrompt).toContain('Second paragraph');
    expect(detail.data.tools).toEqual(['shell']);
    expect(detail.data).not.toHaveProperty('description');
    expect(detail.data).not.toHaveProperty('type');
  });

  it('enforces auth and strict run/chat request bodies', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    const app = createWebApp({ logger: createMockLogger(), runtime: { agentRegistry: createRegistry(), runner: createRunner() as never } });

    expect((await app.request('/api/v1/agents')).status).toBe(401);

    const unknownRun = await app.request('/api/v1/agents/assistant/run', {
      method: 'POST',
      headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'hi', unknown: true }),
    });
    expect(unknownRun.status).toBe(400);
    expect(await unknownRun.json()).toEqual({ error: "Unknown field 'unknown'" });

    const okRun = await app.request('/api/v1/agents/assistant/run', {
      method: 'POST',
      headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'hi' }),
    });
    expect(okRun.status).toBe(200);
    expect((await okRun.json()).data.sessionId).toEqual(expect.any(String));
  });

  it('lists session history, returns events, and deletes session events when explicitly enabled', async () => {
    delete process.env.HARO_WEB_API_KEY;
    process.env.HARO_WEB_ALLOW_SESSION_DELETE = 'true';
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat016-'));
    tempRoots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('s1', 'assistant', 'codex', 'gpt-test', '2026-04-24T00:00:00.000Z', 'completed');
    db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`).run('s1', 'text', JSON.stringify({ type: 'text', content: 'hi', delta: true }), '2026-04-24T00:00:01.000Z');
    db.close();

    const app = createWebApp({ logger: createMockLogger(), runtime: { agentRegistry: createRegistry(), runner: createRunner() as never, root } });
    const list = await (await app.request('/api/v1/sessions?limit=10')).json();
    expect(list.data.items[0]).toMatchObject({ sessionId: 's1', agentId: 'assistant', status: 'completed', createdAt: '2026-04-24T00:00:00.000Z' });

    const events = await (await app.request('/api/v1/sessions/s1/events')).json();
    expect(events.data.items[0].event).toEqual({ type: 'text', content: 'hi', delta: true });

    expect((await app.request('/api/v1/sessions/s1', { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/v1/sessions/s1')).status).toBe(404);
    expect((await app.request('/api/v1/sessions/s1/events')).status).toBe(404);

    const verifyDb = haroDb.initHaroDatabase({ root, keepOpen: true }).database!;
    const auditRows = verifyDb
      .prepare(`SELECT event_type, outcome, target_ref, operation_class, target_scope FROM operation_audit_log WHERE event_type = 'web.session.delete' ORDER BY created_at ASC`)
      .all() as Array<{ event_type: string; outcome: string; target_ref: string; operation_class: string; target_scope: string }>;
    verifyDb.close();
    expect(auditRows).toEqual([
      { event_type: 'web.session.delete', outcome: 'success', target_ref: 's1', operation_class: 'delete', target_scope: 'haro-state' },
    ]);
  });

  it('rejects viewer session DELETE and writes a denied audit event (FEAT-028 R11)', async () => {
    delete process.env.HARO_WEB_API_KEY;
    delete process.env.HARO_WEB_ALLOW_SESSION_DELETE;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat016-deny-'));
    tempRoots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('s-denied', 'assistant', 'codex', 'gpt-test', '2026-04-24T00:00:00.000Z', 'completed');
    db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`).run('s-denied', 'text', JSON.stringify({ type: 'text', content: 'keep me', delta: false }), '2026-04-24T00:00:01.000Z');
    db.close();

    const app = createWebApp({ logger: createMockLogger(), runtime: { agentRegistry: createRegistry(), runner: createRunner() as never, root } });
    const bootstrap = await (await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'owner-password' }),
    })).json() as { data: { session: { token: string } } };
    await app.request('/api/v1/users', {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrap.data.session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password', role: 'viewer' }),
    });
    const viewerLogin = await (await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password' }),
    })).json() as { data: { session: { token: string } } };

    const response = await app.request('/api/v1/sessions/s-denied', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${viewerLogin.data.session.token}` },
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
    expect(body.minimumRole).toBe('operator');

    expect((await app.request('/api/v1/sessions/s-denied', { headers: { authorization: `Bearer ${viewerLogin.data.session.token}` } })).status).toBe(200);
    const eventsAfter = await (await app.request('/api/v1/sessions/s-denied/events', { headers: { authorization: `Bearer ${viewerLogin.data.session.token}` } })).json();
    expect(eventsAfter.data.items).toHaveLength(1);

    const verifyDb = haroDb.initHaroDatabase({ root, keepOpen: true }).database!;
    const auditRows = verifyDb
      .prepare(`SELECT event_type, outcome, target_ref FROM operation_audit_log WHERE event_type = 'web.session.delete'`)
      .all() as Array<{ event_type: string; outcome: string; target_ref: string }>;
    verifyDb.close();
    expect(auditRows).toEqual([{ event_type: 'web.session.delete', outcome: 'denied', target_ref: 's-denied' }]);
  });
});

describe('web dashboard WebSocket protocol [FEAT-016]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('authenticates, starts chat, streams events, sends result, and supports subscribe', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    let createdSessionId = '';
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: {
        agentRegistry: createRegistry(),
        createRunner: (createSessionId?: () => string) => {
          createdSessionId = createSessionId?.() ?? 'ws-session';
          return createRunner(createdSessionId) as never;
        },
      },
    });
    const handle = startWebServer(app, { port: 0, host: '127.0.0.1' });
    await handle.ready;
    const address = handle.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: unknown[] = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await once(ws, 'open');

    ws.send(JSON.stringify({ type: 'authenticate', token: 'secret' }));
    await waitFor(messages, (item) => item.type === 'authenticated' && item.ok === true);
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'sessions' }));
    ws.send(JSON.stringify({ type: 'chat.start', agentId: 'assistant', content: 'hello' }));

    await waitFor(messages, (item) => item.type === 'event.stream' && item.event?.type === 'tool_result');
    await waitFor(messages, (item) => item.type === 'event.result');
    await waitFor(messages, (item) => item.type === 'session.update' && item.status === 'completed');
    expect(createdSessionId).toBeTruthy();

    ws.close();
    await handle.stop();
  });

  it('chat.cancel only suppresses the cancelling client while other observers keep receiving the run', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    let createdSessionId = '';
    let finishRun: (() => void) | undefined;
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: {
        agentRegistry: createRegistry(),
        createRunner: (createSessionId?: () => string) => {
          createdSessionId = createSessionId?.() ?? 'ws-cancel-session';
          return {
            run: async (input: RunAgentInput): Promise<RunAgentResult> =>
              new Promise((resolve) => {
                finishRun = () => {
                  const events: AgentEvent[] = [
                    { type: 'text', content: 'late text', delta: true },
                    { type: 'result', content: 'done after cancel', responseId: 'resp-after-cancel' },
                  ];
                  for (const event of events) input.onEvent?.(event, createdSessionId);
                  resolve({
                    sessionId: createdSessionId,
                    ruleId: 'test',
                    provider: input.provider ?? 'codex',
                    model: input.model ?? 'gpt-test',
                    events,
                    finalEvent: events[1] as Extract<AgentEvent, { type: 'result' }>,
                  });
                };
              }),
          };
        },
      },
    });
    const handle = startWebServer(app, { port: 0, host: '127.0.0.1' });
    await handle.ready;
    const address = handle.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const observer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: unknown[] = [];
    const observerMessages: unknown[] = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    observer.addEventListener('message', (event) => observerMessages.push(JSON.parse(String(event.data))));
    await once(ws, 'open');
    await once(observer, 'open');

    ws.send(JSON.stringify({ type: 'authenticate', token: 'secret' }));
    observer.send(JSON.stringify({ type: 'authenticate', token: 'secret' }));
    await waitFor(messages, (item) => item.type === 'authenticated' && item.ok === true);
    await waitFor(observerMessages, (item) => item.type === 'authenticated' && item.ok === true);
    ws.send(JSON.stringify({ type: 'chat.start', agentId: 'assistant', content: 'slow' }));
    await waitFor(messages, (item) => item.type === 'session.update' && item.status === 'running');
    observer.send(JSON.stringify({ type: 'subscribe', channel: 'sessions', sessionId: createdSessionId }));
    ws.send(JSON.stringify({ type: 'chat.cancel', sessionId: createdSessionId }));

    await waitFor(messages, (item) => item.type === 'session.update' && item.status === 'cancelled');
    finishRun?.();
    await waitFor(observerMessages, (item) => item.type === 'event.result');
    await waitFor(observerMessages, (item) => item.type === 'session.update' && item.status === 'completed');
    await waitFor(messages, (item) => item.type === 'session.update' && item.status === 'cancelled');
    await waitFor(messages, (item) => item.type === 'system.status');
    expect(messages.some((item: any) => item.type === 'event.result')).toBe(false);
    expect(messages.some((item: any) => item.type === 'session.update' && item.status === 'completed')).toBe(false);

    ws.close();
    observer.close();
    await handle.stop();
  });
});

function once(target: WebSocket, event: 'open'): Promise<void> {
  return new Promise((resolve) => target.addEventListener(event, () => resolve(), { once: true }));
}

async function waitFor(items: unknown[], predicate: (item: any) => boolean): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const found = items.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for message. Seen: ${JSON.stringify(items)}`);
}
