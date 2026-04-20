import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../src/agent/index.js';
import { ProviderRegistry, type AgentEvent, type AgentProvider, type AgentQueryParams } from '../src/provider/index.js';
import { AgentRunner } from '../src/runtime/index.js';

class MockProvider implements AgentProvider {
  readonly id = 'codex';

  constructor(
    private readonly input: {
      models: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>;
      healthCheck?: () => Promise<boolean>;
      query: (params: AgentQueryParams) => AsyncGenerator<AgentEvent, void, void>;
    },
  ) {}

  query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    return this.input.query(params);
  }

  capabilities() {
    return {
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    return (await this.input.healthCheck?.()) ?? true;
  }

  async listModels(): Promise<
    ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>
  > {
    return this.input.models;
  }
}

function createAgentRegistry() {
  const registry = new AgentRegistry();
  registry.register({
    id: 'haro-assistant',
    name: 'Haro Assistant',
    systemPrompt: 'You are helpful.',
    tools: ['Read'],
  });
  return registry;
}

function createProviderRegistry(provider: AgentProvider) {
  const registry = new ProviderRegistry();
  registry.register(provider);
  return registry;
}

function createLoadedConfig(timeoutMs = 1_000) {
  return {
    config: { runtime: { taskTimeoutMs: timeoutMs } },
    sources: ['test'],
  };
}

function openDb(root: string) {
  return new Database(join(root, 'haro.db'), { readonly: true });
}

