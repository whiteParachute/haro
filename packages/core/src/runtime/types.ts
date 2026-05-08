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
  /**
   * Historical Haro-owned MemoryFabric compatibility switch.
   *
   * Sidecar-era default is AgentDock-owned memory, so runner executions do not
   * read/write Haro MemoryFabric unless this is explicitly enabled by a legacy
   * caller/test.
   */
  legacyMemory?: boolean;
  retryOfSessionId?: string;
  continueLatestSession?: boolean;
  /**
   * Pin the continuation source to a specific prior session id (FEAT-039 R1
   * `--session`). When set, the runner ignores the "latest completed
   * session for agent+provider" heuristic and resumes from this session's
   * stored `previousResponseId` (or its last `result` event payload).
   * Implies `continueLatestSession=true` regardless of caller setting.
   */
  continueFromSessionId?: string;
  onEvent?: (event: AgentEvent, sessionId: string) => void;
  /**
   * Cooperative cancellation signal (FEAT-033 R10). When aborted, the
   * runner stops the current provider iterator, emits an `aborted` terminal
   * event, marks the session `failed`, and returns. Aborting before / between
   * fallback candidates short-circuits the candidates loop.
   */
  signal?: AbortSignal;
  /**
   * Optional channel that triggered this run (FEAT-032 SessionContext.channelId).
   * Forwarded to the per-session MCP server so `send_message` can detect
   * cross-channel sends and gate them behind operator approval.
   */
  channelId?: string;
  /** Optional caller user id, mirrors channelId for permission/audit context. */
  userId?: string;
}

export interface RunAgentResult {
  sessionId: string;
  ruleId: string;
  provider: string;
  model: string;
  events: readonly AgentEvent[];
  finalEvent: AgentResultEvent | AgentErrorEvent;
}
