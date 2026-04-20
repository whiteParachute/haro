/** FEAT-005 — AgentRunner success/fallback/state/continuation/timeout coverage. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  AgentRegistry,
  AgentRunner,
  ProviderRegistry,
} from '../src/index.js';
import type {
  AgentEvent,
  AgentProvider,
  AgentQueryParams,
  AgentSessionContext,
} from '../src/index.js';

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'haro-agent-runner-'));
}

function baseAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({
    id: 'haro-assistant',
    name: 'Haro 默认助手',
    systemPrompt: '你是 Haro 默认助手',
  });
  return registry;
}

function readStateFile(root: string): {
  taskContext: {
    lastTaskPreview: string;
    lastSessionId: string;
    updatedAt: string;
    provider: string;
    model: string;
  };
  executionHistory: Array<{
    sessionId: string;
    timestamp: string;
    taskPreview: string;
    outcome: 'completed' | 'failed';
  }>;
  keyDecisions: Array<{
    timestamp: string;
    ruleId: string;
    provider: string;
    model: string;
  }>;
  pendingWork: string[];
} {
  return JSON.parse(
    readFileSync(join(root, 'agents', 'haro-assistant', 'state.json'), 'utf8'),
  ) as ReturnType<typeof readStateFile>;
}

function makeResultProvider(input: {
  id: string;
  model?: string;
  text?: string;
  responseIds?: string[];
  recordSessions?: AgentSessionContext[];
}): AgentProvider & {
  listModels: () => Promise<Array<{ id: string; created?: number; maxContextTokens?: number }>>;
} {
  let callIndex = 0;
  return {
    id: input.id,
    async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
      input.recordSessions?.push(params.sessionContext ?? { sessionId: 'missing' });
      const responseId = input.responseIds?.[callIndex];
      callIndex += 1;
      yield { type: 'text', content: input.text ?? `${input.id} says hi`, delta: false };
      yield {
        type: 'result',
        content: input.text ?? `${input.id} says hi`,
        ...(responseId ? { responseId } : {}),
      };
    },
    capabilities() {
      return {
        streaming: false,
        toolLoop: false,
        contextCompaction: false,
        contextContinuation: true,
      };
    },
    async healthCheck() {
      return true;
    },
    async listModels() {
      return [
        {
          id: input.model ?? `${input.id}-model`,
          created: 10,
          maxContextTokens: 32_000,
        },
      ];
    },
  };
}

describe('AgentRunner [FEAT-005]', () => {
  let root: string;
  let agentRegistry: AgentRegistry;

  beforeEach(() => {
    root = freshRoot();
    agentRegistry = baseAgentRegistry();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC2/AC3/AC4: falls back, persists session rows, and updates agent state', async () => {
    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: failover-first',
        '    priority: 1',
        '    match: {}',
        '    select:',
        '      provider: unhealthy',
        '      model: unhealthy-model',
        '    fallback:',
        '      - provider: healthy',
        '        model: healthy-model',
        '',
      ].join('\n'),
      'utf8',
    );

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register({
      id: 'unhealthy',
      async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        yield {
          type: 'error',
          code: 'provider_unavailable',
          message: 'unused because healthCheck is false',
          retryable: true,
        };
      },
      capabilities() {
        return {
          streaming: false,
          toolLoop: false,
          contextCompaction: false,
        };
      },
      async healthCheck() {
        return false;
      },
    });
    providerRegistry.register(
      makeResultProvider({
        id: 'healthy',
        model: 'healthy-model',
        text: 'ok from fallback',
      }),
    );

    const runner = new AgentRunner({
      root,
      agentRegistry,
      providerRegistry,
    });
    const result = await runner.run({
      agentId: 'haro-assistant',
      task: '列出当前目录下的 TypeScript 文件',
    });

    expect(result.finalEvent).toMatchObject({
      type: 'result',
      content: 'ok from fallback',
    });

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const session = db
        .prepare(
          'SELECT status, provider, model FROM sessions WHERE id = ?',
        )
        .get(result.sessionId) as
        | { status: string; provider: string; model: string }
        | undefined;
      expect(session).toMatchObject({
        status: 'completed',
        provider: 'healthy',
        model: 'healthy-model',
      });
      const eventCount = db
        .prepare('SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?')
        .get(result.sessionId) as { count: number };
      expect(eventCount.count).toBeGreaterThanOrEqual(2);
      const fallbackCount = db
        .prepare('SELECT COUNT(*) AS count FROM provider_fallback_log WHERE session_id = ?')
        .get(result.sessionId) as { count: number };
      expect(fallbackCount.count).toBe(1);
    } finally {
      db.close();
    }

    const state = readStateFile(root);
    expect(state.executionHistory.at(-1)).toMatchObject({
      sessionId: result.sessionId,
      taskPreview: '列出当前目录下的 TypeScript 文件',
      outcome: 'completed',
    });
    expect(state.pendingWork).toEqual([]);
  });

  it('AC5: restores previousResponseId from the last successful session context_ref', async () => {
    const recordedSessions: AgentSessionContext[] = [];
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      makeResultProvider({
        id: 'codex',
        model: 'gpt-5-codex',
        responseIds: ['resp-1', 'resp-2'],
        recordSessions: recordedSessions,
      }),
    );

    const runner = new AgentRunner({
      root,
      agentRegistry,
      providerRegistry,
    });

    const first = await runner.run({
      agentId: 'haro-assistant',
      task: '第一轮任务',
    });
    const second = await runner.run({
      agentId: 'haro-assistant',
      task: '第二轮任务',
    });

    expect(first.finalEvent).toMatchObject({ type: 'result', responseId: 'resp-1' });
    expect(second.finalEvent).toMatchObject({ type: 'result', responseId: 'resp-2' });
    expect(recordedSessions).toHaveLength(2);
    expect(recordedSessions[1]).toMatchObject({
      previousResponseId: 'resp-1',
    });
  });

  it('AC6/AC7: times out cleanly, marks the session failed, and does not write memory', async () => {
    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: single-timeout-attempt',
        '    priority: 1',
        '    match: {}',
        '    select:',
        '      provider: codex',
        '      model: codex-timeout-model',
        '',
      ].join('\n'),
      'utf8',
    );
    const memoryWrapupHook = vi.fn(async () => undefined);
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register({
      id: 'codex',
      query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        let done = false;
        let resolvePending:
          | ((value: IteratorResult<AgentEvent, void>) => void)
          | undefined;
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            if (done) {
              return Promise.resolve({ done: true, value: undefined });
            }
            return new Promise<IteratorResult<AgentEvent, void>>((resolve) => {
              resolvePending = resolve;
            });
          },
          return() {
            done = true;
            resolvePending?.({ done: true, value: undefined });
            return Promise.resolve({ done: true, value: undefined });
          },
          throw(error?: unknown) {
            done = true;
            return Promise.reject(error);
          },
        };
      },
      capabilities() {
        return {
          streaming: false,
          toolLoop: false,
          contextCompaction: false,
          contextContinuation: true,
        };
      },
      async healthCheck() {
        return true;
      },
    });

    const runner = new AgentRunner({
      root,
      agentRegistry,
      providerRegistry,
      taskTimeoutMs: 10,
      memoryWrapupHook,
    });

    const result = await runner.run({
      agentId: 'haro-assistant',
      task: '这个任务会超时',
    });

    expect(result.finalEvent).toMatchObject({
      type: 'error',
      code: 'timeout',
      retryable: true,
    });
    expect(memoryWrapupHook).not.toHaveBeenCalled();
    expect(
      result.events.filter(
        (event) => event.type === 'error' && event.code === 'timeout',
      ),
    ).toHaveLength(1);

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const session = db
        .prepare('SELECT status FROM sessions WHERE id = ?')
        .get(result.sessionId) as { status: string } | undefined;
      expect(session?.status).toBe('failed');
      const timeoutRows = db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM session_events
            WHERE session_id = ?
              AND event_type = 'error'
              AND json_extract(event_data, '$.code') = 'timeout'`,
        )
        .get(result.sessionId) as { count: number };
      expect(timeoutRows.count).toBe(1);
    } finally {
      db.close();
    }

    const state = readStateFile(root);
    expect(state.keyDecisions).toEqual([]);
    expect(state.pendingWork).toContain('这个任务会超时');
  });

  it('AC7: successful runs log "memory-wrapup hook skipped" when the hook is absent', async () => {
    const debug = vi.fn();
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      makeResultProvider({
        id: 'codex',
        model: 'gpt-5-codex',
      }),
    );

    const runner = new AgentRunner({
      root,
      agentRegistry,
      providerRegistry,
      logger: {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const result = await runner.run({
      agentId: 'haro-assistant',
      task: '成功但没有记忆 hook',
    });

    expect(result.finalEvent).toMatchObject({ type: 'result' });
    expect(debug).toHaveBeenCalledWith(
      { sessionId: result.sessionId },
      'memory-wrapup hook skipped',
    );
  });

  it('does not fallback on retryable-but-unspecified errors like tool_error', async () => {
    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: no-tool-error-fallback',
        '    priority: 1',
        '    match: {}',
        '    select:',
        '      provider: primary',
        '      model: primary-model',
        '    fallback:',
        '      - provider: fallback',
        '        model: fallback-model',
        '',
      ].join('\n'),
      'utf8',
    );

    let fallbackCalled = false;
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register({
      id: 'primary',
      async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        yield {
          type: 'error',
          code: 'tool_error',
          message: 'tool failed',
          retryable: true,
        };
      },
      capabilities() {
        return {
          streaming: false,
          toolLoop: false,
          contextCompaction: false,
        };
      },
      async healthCheck() {
        return true;
      },
    });
    providerRegistry.register({
      id: 'fallback',
      async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        fallbackCalled = true;
        yield { type: 'result', content: 'should not run' };
      },
      capabilities() {
        return {
          streaming: false,
          toolLoop: false,
          contextCompaction: false,
        };
      },
      async healthCheck() {
        return true;
      },
    });

    const runner = new AgentRunner({
      root,
      agentRegistry,
      providerRegistry,
    });

    const result = await runner.run({
      agentId: 'haro-assistant',
      task: '触发一个 tool_error',
    });

    expect(fallbackCalled).toBe(false);
    expect(result.finalEvent).toMatchObject({
      type: 'error',
      code: 'tool_error',
    });

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const fallbackCount = db
        .prepare('SELECT COUNT(*) AS count FROM provider_fallback_log WHERE session_id = ?')
        .get(result.sessionId) as { count: number };
      expect(fallbackCount.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
