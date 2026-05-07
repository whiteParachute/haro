import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelRegistry } from '@haro/channel';
import type {
  ChannelCapabilities,
  ChannelContext,
  ChannelDoctorResult,
  ChannelLogger,
  ManagedChannel,
  OutboundMessage,
} from '@haro/channel';
import { initHaroDatabase } from '@haro/core/db';
import { createMemoryFabric, type MemoryFabric } from '@haro/core/memory';
import { createEvolutionAssetRegistry } from '@haro/core/evolution';

import { ToolInvocationAuditWriter } from '../src/audit.js';
import { createDefaultRegistry } from '../src/index.js';
import type { SessionContext, ToolDependencies } from '../src/types.js';

export interface TestEnv {
  root: string;
  dbFile: string;
  memoryDir: string;
  cleanup(): void;
  channels: ChannelRegistry;
  audit: ToolInvocationAuditWriter;
  memory: MemoryFabric;
  evolution: ReturnType<typeof createEvolutionAssetRegistry>;
  fakeChannel: FakeChannel;
  buildDeps(): ToolDependencies;
  buildSession(overrides?: Partial<SessionContext>): SessionContext;
  buildRegistry(): ReturnType<typeof createDefaultRegistry>;
}

const noopLogger: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class FakeChannel implements ManagedChannel {
  readonly id: string;
  readonly outbound: Array<{ sessionId: string; msg: OutboundMessage }> = [];
  shouldFail = false;

  constructor(id: string) {
    this.id = id;
  }

  async start(_ctx: ChannelContext): Promise<void> {
    /* no-op */
  }
  async stop(): Promise<void> {
    /* no-op */
  }
  async send(sessionId: string, msg: OutboundMessage): Promise<void> {
    if (this.shouldFail) throw new Error(`fake-channel ${this.id} configured to fail`);
    this.outbound.push({ sessionId, msg });
  }
  capabilities(): ChannelCapabilities {
    return {
      streaming: true,
      richText: true,
      attachments: false,
      threading: false,
      requiresWebhook: false,
    };
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async doctor(): Promise<ChannelDoctorResult> {
    return { ok: true, message: 'fake' };
  }
}

export function setupEnv(): TestEnv {
  const root = mkdtempSync(join(tmpdir(), 'haro-mcp-tools-'));
  const dbFile = join(root, 'haro.db');
  const memoryDir = join(root, 'memory');
  initHaroDatabase({ dbFile });
  const audit = new ToolInvocationAuditWriter({ dbFile });
  const channels = new ChannelRegistry();
  const fakeChannel = new FakeChannel('fake-im');
  channels.register({
    channel: fakeChannel,
    enabled: true,
    source: 'package',
    displayName: 'Fake IM',
  });
  const memory = createMemoryFabric({ root: memoryDir, dbFile });
  const evolution = createEvolutionAssetRegistry({ dbFile });

  function buildDeps(): ToolDependencies {
    return {
      channels,
      memory,
      evolution,
      serviceContext: { root, dbFile },
    };
  }

  function buildSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      sessionId: 'test-session-1',
      agentId: 'default',
      channelId: 'fake-im',
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
    channels,
    audit,
    memory,
    evolution,
    fakeChannel,
    buildDeps,
    buildSession,
    buildRegistry,
  };
}

export { noopLogger };
