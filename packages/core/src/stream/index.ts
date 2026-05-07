/**
 * `@haro/core/stream` — explicit StreamEvent protocol (FEAT-034).
 *
 * The 12-kind protocol replaces the implicit text-only delta stream the
 * Dashboard used before. Re-exported here so adapters (web-api, channel-web)
 * and consumers (Dashboard chat store) can import a single canonical surface.
 */

export {
  STREAM_EVENT_KINDS,
  agentEventToStream,
  applyStreamEventToBucket,
  emptyBucket,
  isStreamEvent,
  isStreamMessageDelta,
  isStreamMessageDone,
  isStreamThinkingDelta,
  isStreamThinkingDone,
  isStreamToolCallStart,
  isStreamToolCallEnd,
  isStreamToolCallError,
  isStreamHookPre,
  isStreamHookPost,
  isStreamUsageUpdate,
  isStreamSessionStatus,
  isStreamError,
  type AgentEventStreamContext,
  type BucketReducerOptions,
  type MessageBucket,
  type StreamEvent,
  type StreamEventKind,
  type StreamMessageDelta,
  type StreamMessageDone,
  type StreamThinkingDelta,
  type StreamThinkingDone,
  type StreamToolCallStart,
  type StreamToolCallEnd,
  type StreamToolCallError,
  type StreamHookPre,
  type StreamHookPost,
  type StreamUsageUpdate,
  type StreamSessionStatus,
  type StreamError,
  type ToolCallNode,
} from './stream-events.js';
