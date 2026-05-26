import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHaroDatabase } from '@haro/core/db';
import { createMemoryFabric, type MemoryFabric } from '@haro/core/memory';
import { createEvolutionAssetRegistry } from '@haro/core/evolution';

import { ToolInvocationAuditWriter } from '../src/audit.js';
import { createDefaultRegistry } from '../src/index.js';
import type {
  AgentDockMessageGateway,
  AgentDockSendMessageInput,
  AgentDockSendMessageResult,
  SessionContext,
  ToolDependencies,
} from '../src/types.js';

export interface TestEnv {
  root: string;
  dbFile: string;
  memoryDir: string;
  cleanup(): void;
  messaging: FakeAgentDockMessageGateway;
  audit: ToolInvocationAuditWriter;
  memory: MemoryFabric;
  evolution: ReturnType<typeof createEvolutionAssetRegistry>;
  buildDeps(): ToolDependencies;
  buildSession(overrides?: Partial<SessionContext>): SessionContext;
  buildRegistry(): ReturnType<typeof createDefaultRegistry>;
}

export class FakeAgentDockMessageGateway implements AgentDockMessageGateway {
  readonly outbound: AgentDockSendMessageInput[] = [];
  shouldFail = false;

  async sendMessage(input: AgentDockSendMessageInput): Promise<AgentDockSendMessageResult> {
    if (this.shouldFail) throw new Error('fake AgentDock messaging gateway configured to fail');
    this.outbound.push(input);
    return {
      status: 'queued',
      targetChannel: input.channel,
      messageId: `fake-agentdock-message-${this.outbound.length}`,
    };
  }
}

export function setupEnv(): TestEnv {
  const root = mkdtempSync(join(tmpdir(), 'haro-mcp-tools-'));
  const dbFile = join(root, 'haro.db');
  const memoryDir = join(root, 'memory');
  initHaroDatabase({ dbFile });
  const audit = new ToolInvocationAuditWriter({ dbFile });
  const messaging = new FakeAgentDockMessageGateway();
  const memory = createMemoryFabric({ root: memoryDir, dbFile });
  const evolution = createEvolutionAssetRegistry({ dbFile });

  function buildDeps(): ToolDependencies {
    return {
      messaging,
      memory,
      evolution,
      serviceContext: { root, dbFile },
    };
  }

  function buildSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      sessionId: 'test-session-1',
      agentId: 'default',
      channelId: 'feishu:oc_fake',
      ...overrides,
    };
  }

  function buildRegistry(): ReturnType<typeof createDefaultRegistry> {
    return createDefaultRegistry({ audit });
  }

  function cleanup(): void {
    audit.close();
    if ('close' in memory && typeof memory.close === 'function') memory.close();
    rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    dbFile,
    memoryDir,
    cleanup,
    messaging,
    audit,
    memory,
    evolution,
    buildDeps,
    buildSession,
    buildRegistry,
  };
}
