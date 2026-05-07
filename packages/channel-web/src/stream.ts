import type { OutboundMessage } from '@haro/channel';
import type { StreamEvent } from '@haro/core/stream';
import type { WebMessageRecord } from './persistence/messages.js';

/**
 * Wire format for the Web Channel WebSocket stream. Server publishes
 * `WebChannelStreamEvent` payloads; the Dashboard maps these into UI state.
 *
 * Web Channel does not invent a new transport — it piggybacks the existing
 * Dashboard `/ws` endpoint via session-scoped subscriptions. The translation
 * helper here is what wraps Channel-layer outbound messages into a neutral
 * envelope without leaking adapter internals.
 */

export type WebChannelStreamEvent =
  | { kind: 'message'; message: WebMessageRecord }
  | {
      kind: 'agent';
      sessionId: string;
      delta: string;
      messageId?: string;
      replyTo?: string;
    }
  | {
      kind: 'session.update';
      sessionId: string;
      status: string;
    }
  // FEAT-034: structured envelope alongside `agent` deltas. New clients prefer
  // the structured event; old clients still work because legacy `agent`
  // deltas are emitted in parallel during the migration window.
  | {
      kind: 'stream';
      sessionId: string;
      messageId?: string;
      event: StreamEvent;
    };

export function outboundToStreamEvent(
  sessionId: string,
  message: OutboundMessage,
  messageId?: string,
): WebChannelStreamEvent {
  return {
    kind: 'agent',
    sessionId,
    delta: stringifyOutbound(message),
    ...(messageId ? { messageId } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  };
}

function stringifyOutbound(message: OutboundMessage): string {
  if (typeof message.content === 'string') return message.content;
  return JSON.stringify(message.content);
}
