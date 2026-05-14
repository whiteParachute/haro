/**
 * FEAT-034 R1 / G4 — explicit StreamEvent protocol (12 kinds).
 *
 * The pre-FEAT-034 wire format mixed assistant text, reasoning ("thinking"),
 * tool I/O, hook decisions, usage and lifecycle updates into a single delta
 * stream that the front-end had to re-classify by inspection. This module
 * gives the boundary a typed, ordered protocol so the new UX components
 * (ThinkingPanel, ToolTimeline, MessageStream) can render each signal on
 * its own track without ad-hoc parsing.
 *
 * Translators live next to the protocol so the runner / channel bridge can
 * derive structured events from the legacy AgentEvent surface during the
 * transition without forcing every provider to migrate at once.
 */

import type { AgentErrorEvent, AgentEvent, AgentResultEvent } from '../provider/protocol.js';

// ---- 12 kinds (R1 / G4) -----------------------------------------------------

export interface StreamMessageDelta {
  kind: 'message_delta';
  messageId: string;
  delta: string;
}

export interface StreamMessageDone {
  kind: 'message_done';
  messageId: string;
  finalContent: string;
}

export interface StreamThinkingDelta {
  kind: 'thinking_delta';
  messageId: string;
  delta: string;
}

export interface StreamThinkingDone {
  kind: 'thinking_done';
  messageId: string;
  finalContent: string;
}

export interface StreamToolCallStart {
  kind: 'tool_call_start';
  callId: string;
  parentCallId?: string;
  tool: string;
  paramsSummary: string;
}

export interface StreamToolCallEnd {
  kind: 'tool_call_end';
  callId: string;
  status: 'success' | 'error';
  durationMs: number;
  resultSummary?: string;
  errorCode?: string;
}

export interface StreamToolCallError {
  kind: 'tool_call_error';
  callId: string;
  errorCode: string;
  message: string;
  retryable: boolean;
}

export interface StreamHookPre {
  kind: 'hook_pre';
  callId: string;
  hook: string;
  status: 'pending' | 'allowed' | 'blocked';
}

export interface StreamHookPost {
  kind: 'hook_post';
  callId: string;
  hook: string;
  status: 'success' | 'error';
}

export interface StreamUsageUpdate {
  kind: 'usage_update';
  sessionId: string;
  tokens: { input: number; output: number; total: number };
}

export interface StreamSessionStatus {
  kind: 'session_status';
  sessionId: string;
  status: 'idle' | 'running' | 'completed' | 'errored';
}

export interface StreamError {
  kind: 'error';
  code: string;
  message: string;
  recoverable: boolean;
}

export type StreamEvent =
  | StreamMessageDelta
  | StreamMessageDone
  | StreamThinkingDelta
  | StreamThinkingDone
  | StreamToolCallStart
  | StreamToolCallEnd
  | StreamToolCallError
  | StreamHookPre
  | StreamHookPost
  | StreamUsageUpdate
  | StreamSessionStatus
  | StreamError;

export type StreamEventKind = StreamEvent['kind'];

export const STREAM_EVENT_KINDS = [
  'message_delta',
  'message_done',
  'thinking_delta',
  'thinking_done',
  'tool_call_start',
  'tool_call_end',
  'tool_call_error',
  'hook_pre',
  'hook_post',
  'usage_update',
  'session_status',
  'error',
] as const satisfies readonly StreamEventKind[];

// ---- type guards (kept tight for AC7 unit coverage) -------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return isString(value) && (allowed as readonly string[]).includes(value);
}

export function isStreamMessageDelta(value: unknown): value is StreamMessageDelta {
  return (
    isObject(value) && value.kind === 'message_delta' && isString(value.messageId) && isString(value.delta)
  );
}

export function isStreamMessageDone(value: unknown): value is StreamMessageDone {
  return (
    isObject(value) && value.kind === 'message_done' && isString(value.messageId) && isString(value.finalContent)
  );
}

export function isStreamThinkingDelta(value: unknown): value is StreamThinkingDelta {
  return (
    isObject(value) && value.kind === 'thinking_delta' && isString(value.messageId) && isString(value.delta)
  );
}

export function isStreamThinkingDone(value: unknown): value is StreamThinkingDone {
  return (
    isObject(value) && value.kind === 'thinking_done' && isString(value.messageId) && isString(value.finalContent)
  );
}

export function isStreamToolCallStart(value: unknown): value is StreamToolCallStart {
  return (
    isObject(value) &&
    value.kind === 'tool_call_start' &&
    isString(value.callId) &&
    isString(value.tool) &&
    isString(value.paramsSummary) &&
    isOptionalString(value.parentCallId)
  );
}

