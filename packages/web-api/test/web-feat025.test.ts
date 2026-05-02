import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db as haroDb, PermissionBudgetStore, AgentRegistry, ProviderRegistry, AgentRunner, type AgentConfig, type AgentProvider } from '@haro/core';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('web dashboard runtime logs and provider monitoring [FEAT-025]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
    while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
  });

  it('filters session events and preserves structured JSON payloads', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat025-logs-'));
    tempRoots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('s1', 'agent-a', 'codex', 'gpt-a', daysAgo(0), 'completed');
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('s2', 'agent-b', 'codex', 'gpt-b', daysAgo(0), 'failed');
    db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at, latency_ms) VALUES (?, ?, ?, ?, ?)`).run('s1', 'result', JSON.stringify({ type: 'result', content: 'ok', nested: { keep: true }, usage: { inputTokens: 2, outputTokens: 3 }, provider: 'codex', model: 'gpt-a', latencyMs: 42 }), daysAgo(0), 42);
    db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at, latency_ms) VALUES (?, ?, ?, ?, ?)`).run('s2', 'error', JSON.stringify({ type: 'error', code: 'rate_limit', retryable: true }), daysAgo(0), 12);
    db.close();

    const app = createWebApp({ logger: createMockLogger(), staticRoot: root, runtime: { root } });
    const response = await app.request('/api/v1/logs/session-events?sessionId=s1&agentId=agent-a&eventType=result&limit=10');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ sessionId: 's1', agentId: 'agent-a', eventType: 'result', latencyMs: 42 });
    expect(body.data.items[0].payload.nested.keep).toBe(true);
  });

  it('queries provider fallback logs with original/fallback provider and rule metadata', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat025-fallback-'));
    tempRoots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO provider_fallback_log (session_id, original_provider, original_model, fallback_provider, fallback_model, trigger, rule_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('s1', 'codex', 'gpt-a', 'codex', 'gpt-b', 'rate_limit', 'rule-a', daysAgo(0));
    db.close();

    const app = createWebApp({ logger: createMockLogger(), staticRoot: root, runtime: { root } });
    const response = await app.request('/api/v1/logs/provider-fallbacks?sessionId=s1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toMatchObject({ sessionId: 's1', originalProvider: 'codex', fallbackProvider: 'codex', trigger: 'rate_limit', ruleId: 'rule-a' });
  });

  it('aggregates provider stats for 24h, 7d and all from persisted latency, fallback log and budget ledger', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat025-stats-'));
    tempRoots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('recent-success', 'agent-a', 'codex', 'gpt-a', daysAgo(0), 'completed');
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('recent-fail', 'agent-a', 'codex', 'gpt-a', daysAgo(0), 'failed');
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('two-days', 'agent-a', 'codex', 'gpt-a', daysAgo(2), 'completed');
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('ten-days', 'agent-a', 'codex', 'gpt-a', daysAgo(10), 'completed');
    const insertEvent = db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at, latency_ms) VALUES (?, ?, ?, ?, ?)`);
    insertEvent.run('recent-success', 'result', JSON.stringify({ type: 'result', content: 'ok', provider: 'codex', model: 'gpt-a', latencyMs: 100 }), daysAgo(0), 100);
    insertEvent.run('recent-fail', 'error', JSON.stringify({ type: 'error', code: 'rate_limit', retryable: true, provider: 'codex', model: 'gpt-a', latencyMs: 300 }), daysAgo(0), 300);
    insertEvent.run('two-days', 'result', JSON.stringify({ type: 'result', content: 'ok', provider: 'codex', model: 'gpt-a', latencyMs: 700 }), daysAgo(2), 700);
    insertEvent.run('ten-days', 'result', JSON.stringify({ type: 'result', content: 'ok', provider: 'codex', model: 'gpt-a', latencyMs: 900 }), daysAgo(10), 900);
    db.prepare(`INSERT INTO provider_fallback_log (session_id, original_provider, original_model, fallback_provider, fallback_model, trigger, rule_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('recent-fail', 'codex', 'gpt-a', 'codex', 'gpt-b', 'rate_limit', 'rule-a', daysAgo(0));
    db.close();

    let ledgerId = 0;
    const budgetStore = new PermissionBudgetStore({ root, createId: () => `ledger-${ledgerId++}` });
    budgetStore.recordTokenUsage({ workflowId: 'wf-recent', agentId: 'agent-a', provider: 'codex', model: 'gpt-a', inputTokens: 10, outputTokens: 5, estimatedCost: 0.01, createdAt: daysAgo(0) });
    budgetStore.recordTokenUsage({ workflowId: 'wf-two-days', agentId: 'agent-a', provider: 'codex', model: 'gpt-a', inputTokens: 20, outputTokens: 10, estimatedCost: 0.02, createdAt: daysAgo(2) });
    budgetStore.recordTokenUsage({ workflowId: 'wf-ten-days', agentId: 'agent-a', provider: 'codex', model: 'gpt-a', inputTokens: 40, outputTokens: 20, estimatedCost: 0.04, createdAt: daysAgo(10) });
    budgetStore.close();

    const app = createWebApp({ logger: createMockLogger(), staticRoot: root, runtime: { root } });
    const response = await app.request('/api/v1/providers/stats');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.windows['24h'][0]).toMatchObject({ provider: 'codex', model: 'gpt-a', callCount: 2, successCount: 1, failureCount: 1, fallbackCount: 1, avgLatencyMs: 200, inputTokens: 10, outputTokens: 5 });
    expect(body.data.windows['7d'][0]).toMatchObject({ callCount: 3, avgLatencyMs: 367, inputTokens: 30, outputTokens: 15 });
    expect(body.data.windows.all[0]).toMatchObject({ callCount: 4, avgLatencyMs: 500, inputTokens: 70, outputTokens: 35 });
  });

  it('records provider attempt latency without changing ProviderRegistry or AgentRunner call contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat025-runner-'));
    tempRoots.push(root);
    const agentRegistry = new AgentRegistry();
    const agent: AgentConfig = { id: 'assistant', name: 'Assistant', systemPrompt: 'help', defaultProvider: 'codex', defaultModel: 'gpt-a' };
    agentRegistry.register(agent);
    const providerRegistry = new ProviderRegistry();
    const provider: AgentProvider = {
      id: 'codex',
      async *query() {
        yield { type: 'result', content: 'ok', usage: { inputTokens: 1, outputTokens: 2 } };
      },
      capabilities: () => ({ streaming: true, toolLoop: true, contextCompaction: false }),
      healthCheck: async () => true,
      listModels: async () => [{ id: 'gpt-a', contextWindow: 1000 }],
    } as AgentProvider & { listModels(): Promise<Array<{ id: string; contextWindow: number }>> };
    providerRegistry.register(provider);
    const runner = new AgentRunner({ agentRegistry, providerRegistry, root, loadConfig: () => ({ config: { defaultAgent: 'assistant' }, sources: [] }) as never, memoryWrapupHook: async () => undefined });

    const result = await runner.run({ task: 'hi', agentId: 'assistant', continueLatestSession: false });
    expect(result.finalEvent.type).toBe('result');
    expect(result.finalEvent).toMatchObject({ provider: 'codex', model: 'gpt-a' });
    expect(typeof result.finalEvent.latencyMs).toBe('number');

    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const row = opened.database!.prepare(`SELECT latency_ms, event_data FROM session_events WHERE session_id = ? AND event_type = 'result'`).get(result.sessionId) as { latency_ms: number; event_data: string };
    opened.database!.close();
    expect(row.latency_ms).toEqual(expect.any(Number));
    expect(JSON.parse(row.event_data).latencyMs).toEqual(row.latency_ms);
  });
});
