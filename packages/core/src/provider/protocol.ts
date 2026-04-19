/**
 * Provider Abstraction Layer — core interfaces shared across Haro providers.
 *
 * Kept intentionally small and Provider-agnostic; concrete adapters live in
 * `packages/provider-*`. The shapes here mirror
 * `specs/provider-protocol.md` — keep them in lockstep.
 */

export type PermissionMode = 'plan' | 'auto' | 'bypass';

export interface AgentSessionContext {
  sessionId: string;
  previousResponseId?: string;
}

export interface AgentQueryParams {
  prompt: string;
  systemPrompt?: string;
  tools?: readonly string[];
  sessionContext?: AgentSessionContext;
  providerOptions?: Record<string, unknown>;
  model?: string;
  permissionMode?: PermissionMode;
}

export interface AgentCapabilities {
  streaming: boolean;
  toolLoop: boolean;
  contextCompaction: boolean;
  contextContinuation?: boolean;
  permissionModes?: readonly PermissionMode[];
  maxContextTokens?: number;
  extended?: Record<string, unknown>;
}

export interface AgentTextEvent {
  type: 'text';
  content: string;
  delta?: boolean;
}

export interface AgentToolCallEvent {
  type: 'tool_call';
  callId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface AgentToolResultEvent {
  type: 'tool_result';
  callId: string;
  result: unknown;
  isError?: boolean;
}

export interface AgentResultEvent {
  type: 'result';
  content: string;
  responseId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}

export type AgentEvent =
  | AgentTextEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentResultEvent
  | AgentErrorEvent;

export interface AgentProvider {
  readonly id: string;
  query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void>;
  capabilities(): AgentCapabilities;
  healthCheck(): Promise<boolean>;
}

/**
 * In-memory provider registry (spec: provider-protocol §Registration). The
 * core package exposes this shape so FEAT-005 Runner and later wiring can
 * resolve providers without importing any concrete adapter.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider '${id}' not registered`);
    return provider;
  }

  tryGet(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly AgentProvider[] {
    return Array.from(this.providers.values());
  }
}
