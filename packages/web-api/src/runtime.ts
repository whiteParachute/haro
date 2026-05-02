import type { AgentRegistry, AgentRunner, EvolutionAssetRegistry, HaroPaths, ProviderRegistry } from '@haro/core';
import type { LoadedConfig } from '@haro/core/config';
import type { SkillsManager } from '@haro/skills';
import type { ChannelRegistry } from '@haro/channel';
import type { WebLogger } from './types.js';

/**
 * Loose contract for a diagnostics runner callback. The concrete shape of the
 * input/output is owned by the host (typically `@haro/cli`'s diagnostics.ts);
 * web-api only forwards the result, so types stay permissive to avoid a
 * circular dependency on cli.
 */
export interface DiagnosticsRunInput {
  mode: 'doctor' | 'setup';
  profile: 'dev' | 'global' | 'systemd';
  paths: HaroPaths;
  root?: string;
  loaded: LoadedConfig;
  providerRegistry: ProviderRegistry;
  channelRegistry: ChannelRegistry;
}

export type DiagnosticsRunner = (input: DiagnosticsRunInput) => Promise<Record<string, unknown>>;

export interface WebRuntime {
  agentRegistry: AgentRegistry;
  reloadAgentRegistry?: () => Promise<AgentRegistry>;
  runner?: AgentRunner;
  createRunner?: (createSessionId?: () => string) => AgentRunner;
  root?: string;
  projectRoot?: string;
  dbFile?: string;
  providerRegistry?: ProviderRegistry;
  channelRegistry?: ChannelRegistry;
  skillsManager?: SkillsManager;
  evolutionAssetRegistry?: EvolutionAssetRegistry | false;
  skillAssetAuditSupported?: boolean;
  loaded?: LoadedConfig;
  logger: WebLogger;
  startedAt: number;
  /**
   * Optional diagnostics runner injected by the host (CLI). When absent, the
   * doctor route returns a structured "diagnostics-runner-not-configured"
   * payload instead of crashing.
   */
  runDiagnostics?: DiagnosticsRunner;
}

export function getRunner(runtime: WebRuntime, createSessionId?: () => string): AgentRunner {
  return runtime.createRunner ? runtime.createRunner(createSessionId) : runtime.runner!;
}