export function isStreamToolCallEnd(value: unknown): value is StreamToolCallEnd {
  return (
    isObject(value) &&
    value.kind === 'tool_call_end' &&
    isString(value.callId) &&
    isOneOf(['success', 'error'], value.status) &&
    isFiniteNumber(value.durationMs) &&
    isOptionalString(value.resultSummary) &&
    isOptionalString(value.errorCode)
  );
}

export function isStreamToolCallError(value: unknown): value is StreamToolCallError {
  return (
    isObject(value) &&
    value.kind === 'tool_call_error' &&
    isString(value.callId) &&
    isString(value.errorCode) &&
    isString(value.message) &&
    typeof value.retryable === 'boolean'
  );
}

export function isStreamHookPre(value: unknown): value is StreamHookPre {
  return (
    isObject(value) &&
    value.kind === 'hook_pre' &&
    isString(value.callId) &&
    isString(value.hook) &&
    isOneOf(['pending', 'allowed', 'blocked'], value.status)
  );
}

export function isStreamHookPost(value: unknown): value is StreamHookPost {
  return (
    isObject(value) &&
    value.kind === 'hook_post' &&
    isString(value.callId) &&
    isString(value.hook) &&
    isOneOf(['success', 'error'], value.status)
  );
}

export function isStreamUsageUpdate(value: unknown): value is StreamUsageUpdate {
  return (
    isObject(value) &&
    value.kind === 'usage_update' &&
    isString(value.sessionId) &&
    isObject(value.tokens) &&
    isFiniteNumber((value.tokens as { input: unknown }).input) &&
    isFiniteNumber((value.tokens as { output: unknown }).output) &&
    isFiniteNumber((value.tokens as { total: unknown }).total)
  );
}

export function isStreamSessionStatus(value: unknown): value is StreamSessionStatus {
  return (
    isObject(value) &&
    value.kind === 'session_status' &&
    isString(value.sessionId) &&
    isOneOf(['idle', 'running', 'completed', 'errored'], value.status)
  );
}

export function isStreamError(value: unknown): value is StreamError {
  return (
    isObject(value) &&
    value.kind === 'error' &&
    isString(value.code) &&
    isString(value.message) &&
    typeof value.recoverable === 'boolean'
  );
}

export function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    isStreamMessageDelta(value) ||
    isStreamMessageDone(value) ||
    isStreamThinkingDelta(value) ||
    isStreamThinkingDone(value) ||
    isStreamToolCallStart(value) ||
    isStreamToolCallEnd(value) ||
    isStreamToolCallError(value) ||
    isStreamHookPre(value) ||
    isStreamHookPost(value) ||
    isStreamUsageUpdate(value) ||
    isStreamSessionStatus(value) ||
    isStreamError(value)
  );
}

// ---- AgentEvent → StreamEvent translator (transitional) ---------------------

export interface AgentEventStreamContext {
  sessionId: string;
  /** messageId for the assistant turn currently being streamed. */
  messageId: string;
  /** Override clock for tests. */
  now?: () => number;
  /** Cache of tool_call_start timestamps keyed by callId so end events can
   * compute durationMs. The runner owns this map for a single session. */
  toolStartedAt: Map<string, number>;
}

/**
 * Translate one AgentEvent into 1..n StreamEvents. The function is pure: the
 * caller threads `ctx.toolStartedAt` so tool_call_end can compute durationMs
 * without keeping module-level state.
 */
export function agentEventToStream(
  event: AgentEvent,
  ctx: AgentEventStreamContext,
): StreamEvent[] {
  const now = ctx.now ?? (() => Date.now());
  switch (event.type) {
    case 'text': {
      if (event.delta) {
        return [{ kind: 'message_delta', messageId: ctx.messageId, delta: event.content }];
      }
      return [{ kind: 'message_done', messageId: ctx.messageId, finalContent: event.content }];
    }
    case 'tool_call': {
      ctx.toolStartedAt.set(event.callId, now());
      return [
        {
          kind: 'tool_call_start',
          callId: event.callId,
          tool: event.toolName,
          paramsSummary: summarizeParams(event.toolInput),
        },
      ];
    }
    case 'tool_result': {
      const startedAt = ctx.toolStartedAt.get(event.callId);
      const durationMs = startedAt !== undefined ? Math.max(0, now() - startedAt) : 0;
      ctx.toolStartedAt.delete(event.callId);
      const status: 'success' | 'error' = event.isError ? 'error' : 'success';
      const summary = summarizeResult(event.result);
      return [
        {
          kind: 'tool_call_end',
          callId: event.callId,
          status,
          durationMs,
          ...(summary ? { resultSummary: summary } : {}),
        },
      ];
    }
    case 'result':
      return resultStreamEvents(event, ctx.sessionId);
    case 'error':
      return errorStreamEvents(event, ctx.sessionId);
  }
}

