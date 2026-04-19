/**
 * Minimal structural types describing the subset of
 * `@anthropic-ai/claude-agent-sdk` that ClaudeProvider talks to. We keep them
 * local so the provider compiles and unit-tests run without the SDK being
 * installed — the SDK only needs to resolve at *runtime* when `@live` tests
 * or production runs fire. Mocks for unit tests conform to this same shape.
 *
 * When the SDK evolves (new event variants, renamed options), update this
 * file; ClaudeProvider then gets type feedback automatically.
 */

export interface SdkContentBlockTextDelta {
  type: 'text_delta';
  text: string;
}

export type SdkContentBlockDelta = SdkContentBlockTextDelta | { type: string; [k: string]: unknown };

export interface SdkContentBlockDeltaEvent {
  type: 'content_block_delta';
  index?: number;
  delta: SdkContentBlockDelta;
}

export interface SdkContentBlockStartEvent {
  type: 'content_block_start';
  index?: number;
  content_block: {
    type: 'text' | 'tool_use' | string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  };
}

export interface SdkMessageStopEvent {
  type: 'message_stop';
  response_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface SdkToolUseEvent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface SdkToolResultEvent {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface SdkErrorEvent {
  type: 'error';
  error?: { type?: string; message?: string };
  code?: string;
  message?: string;
}

export interface SdkResultEvent {
  type: 'result';
  content?: string;
  response_id?: string;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface SdkTextEvent {
  type: 'text';
  text: string;
}

/**
 * Union of events our mapper knows how to translate. Unknown event types are
 * ignored silently (with a debug log) so an SDK upgrade introducing new
 * passthrough events does not crash Haro — the spec explicitly allows
 * forward-compat here.
 */
export type SdkEvent =
  | SdkContentBlockDeltaEvent
  | SdkContentBlockStartEvent
  | SdkMessageStopEvent
  | SdkToolUseEvent
  | SdkToolResultEvent
  | SdkErrorEvent
  | SdkResultEvent
  | SdkTextEvent
  | { type: string; [k: string]: unknown };

export interface SdkQueryOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  permissionMode?: 'plan' | 'auto' | 'bypass';
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  sessionId?: string;
  resume?: string;
  [k: string]: unknown;
}

export type SdkQueryFn = (
  options: SdkQueryOptions,
) => AsyncIterable<SdkEvent> | AsyncGenerator<SdkEvent>;
