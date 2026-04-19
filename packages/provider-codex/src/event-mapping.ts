import type { AgentEvent, AgentResultEvent } from '@haro/core/provider';
import type { SdkThreadEvent, SdkThreadItem } from './sdk-types.js';
import { mapCodexError } from './error-mapping.js';

/**
 * FEAT-003 R3 — translate one Codex thread's `runStreamed` events into the
 * Haro `AgentEvent` stream.
 *
 * Codex emits an "item" lifecycle (`item.started` → `item.updated`* →
 * `item.completed`) whose terminal state we forward; intermediate updates
 * are skipped to avoid double-counting work that hasn't yet finalized.
 *
 * The terminal `turn.completed` carries the response usage and is paired
 * with the most recent `agent_message` to form an AgentResultEvent. The
 * thread id (captured from `thread.started`) is forwarded as `responseId`
 * so FEAT-005 Runner can persist it under `session_events.response_id`.
 */
export interface CodexEventMapper {
  push(ev: SdkThreadEvent): AgentEvent[];
  flush(): AgentEvent[];
}

export interface CodexMapperOptions {
  /**
   * Pre-existing thread id when the caller resumed a thread. The SDK does
   * not always re-emit `thread.started` on resume, so the Provider injects
   * the resumed id up front to keep the AgentResultEvent.responseId
   * populated for the next turn.
   */
  initialThreadId?: string | null;
}

export function createCodexEventMapper(opts: CodexMapperOptions = {}): CodexEventMapper {
  let threadId: string | null = opts.initialThreadId ?? null;
  let lastAgentMessage = '';
  let resultEmitted = false;

  function emitResultFor(usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  } | undefined): AgentResultEvent {
    const out: AgentResultEvent = {
      type: 'result',
      content: lastAgentMessage,
    };
    if (threadId) out.responseId = threadId;
    if (usage) {
      out.usage = {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      };
    }
    resultEmitted = true;
    return out;
  }

  function handleTerminalItem(item: SdkThreadItem, out: AgentEvent[]): void {
    switch (item.type) {
      case 'agent_message': {
        if (typeof item.text === 'string' && item.text.length > 0) {
          lastAgentMessage = item.text;
          // Codex is non-streaming (capabilities.streaming = false). We
          // emit one consolidated text event per agent_message so callers
          // that only listen for text still see content even when no
          // turn.completed comes (e.g. abort).
          out.push({ type: 'text', content: item.text, delta: false });
        }
        break;
      }
      case 'reasoning': {
        // Reasoning summaries are useful for logging but not part of the
        // public AgentEvent surface (which only has text/tool/result/err).
        break;
      }
      case 'command_execution': {
        // Treat shell exec as a tool_call/tool_result pair so downstream
        // consumers can audit. Codex does not give us a separate call_id;
        // the item id is unique within the thread and is reused.
        out.push({
          type: 'tool_call',
          callId: item.id,
          toolName: 'codex.command_execution',
          toolInput: { command: item.command },
        });
        out.push({
          type: 'tool_result',
          callId: item.id,
          result: {
            output: item.aggregated_output,
            exit_code: item.exit_code,
            status: item.status,
          },
          isError: item.status === 'failed',
        });
        break;
      }
      case 'file_change': {
        out.push({
          type: 'tool_call',
          callId: item.id,
          toolName: 'codex.file_change',
          toolInput: { changes: item.changes },
        });
        out.push({
          type: 'tool_result',
          callId: item.id,
          result: { status: item.status, changes: item.changes },
          isError: item.status === 'failed',
        });
        break;
      }
      case 'mcp_tool_call': {
        out.push({
          type: 'tool_call',
          callId: item.id,
          toolName: `mcp:${item.server}/${item.tool}`,
          toolInput: { arguments: item.arguments },
        });
        const isError = item.status === 'failed';
        const result =
          isError && item.error ? { error: item.error.message } : item.result;
        out.push({
          type: 'tool_result',
          callId: item.id,
          result,
          isError,
        });
        break;
      }
      case 'web_search': {
        out.push({
          type: 'tool_call',
          callId: item.id,
          toolName: 'codex.web_search',
          toolInput: { query: item.query },
        });
        break;
      }
      case 'todo_list': {
        // Plan updates are surfaced for observability but as a tool_call
        // so they show up in the unified event log.
        out.push({
          type: 'tool_call',
          callId: item.id,
          toolName: 'codex.todo_list',
          toolInput: { items: item.items },
        });
        break;
      }
      case 'error': {
        // Non-fatal item-level error; Codex keeps the turn alive but we
        // mirror it as a tool_result so callers can see what failed.
        out.push({
          type: 'tool_result',
          callId: item.id,
          result: { message: item.message },
          isError: true,
        });
        break;
      }
      default: {
        // Forward-compat: drop unknown item types silently.
        break;
      }
    }
  }

  return {
    push(ev: SdkThreadEvent): AgentEvent[] {
      const out: AgentEvent[] = [];
      switch (ev.type) {
        case 'thread.started': {
          threadId = ev.thread_id;
          break;
        }
        case 'turn.started':
          break;
        case 'item.started':
        case 'item.updated':
          // Wait for `item.completed` to act on terminal state.
          break;
        case 'item.completed': {
          handleTerminalItem(ev.item, out);
          break;
        }
        case 'turn.completed': {
          out.push(emitResultFor(ev.usage));
          break;
        }
        case 'turn.failed': {
          out.push(mapCodexError(new Error(ev.error.message)));
          break;
        }
        case 'error': {
          out.push(mapCodexError(new Error(ev.message)));
          break;
        }
        default: {
          // Forward-compat: drop unknown events silently.
          break;
        }
      }
      return out;
    },
    flush(): AgentEvent[] {
      const out: AgentEvent[] = [];
      // If the stream ended without a turn.completed (e.g. abort), still
      // surface a terminal result event so callers do not hang waiting.
      if (!resultEmitted && lastAgentMessage.length > 0) {
        out.push(emitResultFor(undefined));
      }
      return out;
    },
  };
}
