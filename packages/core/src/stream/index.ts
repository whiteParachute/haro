/**
 * `@haro/core/stream` — explicit StreamEvent protocol (FEAT-034).
 *
 * This remains as historical protocol utility for adapters that still want a
 * structured stream surface. The Haro Web sidecar cleanup removed the old chat consumer; Haro Web now only reviews proposals.
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
