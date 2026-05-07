/**
 * Public type surface for the MCP tools layer (FEAT-032).
 *
 * The layer wraps four builtin tools (send_message / memory_query /
 * memory_remember / schedule_task) behind a JSON-RPC-over-stdio MCP server.
 * Each agent session spawns its own server subprocess (D1) so the per-session
 * SessionContext below is the authoritative scope for permission decisions.
 */

import type { z, ZodTypeAny } from 'zod';
import type { ChannelRegistry } from '@haro/channel';
import type { EvolutionAssetRegistry, MemoryFabric } from '@haro/core';
import type { ServiceContext } from '@haro/core/services';

/** Per-session execution scope handed to tools and the permission layer. */
export interface SessionContext {
  sessionId: string;
  agentId: string;
  /** Channel that triggered the agent session, if any. CLI sessions have no channelId. */
  channelId?: string;
  /** Caller user id when the surrounding channel exposes one (FEAT-031 web sessions etc). */
  userId?: string;
}

/** Live integrations the tools depend on. Constructed once per server lifetime. */
export interface ToolDependencies {
  channels: ChannelRegistry;
  memory: MemoryFabric;
  evolution: EvolutionAssetRegistry;
  serviceContext: ServiceContext;
  /** Database used to write tool_invocation_log rows. */
  auditDbFile?: string;
  /** Override clock for tests. */
  now?: () => Date;
}

export type ToolDecision = 'allowed' | 'denied' | 'needs-approval';
export type ToolResultStatus = 'success' | 'error' | 'pending';

export interface ToolErrorPayload {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  remediation?: string;
}

export type ToolErrorCode =
  | 'PERMISSION_DENIED'
  | 'NEEDS_APPROVAL'
  | 'INVALID_PARAMS'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_DISABLED'
  | 'TOOL_TIMEOUT'
  | 'INTERNAL_ERROR';

export interface ToolSuccess<T> {
  ok: true;
  value: T;
}

export interface ToolFailure {
  ok: false;
  error: ToolErrorPayload;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface ToolDefinition<TInput extends ZodTypeAny, TOutput> {
  name: string;
  description: string;
  inputSchema: TInput;
  /**
   * Per-tool timeout (ms). FEAT-032 D2 mandates an explicit value at registration
   * time. Registry rejects tools omitting this field.
   */
  timeoutMs: number;
  execute(
    params: z.infer<TInput>,
    ctx: ToolExecutionContext,
  ): Promise<TOutput>;
}

export interface ToolExecutionContext {
  session: SessionContext;
  deps: ToolDependencies;
  now: () => Date;
  /**
   * Cooperative cancellation signal. The registry aborts this when the
   * tool's `timeoutMs` fires so well-behaved tools (those that thread the
   * signal through downstream HTTP / DB calls) can stop early and avoid
   * doubling side effects. Tools that ignore the signal still finish in the
   * background, but the caller has already received `TOOL_TIMEOUT`.
   */
  signal: AbortSignal;
}

import type { JsonSchema } from './json-schema.js';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  timeoutMs: number;
}

export interface PermissionDecisionInput {
  toolName: string;
  params: unknown;
  session: SessionContext;
  deps: ToolDependencies;
}

export interface PermissionDecisionOutput {
  decision: ToolDecision;
  reason?: string;
}

export interface ToolInvocationAudit {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  paramsHash: string;
  decision: ToolDecision;
  resultStatus: ToolResultStatus;
  latencyMs: number | null;
  errorCode: ToolErrorCode | null;
  invokedAt: number;
}
