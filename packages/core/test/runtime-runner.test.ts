import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  AgentRunner,
  ProviderRegistry,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentProvider,
  type AgentQueryParams,
} from '../src/index.js';
import type { LoadedConfig } from '../src/config/loader.js';

const TEST_CONFIG: LoadedConfig = {
  config: {},
  sources: ['test'],
};

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class ScriptedProvider implements AgentProvider {
  readonly id: string;
  readonly calls: AgentQueryParams[] = [];
  private readonly healthy: boolean;
  private readonly models: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>;
  private readonly handler: (params: AgentQueryParams) => AsyncGenerator<AgentEvent, void, void>;

  constructor(input: {
    id: string;
    healthy?: boolean;
    models?: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>;
    handler: (params: AgentQueryParams) => AsyncGenerator<AgentEvent, void, void>;
  }) {
    this.id = input.id;
    this.healthy = input.healthy ?? true;
    this.models = input.models ?? [];
    this.handler = input.handler;
  }

  capabilities() {
    return {
      streaming: false,
      toolLoop: true,
      contextCompaction: false,
      contextContinuation: true,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }

  async listModels(): Promise<
    ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>
  > {
    return this.models;
  }

  query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    this.calls.push(params);
    return this.handler(params);
  }
}

function createAgentRegistry(defaults?: {
  defaultProvider?: string;
  defaultModel?: string;
}): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({
    id: 'haro-assistant',
    name: 'Haro Assistant',
    systemPrompt: 'helpful',
    ...(defaults?.defaultProvider ? { defaultProvider: defaults.defaultProvider } : {}),
    ...(defaults?.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
  });
  return registry;
}

function readState(root: string): {
  taskContext: { lastTaskPreview: string; lastSessionId: string };
  executionHistory: Array<{ sessionId: string; outcome: string; taskPreview: string }>;
  keyDecisions: Array<{ ruleId: string; provider: string; model: string }>;
  pendingWork: string[];
} {
  return JSON.parse(readFileSync(join(root, 'agents', 'haro-assistant', 'state.json'), 'utf8')) as {
    taskContext: { lastTaskPreview: string; lastSessionId: string };
    executionHistory: Array<{ sessionId: string; outcome: string; taskPreview: string }>;
    keyDecisions: Array<{ ruleId: string; provider: string; model: string }>;
    pendingWork: string[];
  };
}