function resultStreamEvents(event: AgentResultEvent, sessionId: string): StreamEvent[] {
  // FEAT-034 codex review B1: do NOT emit message_done from result here. The
  // executor still routes result.content through the channel's legacy `agent`
  // envelope path so old clients keep working; structured clients consume
  // message_delta + message_done driven by AgentTextEvent, plus the
  // session-level usage/status events below. Emitting message_done from
  // result.content would double-write the content (legacy + structured) and
  // produce duplicated final-message bubbles.
  const out: StreamEvent[] = [
    { kind: 'session_status', sessionId, status: 'completed' },
  ];
  if (event.usage) {
    out.unshift({
      kind: 'usage_update',
      sessionId,
      tokens: {
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
        total: event.usage.inputTokens + event.usage.outputTokens,
      },
    });
  }
  return out;
}

function errorStreamEvents(event: AgentErrorEvent, sessionId: string): StreamEvent[] {
  return [
    {
      kind: 'error',
      code: event.code,
      message: event.message,
      recoverable: event.retryable,
    },
    { kind: 'session_status', sessionId, status: 'errored' },
  ];
}

function summarizeParams(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  } catch {
    return '<unserializable>';
  }
}

function summarizeResult(result: unknown): string | undefined {
  if (result === null || result === undefined) return undefined;
  const text = typeof result === 'string' ? result : (() => {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  })();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

// ---- helpers for stream-capable hosts --------------------------------------

/** Group structured events into per-message buckets so a virtualized list can
 *  render each MessageBubble independently. */
export interface MessageBucket {
  messageId: string;
  message: string;
  thinking: string;
  toolCalls: ToolCallNode[];
}

export interface ToolCallNode {
  callId: string;
  parentCallId?: string;
  tool: string;
  paramsSummary: string;
  status: 'pending' | 'success' | 'error';
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  resultSummary?: string;
  hookPre?: 'pending' | 'allowed' | 'blocked';
  hookPost?: 'success' | 'error';
  hookName?: string;
  startedAt: number;
}

export interface BucketReducerOptions {
  now?: () => number;
}

export function applyStreamEventToBucket(
  bucket: MessageBucket,
  event: StreamEvent,
  options: BucketReducerOptions = {},
): MessageBucket {
  const now = options.now ?? (() => Date.now());
  switch (event.kind) {
    case 'message_delta':
      if (event.messageId !== bucket.messageId) return bucket;
      return { ...bucket, message: bucket.message + event.delta };
    case 'message_done':
      if (event.messageId !== bucket.messageId) return bucket;
      return { ...bucket, message: event.finalContent };
    case 'thinking_delta':
      if (event.messageId !== bucket.messageId) return bucket;
      return { ...bucket, thinking: bucket.thinking + event.delta };
    case 'thinking_done':
      if (event.messageId !== bucket.messageId) return bucket;
      return { ...bucket, thinking: event.finalContent };
    case 'tool_call_start': {
      const node: ToolCallNode = {
        callId: event.callId,
        ...(event.parentCallId ? { parentCallId: event.parentCallId } : {}),
        tool: event.tool,
        paramsSummary: event.paramsSummary,
        status: 'pending',
        startedAt: now(),
      };
      return { ...bucket, toolCalls: [...bucket.toolCalls, node] };
    }
    case 'tool_call_end': {
      const next = bucket.toolCalls.map((node) =>
        node.callId === event.callId
          ? {
              ...node,
              status: event.status,
              durationMs: event.durationMs,
              ...(event.resultSummary !== undefined ? { resultSummary: event.resultSummary } : {}),
              ...(event.errorCode !== undefined ? { errorCode: event.errorCode } : {}),
            }
          : node,
      );
      return { ...bucket, toolCalls: next };
    }
    case 'tool_call_error': {
      const next: ToolCallNode[] = bucket.toolCalls.map((node) =>
        node.callId === event.callId
          ? {
              ...node,
              status: 'error' as const,
              errorCode: event.errorCode,
              errorMessage: event.message,
            }
          : node,
      );
      return { ...bucket, toolCalls: next };
    }
    case 'hook_pre': {
      const next = bucket.toolCalls.map((node) =>
        node.callId === event.callId ? { ...node, hookPre: event.status, hookName: event.hook } : node,
      );
      return { ...bucket, toolCalls: next };
    }
    case 'hook_post': {
      const next = bucket.toolCalls.map((node) =>
        node.callId === event.callId ? { ...node, hookPost: event.status, hookName: event.hook } : node,
      );
      return { ...bucket, toolCalls: next };
    }
    case 'usage_update':
    case 'session_status':
    case 'error':
      return bucket;
  }
}

export function emptyBucket(messageId: string): MessageBucket {
  return { messageId, message: '', thinking: '', toolCalls: [] };
}
