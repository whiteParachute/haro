import type { AgentConfig } from '../agent/types.js';
import type { HaroConfig } from '../config/schema.js';
import type {
  AgentErrorEvent,
  AgentEvent,
  AgentProvider,
  AgentResultEvent,
} from '../provider/protocol.js';

export type ModelSelectionStrategy =
  | 'provider-default'
  | 'quality-priority'
  | 'cost-priority'
  | 'largest-context';

export interface SelectionTarget {
  provider: string;
  model?: string;
  modelSelection?: ModelSelectionStrategy;
}

export interface SelectionRuleMatch {
  tags?: string[];
  promptPattern?: string;
  estimatedTokens?: {
    min?: number;
    max?: number;
  };
  agentId?: string;
}

export interface SelectionRule {
  id: string;
  description?: string;
  priority: number;
  match: SelectionRuleMatch;
  select: SelectionTarget;
  fallback?: SelectionTarget[];
}

export interface SelectionContext {
  task: string;
  agent: AgentConfig;
  providerRegistry: {
    get(id: string): AgentProvider;
    tryGet(id: string): AgentProvider | undefined;
  };
  root?: string;
  projectRoot?: string;
  config?: HaroConfig;
}

export interface ResolvedSelectionCandidate {
  provider: string;
  model: string;
  source: SelectionTarget;
}

export interface ResolvedSelection {
  ruleId: string;
  primary: ResolvedSelectionCandidate;
  fallbacks: readonly ResolvedSelectionCandidate[];
}

export interface RunAgentInput {
  task: string;
  agentId: string;
  provider?: string;
  model?: string;
  noMemory?: boolean;
  retryOfSessionId?: string;
  continueLatestSession?: boolean;
}

export interface RunAgentResult {
  sessionId: string;
  ruleId: string;
  provider: string;
  model: string;
  events: readonly AgentEvent[];
  finalEvent: AgentResultEvent | AgentErrorEvent;
}
