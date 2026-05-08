import { AgentDockConnectionSchema, type AgentDockConnection } from './connection.js';
import { ObservationBatchSchema, type ObservationBatch } from './observation.js';

const FIXED_NOW = '2026-05-08T04:00:00.000Z';

export interface FakeAgentDockSourceOptions {
  connectionId?: string;
  baseUrl?: string;
  now?: string;
}

export class FakeAgentDockSource {
  readonly connection: AgentDockConnection;
  private readonly now: string;

  constructor(options: FakeAgentDockSourceOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
    this.connection = AgentDockConnectionSchema.parse({
      id: options.connectionId ?? 'fake-agentdock',
      baseUrl: options.baseUrl ?? 'http://127.0.0.1:3000',
      capabilityVersion: 'fake-v1',
      observationSources: [
        {
          kind: 'fake',
          ref: 'fake://agentdock/default',
          readOnly: true,
        },
      ],
      createdAt: this.now,
      updatedAt: this.now,
    });
  }

  collectObservationBatch(): ObservationBatch {
    return ObservationBatchSchema.parse({
      id: `obs-${this.connection.id}-001`,
      connectionId: this.connection.id,
      source: 'fake',
      collectedAt: this.now,
      window: {
        since: '2026-05-08T03:00:00.000Z',
        until: this.now,
        cursor: 'fake-cursor-001',
      },
      sessions: [
        {
          id: 'session-001',
          channel: 'feishu',
          runnerId: 'codex',
          model: 'gpt-5.4',
          profile: 'frontier',
          startedAt: '2026-05-08T03:55:00.000Z',
        },
      ],
      turns: [
        {
          id: 'turn-001',
          sessionId: 'session-001',
          role: 'user',
          contentExcerpt: '请检查 Haro sidecar 架构',
          createdAt: '2026-05-08T03:55:42.000Z',
        },
      ],
      toolCalls: [
        {
          id: 'tool-001',
          sessionId: 'session-001',
          toolName: 'send_message',
          status: 'success',
          startedAt: '2026-05-08T03:56:00.000Z',
          endedAt: '2026-05-08T03:56:01.000Z',
        },
      ],
      scheduledTaskRuns: [
        {
          id: 'task-run-001',
          taskId: 'haro-observe',
          executionType: 'script',
          status: 'success',
          startedAt: '2026-05-08T03:58:00.000Z',
          endedAt: '2026-05-08T03:58:02.000Z',
        },
      ],
      memoryMaintenanceLogs: [
        {
          id: 'memory-001',
          kind: 'wrapup',
          status: 'success',
          startedAt: '2026-05-08T03:59:00.000Z',
          endedAt: '2026-05-08T03:59:03.000Z',
        },
      ],
      runnerErrors: [
        {
          id: 'error-001',
          sessionId: 'session-001',
          runnerId: 'codex',
          code: 'RECOVERABLE_TIMEOUT',
          message: 'fake recoverable timeout',
          recoverable: true,
          occurredAt: '2026-05-08T03:59:30.000Z',
        },
      ],
      usageRecords: [
        {
          id: 'usage-001',
          sessionId: 'session-001',
          model: 'gpt-5.4',
          inputTokens: 1200,
          outputTokens: 300,
          recordedAt: this.now,
        },
      ],
      rawRefs: ['fake://agentdock/raw/session-001'],
      metadata: {
        fixture: true,
      },
    });
  }
}

export function createFakeAgentDockSource(
  options: FakeAgentDockSourceOptions = {},
): FakeAgentDockSource {
  return new FakeAgentDockSource(options);
}
