import type { AgentRegistry, AgentRunner } from '@haro/core';
import type { WebLogger } from './types.js';

export interface WebRuntime {
  agentRegistry: AgentRegistry;
  runner?: AgentRunner;
  createRunner?: (createSessionId?: () => string) => AgentRunner;
  root?: string;
  dbFile?: string;
  logger: WebLogger;
  startedAt: number;
}

export function getRunner(runtime: WebRuntime, createSessionId?: () => string): AgentRunner {
  return runtime.createRunner ? runtime.createRunner(createSessionId) : runtime.runner!;
}
