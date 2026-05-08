import { describe, expect, it } from 'vitest';
import {
  ObservationBatchSchema,
  createHttpAgentDockSource,
  type AgentDockFetch,
  type AgentDockJsonResponse,
} from '../src/index.js';

function json(value: unknown, status = 200): AgentDockJsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    async json(): Promise<unknown> {
      return value;
    },
  };
}

describe('HttpAgentDockSource [FEAT-045]', () => {
  it('collects schema-valid observations from AgentDock HTTP APIs', async () => {
    const requests: string[] = [];
    const longContent = 'x'.repeat(650);
    const fetchImpl: AgentDockFetch = async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      switch (path) {
        case '/api/health':
          return json({ status: 'healthy' });
        case '/api/status':
          return json({
            activeRuntimes: 1,
            queueLength: 0,
            sessions: [
              {
                session_id: 'main:flow-1',
                runtime_key: 'web:main',
                runner_id: 'codex',
                model: 'gpt-5.5',
              },
            ],
          });
        case '/api/sessions':
          return json({
            sessions: {
              'main:flow-1': {
                id: 'main:flow-1',
                name: 'Flow 1',
                backing_jid: 'feishu:oc_test',
                runner_id: 'codex',
                model: 'gpt-5.5',
                runner_profile_id: 'frontier',
                created_at: '2026-05-08T10:00:00.000Z',
                updated_at: '2026-05-08T10:05:00.000Z',
              },
            },
          });
        case '/api/sessions/main%3Aflow-1/messages?limit=2':
          return json({
            messages: [
              {
                id: 'm1',
                is_from_me: false,
                content: longContent,
                timestamp: '2026-05-08T10:05:00.000Z',
                token_usage: { input_tokens: 12, output_tokens: 3 },
              },
              {
                id: 'm2',
                is_from_me: true,
                content: 'assistant reply',
                timestamp: '2026-05-08T10:06:00.000Z',
              },
            ],
          });
        case '/api/sessions/main%3Aflow-1/turns?limit=2':
          return json({
            turns: [
              {
                id: 'turn-failed',
                status: 'failed',
                summary: 'runner failed',
                startedAt: '2026-05-08T10:06:30.000Z',
              },
            ],
          });
        case '/api/tasks':
          return json({
            tasks: [
              {
                id: 'task-1',
                execution_type: 'script',
                status: 'active',
                last_run: '2026-05-08T10:07:00.000Z',
                last_result: 'ok',
              },
            ],
          });
        default:
          throw new Error(`unexpected path: ${path}`);
      }
    };

    const source = createHttpAgentDockSource({
      baseUrl: 'http://agentdock.local/',
      connectionId: 'agentdock-local',
      now: () => new Date('2026-05-08T10:08:00.000Z'),
      fetchImpl,
    });

    const batch = ObservationBatchSchema.parse(await source.collectObservationBatch({ limit: 2 }));

    expect(batch.connectionId).toBe('agentdock-local');
    expect(batch.source).toBe('agentdock-http');
    expect(batch.sessions[0]).toMatchObject({
      id: 'main:flow-1',
      channel: 'feishu:oc_test',
      runnerId: 'codex',
      model: 'gpt-5.5',
      profile: 'frontier',
    });
    expect(batch.turns).toHaveLength(2);
    expect(batch.turns[0]?.role).toBe('user');
    expect(batch.turns[0]?.contentExcerpt).toHaveLength(500);
    expect(batch.turns[1]?.role).toBe('assistant');
    expect(batch.usageRecords[0]).toMatchObject({
      sessionId: 'main:flow-1',
      model: 'gpt-5.5',
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(batch.scheduledTaskRuns[0]).toMatchObject({
      taskId: 'task-1',
      executionType: 'script',
      status: 'success',
    });
    expect(batch.runnerErrors[0]).toMatchObject({
      sessionId: 'main:flow-1',
      code: 'AGENTDOCK_TURN_FAILED',
      recoverable: false,
    });
    expect(batch.window.cursor).toBe('2026-05-08T10:07:00.000Z');
    expect(batch.rawRefs).toEqual([
      'http://agentdock.local/api/health',
      'http://agentdock.local/api/status',
    ]);
    expect(batch.metadata).toMatchObject({
      source: 'agentdock-http',
      healthStatus: 'healthy',
      activeRuntimes: 1,
      sessions: 1,
      turns: 2,
    });
    expect(requests).toContain(
      'http://agentdock.local/api/sessions/main%3Aflow-1/messages?limit=2',
    );
    expect(requests).toContain('http://agentdock.local/api/sessions/main%3Aflow-1/turns?limit=2');
  });

  it('rejects unsafe AgentDock base URLs', () => {
    expect(() =>
      createHttpAgentDockSource({ baseUrl: 'http://user:secret@agentdock.local' }),
    ).toThrow(/must not include username or password/);
    expect(() => createHttpAgentDockSource({ baseUrl: 'file:///tmp/agentdock' })).toThrow(
      /must use http or https scheme/,
    );
  });

  it('maps fetch failures to AgentDockHttpSourceError', async () => {
    const source = createHttpAgentDockSource({
      baseUrl: 'http://agentdock.local',
      fetchImpl: async () => {
        throw new Error('connection refused');
      },
    });

    await expect(source.collectObservationBatch()).rejects.toMatchObject({
      name: 'AgentDockHttpSourceError',
      url: 'http://agentdock.local/api/health',
    });
  });

  it('applies limit globally to returned observation arrays', async () => {
    const fetchImpl: AgentDockFetch = async (url) => {
      const path = `${new URL(url).pathname}${new URL(url).search}`;
      if (path === '/api/health') return json({ status: 'healthy' });
      if (path === '/api/status') return json({ activeRuntimes: 0, queueLength: 0, sessions: [] });
      if (path === '/api/sessions') {
        return json({
          sessions: {
            'main:flow-1': { id: 'main:flow-1', created_at: '2026-05-08T10:00:00.000Z' },
            'main:flow-2': { id: 'main:flow-2', created_at: '2026-05-08T10:01:00.000Z' },
          },
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/messages?limit=1') {
        return json({
          messages: [{ id: 'm1', content: 'first', timestamp: '2026-05-08T10:02:00.000Z' }],
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/turns?limit=1') return json({ turns: [] });
      if (path === '/api/tasks') {
        return json({
          tasks: [
            { id: 'task-1', execution_type: 'agent', last_run: '2026-05-08T10:03:00.000Z' },
            { id: 'task-2', execution_type: 'agent', last_run: '2026-05-08T10:04:00.000Z' },
          ],
        });
      }
      throw new Error(`unexpected path: ${path}`);
    };

    const source = createHttpAgentDockSource({
      baseUrl: 'http://agentdock.local',
      now: () => new Date('2026-05-08T10:05:00.000Z'),
      fetchImpl,
    });

    const batch = await source.collectObservationBatch({ limit: 1 });

    expect(batch.sessions).toHaveLength(1);
    expect(batch.turns).toHaveLength(1);
    expect(batch.scheduledTaskRuns).toHaveLength(1);
    expect(batch.rawRefs).toHaveLength(1);
    expect(batch.window.cursor).toBe('2026-05-08T10:03:00.000Z');
  });

  it('filters time-scoped message, task, error, and usage observations', async () => {
    const fetchImpl: AgentDockFetch = async (url) => {
      const path = `${new URL(url).pathname}${new URL(url).search}`;
      if (path === '/api/health') return json({ status: 'healthy' });
      if (path === '/api/status') return json({ activeRuntimes: 0, queueLength: 0, sessions: [] });
      if (path === '/api/sessions') {
        return json({
          sessions: {
            'main:flow-1': {
              id: 'main:flow-1',
              created_at: '2026-05-08T09:00:00.000Z',
            },
          },
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/messages?limit=20') {
        return json({
          messages: [
            { id: 'old', content: 'old', timestamp: '2026-05-08T09:30:00.000Z' },
            {
              id: 'new',
              content: 'new',
              timestamp: '2026-05-08T10:30:00.000Z',
              token_usage: { inputTokens: 1, outputTokens: 2 },
            },
          ],
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/turns?limit=20') return json({ turns: [] });
      if (path === '/api/tasks') {
        return json({
          tasks: [
            { id: 'old-task', execution_type: 'agent', last_run: '2026-05-08T09:40:00.000Z' },
            { id: 'new-task', execution_type: 'agent', last_run: '2026-05-08T10:40:00.000Z' },
          ],
        });
      }
      throw new Error(`unexpected path: ${path}`);
    };

    const source = createHttpAgentDockSource({
      baseUrl: 'http://agentdock.local',
      now: () => new Date('2026-05-08T11:00:00.000Z'),
      fetchImpl,
    });

    const batch = await source.collectObservationBatch({ since: '2026-05-08T10:00:00.000Z' });

    expect(batch.window.since).toBe('2026-05-08T10:00:00.000Z');
    expect(batch.turns.map((turn) => turn.id)).toEqual(['agentdock-message-main-flow-1-new']);
    expect(batch.scheduledTaskRuns.map((run) => run.taskId)).toEqual(['new-task']);
    expect(batch.usageRecords).toHaveLength(1);
  });
});