describe('AgentRunner [FEAT-005]', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC1/AC3/AC4: writes session events, terminal result, state history, and triggers memory wrapup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-success-'));
    roots.push(root);
    const wrapup = vi.fn(async () => undefined);
    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [{ id: 'codex-primary', created: 1, maxContextTokens: 8_000 }],
          query: async function* () {
            yield { type: 'text', content: 'Scanning workspace…' };
            yield {
              type: 'result',
              content: 'src/index.ts\nsrc/runtime/runner.ts',
              responseId: 'resp-1',
            };
          },
        }),
      ),
      createSessionId: () => 'sess-success',
      loadConfig: () => createLoadedConfig(),
      memoryWrapupHook: wrapup,
    });

    const task =
      '列出当前目录下的 TypeScript 文件，并解释你为什么选择这些输出，同时保持描述足够长以验证 taskPreview 会按 FEAT-005 规则截断到 120 字符以内。';
    const result = await runner.run({ task, agentId: 'haro-assistant' });

    expect(result.finalEvent.type).toBe('result');
    expect(result.provider).toBe('codex');
    expect(result.model).toBe('codex-primary');
    expect(wrapup).toHaveBeenCalledTimes(1);

    const db = openDb(root);
    try {
      const session = db
        .prepare('SELECT status, context_ref FROM sessions WHERE id = ?')
        .get('sess-success') as { status: string; context_ref: string | null };
      expect(session.status).toBe('completed');
      expect(session.context_ref).toBe(JSON.stringify({ previousResponseId: 'resp-1' }));

      const eventCount = db
        .prepare('SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?')
        .get('sess-success') as { count: number };
      expect(eventCount.count).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }

    const state = JSON.parse(
      readFileSync(join(root, 'agents', 'haro-assistant', 'state.json'), 'utf8'),
    ) as {
      executionHistory: Array<{ sessionId: string; taskPreview: string; outcome: string }>;
      keyDecisions: Array<{ provider: string; model: string; ruleId: string }>;
      pendingWork: string[];
    };
    expect(state.executionHistory.at(-1)).toMatchObject({
      sessionId: 'sess-success',
      outcome: 'completed',
    });
    expect(state.executionHistory.at(-1)?.taskPreview.length).toBeLessThanOrEqual(120);
    expect(state.keyDecisions.at(-1)).toMatchObject({
      provider: 'codex',
      model: 'codex-primary',
      ruleId: 'quick-task',
    });
    expect(state.pendingWork).toEqual([]);
  });

  it('AC2: falls back after a retryable provider failure and records provider_fallback_log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-fallback-'));
    roots.push(root);
    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [
            { id: 'codex-primary', created: 1, maxContextTokens: 8_000 },
            { id: 'codex-large', created: 2, maxContextTokens: 128_000 },
          ],
          query: async function* (params) {
            if (params.model === 'codex-primary') {
              yield {
                type: 'error',
                code: 'rate_limit',
                message: 'Too many requests',
                retryable: true,
              };
              return;
            }
            yield {
              type: 'result',
              content: 'fallback succeeded',
              responseId: 'resp-fallback',
            };
          },
        }),
      ),
      createSessionId: () => 'sess-fallback',
      loadConfig: () => createLoadedConfig(),
    });

    const result = await runner.run({
      task: '实现一个 TypeScript 函数来格式化日期',
      agentId: 'haro-assistant',
    });

    expect(result.finalEvent.type).toBe('result');
    expect(result.model).toBe('codex-large');

    const db = openDb(root);
    try {
      const fallback = db
        .prepare(
          'SELECT original_model, fallback_model, trigger, rule_id FROM provider_fallback_log WHERE session_id = ?',
        )
        .get('sess-fallback') as {
          original_model: string;
          fallback_model: string;
          trigger: string;
          rule_id: string;
        };
      expect(fallback).toMatchObject({
        original_model: 'codex-primary',
        fallback_model: 'codex-large',
        trigger: 'rate_limit',
        rule_id: 'code-generation',
      });
    } finally {
      db.close();
    }
  });

  it('AC5: restores continuation from the prior completed session context_ref/responseId', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-continuation-'));
    roots.push(root);
    const previousResponseIds: Array<string | undefined> = [];
    let callCount = 0;

    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [{ id: 'codex-primary', created: 1, maxContextTokens: 8_000 }],
          query: async function* (params) {
            callCount += 1;
            previousResponseIds.push(params.sessionContext?.previousResponseId);
            yield {
              type: 'result',
              content: `run-${callCount}`,
              responseId: `resp-${callCount}`,
            };
          },
        }),
      ),
      createSessionId: () => `sess-${callCount + 1}`,
      loadConfig: () => createLoadedConfig(),
    });

    await runner.run({ task: '第一次运行', agentId: 'haro-assistant' });
    await runner.run({ task: '第二次运行', agentId: 'haro-assistant' });

    expect(previousResponseIds).toEqual([undefined, 'resp-1']);
  });

  it('AC6/AC7: times out cleanly, marks the session failed, and skips memory wrapup when unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-timeout-'));
    roots.push(root);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [{ id: 'codex-primary', created: 1, maxContextTokens: 8_000 }],
          query: async function* () {
            yield { type: 'text', content: 'Still working…' };
            await new Promise((resolve) => setTimeout(resolve, 50));
            yield { type: 'result', content: 'too late', responseId: 'resp-late' };
          },
        }),
      ),
      createSessionId: () => 'sess-timeout',
      loadConfig: () => createLoadedConfig(5),
      logger,
    });

    const result = await runner.run({ task: '阻塞任务', agentId: 'haro-assistant' });
    expect(result.finalEvent).toMatchObject({
      type: 'error',
      code: 'timeout',
    });

    const db = openDb(root);
    try {
      const session = db
        .prepare('SELECT status FROM sessions WHERE id = ?')
        .get('sess-timeout') as { status: string };
      expect(session.status).toBe('failed');
    } finally {
      db.close();
    }

    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.anything(),
      'memory-wrapup hook skipped',
    );
  });

  it('AC7: honors --no-memory by skipping the memory-wrapup hook even on success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-no-memory-'));
    roots.push(root);
    const wrapup = vi.fn(async () => undefined);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [{ id: 'codex-primary', created: 1, maxContextTokens: 8_000 }],
          query: async function* () {
            yield { type: 'result', content: 'done', responseId: 'resp-no-memory' };
          },
        }),
      ),
      createSessionId: () => 'sess-no-memory',
      loadConfig: () => createLoadedConfig(),
      memoryWrapupHook: wrapup,
      logger,
    });

    const result = await runner.run({
      task: '这次运行不要写记忆',
      agentId: 'haro-assistant',
      noMemory: true,
    });
    expect(result.finalEvent.type).toBe('result');
    expect(wrapup).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { sessionId: 'sess-no-memory' },
      'memory-wrapup hook skipped (no-memory override)',
    );
  });

  it('AC7: logs a debug skip when memory-wrapup is not installed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-no-hook-'));
    roots.push(root);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const runner = new AgentRunner({
      root,
      agentRegistry: createAgentRegistry(),
      providerRegistry: createProviderRegistry(
        new MockProvider({
          models: [{ id: 'codex-primary', created: 1, maxContextTokens: 8_000 }],
          query: async function* () {
            yield { type: 'result', content: 'done', responseId: 'resp-no-hook' };
          },
        }),
      ),
      createSessionId: () => 'sess-no-hook',
      loadConfig: () => createLoadedConfig(),
      logger,
    });

    const result = await runner.run({
      task: 'memory-wrapup hook 未接入时也应成功',
      agentId: 'haro-assistant',
    });
    expect(result.finalEvent.type).toBe('result');
    expect(logger.debug).toHaveBeenCalledWith(
      { sessionId: 'sess-no-hook' },
      'memory-wrapup hook skipped',
    );
  });
});
