import type { AgentRegistry, AgentRunner, ProviderRegistry } from '@haro/core';
import type { LoadedConfig } from '@haro/core/config';
import type { ChannelRegistry } from '../channel.js';
import type { WebLogger } from './types.js';

export interface WebRuntime {
  agentRegistry: AgentRegistry;
  runner?: AgentRunner;
  createRunner?: (createSessionId?: () => string) => AgentRunner;
  root?: string;
  projectRoot?: string;
  dbFile?: string;
  providerRegistry?: ProviderRegistry;
  channelRegistry?: ChannelRegistry;
  loaded?: LoadedConfig;
  logger: WebLogger;
  startedAt: number;
}

export function getRunner(runtime: WebRuntime, createSessionId?: () => string): AgentRunner {
  return runtime.createRunner ? runtime.createRunner(createSessionId) : runtime.runner!;
}
