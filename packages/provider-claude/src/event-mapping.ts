import type {
  AgentErrorEvent,
  AgentEvent,
  AgentResultEvent,
  AgentToolCallEvent,
} from '@haro/core/provider';
import type { SdkEvent } from './sdk-types.js';

/**
 * FEAT-002 R3 — map SDK events onto Haro's AgentEvent stream.
 *
 * Source of truth for the mapping table:
 *   specs/phase-0/FEAT-002-claude-provider.md §5 "事件映射"
 *
 * Why this is a stateful mapper rather than a pure function: the SDK splits
 * tool-use calls across multiple events (`content_block_start` → N ×
 * `input_json_delta` → `content_block_stop`). Emitting the AgentToolCallEvent
 * on `content_block_start` loses the actual arguments, so we buffer and emit
 * on stop. `result`/`message_stop` produce the final AgentResultEvent.
 *
 * Unknown event types are silently dropped — forward-compat with SDK upgrades
 * is an explicit design goal.
 */
export interface SdkEventMapper {
  push(ev: SdkEvent): AgentEvent[];
  flush(): AgentEvent[];
}

export function createSdkEventMapper(): SdkEventMapper {
  interface PendingToolUse {
    id: string;
    name: string;
    input: Record<string, unknown>;
    partialJson: string;
  }
  const pendingByIndex = new Map<number, PendingToolUse>();

  function toolCallFromBlock(block: { id?: string; name?: string; input?: Record<string, unknown> } | undefined): AgentToolCallEvent | undefined {
    if (!block?.id || !block?.name) return undefined;
    return {
      type: 'tool_call',
      callId: block.id,
      toolName: block.name,
      toolInput: block.input ?? {},
    };
  }

  return {
    push(ev: SdkEvent): AgentEvent[] {
      const out: AgentEvent[] = [];
      const type = (ev as { type?: string }).type;
      switch (type) {
        case 'text': {
          const text = (ev as { text?: string }).text ?? '';
          if (text.length > 0) out.push({ type: 'text', content: text, delta: false });
          break;
        }
        case 'content_block_start': {
          const block = (ev as { content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> } }).content_block;
          const index = (ev as { index?: number }).index ?? 0;
          if (block?.type === 'tool_use' && block.id && block.name) {
            pendingByIndex.set(index, {
              id: block.id,
              name: block.name,
              input: block.input ?? {},
              partialJson: '',
            });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = (ev as { delta?: { type?: string; text?: string; partial_json?: string } }).delta;
          const index = (ev as { index?: number }).index ?? 0;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
            out.push({ type: 'text', content: delta.text, delta: true });
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const pending = pendingByIndex.get(index);
            if (pending) pending.partialJson += delta.partial_json;
          }
          break;
        }
        case 'content_block_stop': {
          const index = (ev as { index?: number }).index ?? 0;
          const pending = pendingByIndex.get(index);
          if (pending) {
            pendingByIndex.delete(index);
            const parsed = parsePartialJson(pending.partialJson);
            const mergedInput = { ...pending.input, ...(parsed ?? {}) };
            out.push({
              type: 'tool_call',
              callId: pending.id,
              toolName: pending.name,
              toolInput: mergedInput,
            });
          }
          break;
        }
        case 'tool_use': {
          const call = toolCallFromBlock(ev as { id?: string; name?: string; input?: Record<string, unknown> });
          if (call) out.push(call);
          break;
        }
        case 'tool_result': {
          const { tool_use_id, content, is_error } = ev as { tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (tool_use_id) {
            const mapped: AgentEvent = { type: 'tool_result', callId: tool_use_id, result: content };
            if (is_error === true) mapped.isError = true;
            out.push(mapped);
          }
          break;
        }
        case 'message_stop':
        case 'result': {
          // Real SDK emits `result` events shaped either:
          //   { type: 'result', subtype: 'success', result: string, session_id, usage }
          //   { type: 'result', is_error: true, errors: string[] }
          // We also accept the older `content` / `response_id` naming since
          // the mock tests rely on them. Anything marked `is_error` routes
          // through AgentErrorEvent instead of a silent empty result.
          const raw = ev as {
            content?: string;
            result?: unknown;
            response_id?: string;
            session_id?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
            is_error?: boolean;
            subtype?: string;
            errors?: string[];
          };
          if (raw.is_error === true || raw.subtype === 'error_during_execution' || raw.subtype === 'error_max_turns') {
            const message = Array.isArray(raw.errors) ? raw.errors.join('; ') : typeof raw.result === 'string' ? raw.result : 'Claude SDK returned is_error';
            const err: AgentErrorEvent = {
              type: 'error',
              code: raw.subtype ?? 'result_error',
              message,
              retryable: false,
            };
            out.push(err);
            break;
          }
          const text = typeof raw.result === 'string'
            ? raw.result
            : typeof raw.content === 'string'
              ? raw.content
              : '';
          const mapped: AgentResultEvent = { type: 'result', content: text };
          if (raw.response_id) mapped.responseId = raw.response_id;
          if (raw.usage) {
            mapped.usage = {
              inputTokens: raw.usage.input_tokens ?? 0,
              outputTokens: raw.usage.output_tokens ?? 0,
            };
          }
          out.push(mapped);
          break;
        }
        case 'error': {
          const inner = (ev as { error?: { type?: string; message?: string } }).error ?? {};
          const code = inner.type ?? (ev as { code?: string }).code ?? 'unknown_error';
          const message = inner.message ?? (ev as { message?: string }).message ?? 'unknown Claude SDK error';
          out.push({ type: 'error', code, message, retryable: classifyRetryable(code) });
          break;
        }
        default:
          break;
      }
      return out;
    },

    flush(): AgentEvent[] {
      // Emit any tool_use blocks we still hold when the stream ends abruptly,
      // so upstream code sees a best-effort tool_call rather than silently
      // losing the intent.
      const out: AgentEvent[] = [];
      for (const [index, pending] of pendingByIndex.entries()) {
        pendingByIndex.delete(index);
        const parsed = parsePartialJson(pending.partialJson);
        const mergedInput = { ...pending.input, ...(parsed ?? {}) };
        out.push({ type: 'tool_call', callId: pending.id, toolName: pending.name, toolInput: mergedInput });
      }
      return out;
    },
  };
}

/**
 * Single-shot convenience: process one SDK event and return the first mapped
 * AgentEvent (or undefined). Retained for the unit tests that check pure
 * mapping without exercising the tool-use state machine.
 */
export function mapSdkEvent(ev: SdkEvent): AgentEvent | undefined {
  const mapper = createSdkEventMapper();
  const mapped = mapper.push(ev);
  return mapped[0];
}

function parsePartialJson(s: string): Record<string, unknown> | undefined {
  const trimmed = s.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore — incomplete JSON just discards the delta merge */
  }
  return undefined;
}

function classifyRetryable(code: string): boolean {
  const retryable = new Set([
    'overloaded_error',
    'rate_limit_error',
    'api_error',
    'timeout',
    'ECONNRESET',
    'ETIMEDOUT',
  ]);
  return retryable.has(code);
}