describe('AgentRunner [FEAT-005]', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('persists sessions, continuation state, and agent state across successful runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-success-'));
    tempRoots.push(root);

    const provider = new ScriptedProvider({
      id: 'codex',
      models: [
        { id: 'codex-default', created: 1, maxContextTokens: 32_000 },
        { id: 'codex-large', created: 2, maxContextTokens: 128_000 },
      ],
      handler: async function* (params): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'text', content: `echo:${params.prompt}` };
        yield {
          type: 'result',
          content: `done:${params.prompt}`,
          responseId: params.sessionContext?.previousResponseId ? 'resp-2' : 'resp-1',
        };
      },
    });
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(provider);

    const wrapups: Array<{ sessionId: string; task: string; result: string }> = [];
    const runner = new AgentRunner({
      agentRegistry: createAgentRegistry({
        defaultProvider: 'codex',
        defaultModel: 'codex-default',
      }),
      providerRegistry,
      root,
      loadConfig: () => TEST_CONFIG,
      logger: silentLogger,
      memoryWrapupHook: async (input) => {
        wrapups.push({ sessionId: input.sessionId, task: input.task, result: input.result });
      },
    });

    const first = await runner.run({
      agentId: 'haro-assistant',
      task: '列出当前目录下的 TypeScript 文件',
    });
    const second = await runner.run({
      agentId: 'haro-assistant',
      task: '继续上一轮并总结',
    });

    expect(first.finalEvent).toMatchObject({ type: 'result', responseId: 'resp-1' });
    expect(second.finalEvent).toMatchObject({ type: 'result', responseId: 'resp-2' });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.sessionContext?.previousResponseId).toBeUndefined();
    expect(provider.calls[1]?.sessionContext?.previousResponseId).toBe('resp-1');
    expect(wrapups.map((entry) => entry.sessionId)).toEqual([first.sessionId, second.sessionId]);

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const sessions = db
        .prepare(
          `SELECT id, status, context_ref FROM sessions ORDER BY started_at ASC`,
        )
        .all() as Array<{ id: string; status: string; context_ref: string | null }>;
      expect(sessions).toHaveLength(2);
      expect(sessions.every((row) => row.status === 'completed')).toBe(true);
      expect(JSON.parse(sessions[0]!.context_ref!)).toEqual({ previousResponseId: 'resp-1' });
      expect(JSON.parse(sessions[1]!.context_ref!)).toEqual({ previousResponseId: 'resp-2' });

      const eventCount = db
        .prepare(`SELECT COUNT(*) as count FROM session_events WHERE session_id = ?`)
        .get(first.sessionId) as { count: number };
      expect(eventCount.count).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }

    const state = readState(root);
    expect(state.taskContext.lastSessionId).toBe(second.sessionId);
    expect(state.executionHistory).toHaveLength(2);
    expect(state.executionHistory.map((entry) => entry.outcome)).toEqual(['completed', 'completed']);
    expect(state.executionHistory[0]?.taskPreview).toContain('TypeScript');
    expect(state.keyDecisions.at(-1)).toMatchObject({
      ruleId: 'agent-default',
      provider: 'codex',
    });
    expect(state.pendingWork).toEqual([]);
  });

  it('emits events through the optional onEvent callback in provider order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-events-'));
    tempRoots.push(root);

    const provider = new ScriptedProvider({
      id: 'codex',
      models: [{ id: 'codex-default', created: 1, maxContextTokens: 32_000 }],
      handler: async function* (): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'text', content: 'chunk-1', delta: true };
        yield { type: 'text', content: 'chunk-2', delta: true };
        yield { type: 'result', content: 'final', responseId: 'resp-1' };
      },
    });
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(provider);
    const runner = new AgentRunner({
      agentRegistry: createAgentRegistry({
        defaultProvider: 'codex',
        defaultModel: 'codex-default',
      }),
      providerRegistry,
      root,
      loadConfig: () => TEST_CONFIG,
      logger: silentLogger,
    });

    const seen: AgentEvent[] = [];
    const result = await runner.run({
      agentId: 'haro-assistant',
      task: 'stream this',
      onEvent: (event) => {
        seen.push(event);
      },
    });

    expect(result.finalEvent).toMatchObject({ type: 'result', content: 'final' });
    expect(seen[0]).toEqual({ type: 'text', content: 'chunk-1', delta: true });
    expect(seen[1]).toEqual({ type: 'text', content: 'chunk-2', delta: true });
    expect(seen[2]).toMatchObject({
      type: 'result',
      content: 'final',
      responseId: 'resp-1',
      provider: 'codex',
      model: 'codex-default',
    });
    expect((seen[2] as Extract<AgentEvent, { type: 'result' }>).latencyMs).toEqual(expect.any(Number));
  });

  it('falls back to the next provider and records provider_fallback_log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-fallback-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: fallback-rule',
        '    priority: 1',
        '    match:',
        '      promptPattern: "fallback"',
        '    select:',
        '      provider: flaky',
        '      model: flaky-model',
        '    fallback:',
        '      - provider: steady',
        '        model: steady-model',
      ].join('\n'),
      'utf8',
    );

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      new ScriptedProvider({
        id: 'flaky',
        handler: async function* (): AsyncGenerator<AgentEvent, void, void> {
          const error: AgentErrorEvent = {
            type: 'error',
            code: 'rate_limit',
            message: 'too many requests',
            retryable: true,
          };
          yield error;
        },
      }),
    );
    providerRegistry.register(
      new ScriptedProvider({
        id: 'steady',
        handler: async function* (): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'result', content: 'fallback succeeded', responseId: 'steady-1' };
        },
      }),
    );

    const runner = new AgentRunner({
      agentRegistry: createAgentRegistry(),
      providerRegistry,
      root,
      loadConfig: () => TEST_CONFIG,
      logger: silentLogger,
    });

    const result = await runner.run({
      agentId: 'haro-assistant',
      task: 'please fallback now',
    });

    expect(result.finalEvent).toMatchObject({ type: 'result', content: 'fallback succeeded' });
    expect(result.provider).toBe('steady');

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT original_provider, fallback_provider, trigger, rule_id
             FROM provider_fallback_log`,
        )
        .all() as Array<{
          original_provider: string;
          fallback_provider: string;
          trigger: string;
          rule_id: string;
        }>;
      expect(rows).toEqual([
        {
          original_provider: 'flaky',
          fallback_provider: 'steady',
          trigger: 'rate_limit',
          rule_id: 'fallback-rule',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('times out a blocking provider and marks the session as failed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runner-timeout-'));
    tempRoots.push(root);

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      new ScriptedProvider({
        id: 'slow',
        models: [
          { id: 'slow-model', created: 1, maxContextTokens: 4_000 },
          { id: 'slow-large', created: 2, maxContextTokens: 8_000 },
        ],
        handler: async function* (): AsyncGenerator<AgentEvent, void, void> {
          await new Promise((resolve) => setTimeout(resolve, 25));
          yield { type: 'result', content: 'too late', responseId: 'late-1' };
        },
      }),
    );

    const runner = new AgentRunner({
      agentRegistry: createAgentRegistry({
        defaultProvider: 'slow',
        defaultModel: 'slow-model',
      }),
      providerRegistry,
      root,
      loadConfig: () => TEST_CONFIG,
      logger: silentLogger,
      taskTimeoutMs: 5,
    });

    const result = await runner.run({
      agentId: 'haro-assistant',
      task: 'this should time out',
    });

    expect(result.finalEvent).toMatchObject({
      type: 'error',
      code: 'timeout',
    });

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const session = db
        .prepare(`SELECT status FROM sessions WHERE id = ?`)
        .get(result.sessionId) as { status: string } | undefined;
      expect(session?.status).toBe('failed');
    } finally {
      db.close();
    }

    const state = readState(root);
    expect(state.executionHistory.at(-1)?.outcome).toBe('failed');
    expect(state.pendingWork).toHaveLength(1);
  });

  it('exports AgentRunner from the root package surface', () => {
    expect(AgentRunner).toBeTypeOf('function');
  });
});
