import { create } from 'zustand';
import {
  applyStreamEventToBucket,
  emptyBucket,
  type MessageBucket,
  type StreamEvent,
  type ToolCallNode,
} from '@haro/core/stream';
import {
  DashboardWebSocketClient,
  type AgentEvent,
  type ServerMessage,
  type WebChannelStreamEvent,
} from '@/api/ws';
import { get as apiGet, post as apiPost } from '@/api/client';

export const LAST_CHAT_CONFIG_STORAGE_KEY = 'haro:lastChatConfig';

export interface LastChatConfig {
  agentId?: string;
  providerId?: string;
  modelId?: string;
}

/**
 * Chat-side enrichment of a {@link MessageBucket}: the protocol bucket only
 * carries the structured tracks; we tack on UI-only flags (`streaming`)
 * here so MessageBubble doesn't need to peek at session-level state.
 */
export interface ChatMessageBucket extends MessageBucket {
  streaming: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  events: AgentEvent[];
  collapsed?: boolean;
  /** FEAT-034: structured tracks (thinking, tool calls) bucketed per message. */
  bucket?: ChatMessageBucket;
}

interface WebChannelSession {
  sessionId: string;
  title: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  sessionId: string | null;
  status:
    | 'idle'
    | 'creating-session'
    | 'sending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'disabled';
  messages: ChatMessage[];
  /** FEAT-034: tool calls aggregated across the current session for the
   *  side-rail timeline. Newest at the end. */
  toolCalls: ToolCallNode[];
  /** FEAT-034: latest usage summary surfaced from `usage_update` events. */
  usage: { input: number; output: number; total: number } | null;
  error: string | null;
  config: LastChatConfig;
  ws: DashboardWebSocketClient | null;
  channelEnabled: boolean;
  historyCursor: number | null;
  historyCursorId: string | null;
  hasMoreHistory: boolean;
  connect: (client?: DashboardWebSocketClient) => void;
  disconnect: () => void;
  sendMessage: (input: {
    agentId: string;
    providerId?: string;
    modelId?: string;
    content: string;
  }) => Promise<void>;
  cancelCurrent: () => void;
  retryLast: () => void;
  newChat: () => void;
  applySlashCommand: (command: string) => boolean;
  /**
   * Load older messages for the current session via the Web Channel
   * history route. Returns false if there is no current session or no more
   * history; otherwise prepends the page to the current message list.
   */
  loadOlder: (limit?: number) => Promise<boolean>;
  /** Load an existing session's most recent N messages into the chat view. */
  loadSession: (sessionId: string, limit?: number) => Promise<void>;
}

function readLastChatConfig(): LastChatConfig {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_CHAT_CONFIG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LastChatConfig) : {};
  } catch {
    return {};
  }
}

function persistLastChatConfig(config: LastChatConfig): void {
  try {
    globalThis.localStorage?.setItem(LAST_CHAT_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage failures.
  }
}

const initialConfig = readLastChatConfig();

interface ChannelSummary {
  id: string;
  enabled: boolean;
}

async function probeWebChannelEnabled(): Promise<boolean> {
  try {
    const response = await apiGet<ChannelSummary[]>('/v1/channels');
    const web = response.data.find((entry) => entry.id === 'web');
    return Boolean(web?.enabled);
  } catch {
    // Default to enabled if probe fails — surface the real error when user tries to send.
    return true;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  status: 'idle',
  messages: [],
  toolCalls: [],
  usage: null,
  error: null,
  config: initialConfig,
  ws: null,
  channelEnabled: true,
  historyCursor: null,
  historyCursorId: null,
  hasMoreHistory: false,
  connect: (client = new DashboardWebSocketClient()) => {
    get().ws?.close();
    client.onMessage((message) => handleServerMessage(message, set, get));
    client.connect();
    client.send({ type: 'subscribe', channel: 'channels:web' });
    set({ ws: client });
    void probeWebChannelEnabled().then((enabled) => {
      set((state) => ({
        channelEnabled: enabled,
        status: enabled ? state.status : 'disabled',
      }));
    });
  },
  disconnect: () => {
    get().ws?.close();
    set({ ws: null });
  },
  sendMessage: async ({ agentId, providerId, modelId, content }) => {
    const config = { agentId, providerId, modelId } satisfies LastChatConfig;
    persistLastChatConfig(config);

    let sessionId = get().sessionId;
    set({ status: sessionId ? 'sending' : 'creating-session', error: null, config });

    try {
      if (!sessionId) {
        const response = await apiPost<WebChannelSession>('/v1/channels/web/sessions', {});
        sessionId = response.data.sessionId;
        set({ sessionId, channelEnabled: true });
        get().ws?.send({ type: 'subscribe', channel: 'sessions', sessionId });
      }

      // Add an optimistic user bubble + an empty assistant placeholder before
      // the network call returns; the WS stream events fill the assistant
      // bubble in place.
      set((state) => ({
        messages: [
          ...state.messages,
          { id: `user-pending-${Date.now()}`, role: 'user', content, events: [] },
          { id: `assistant-pending-${Date.now()}`, role: 'assistant', content: '', events: [] },
        ],
      }));

      await apiPost(`/v1/channels/web/sessions/${encodeURIComponent(sessionId)}/messages`, {
        content,
        metadata: {
          agentId,
          ...(providerId ? { providerId } : {}),
          ...(modelId ? { modelId } : {}),
        },
      });
      set({ status: 'running' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const disabled = /WEB_CHANNEL_DISABLED|503/i.test(message);
      set({
        status: disabled ? 'disabled' : 'failed',
        error: disabled ? 'Web Channel is disabled — Dashboard chat is read-only.' : message,
        channelEnabled: !disabled,
      });
    }
  },
  cancelCurrent: () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    // Cancellation goes through the existing WS chat.cancel route — agent
    // execution still flows through the runtime, only the inbound surface is
    // different.
    get().ws?.send({ type: 'chat.cancel', sessionId });
    set({ status: 'cancelled' });
  },
  retryLast: () => {
    const lastUser = [...get().messages].reverse().find((message) => message.role === 'user');
    const { agentId, providerId, modelId } = get().config;
    if (!lastUser || !agentId) return;
    void get().sendMessage({ agentId, providerId, modelId, content: lastUser.content });
  },
  newChat: () =>
    set({
      sessionId: null,
      status: 'idle',
      messages: [],
      toolCalls: [],
      usage: null,
      error: null,
      historyCursor: null,
      historyCursorId: null,
      hasMoreHistory: false,
    }),
  loadOlder: async (limit = 50) => {
    const { sessionId, historyCursor, historyCursorId, hasMoreHistory } = get();
    if (!sessionId) return false;
    if (!hasMoreHistory && historyCursor === null) {
      // First call after session-load already fetched; nothing to do.
      return false;
    }
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (historyCursor !== null) params.set('before', String(historyCursor));
    if (historyCursorId) params.set('beforeId', historyCursorId);
    const response = await apiGet<{
      items: Array<{ id: string; role: ChatMessage['role']; content: unknown; createdAt: number }>;
      nextCursor: number | null;
      nextCursorId: string | null;
    }>(`/v1/channels/web/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`);
    const older = response.data.items.map(toChatMessage);
    set((state) => ({
      messages: [...older, ...state.messages],
      historyCursor: response.data.nextCursor,
      historyCursorId: response.data.nextCursorId,
      hasMoreHistory: response.data.nextCursor !== null,
    }));
    return older.length > 0;
  },
  loadSession: async (sessionId: string, limit = 50) => {
    set({
      sessionId,
      status: 'idle',
      messages: [],
      toolCalls: [],
      usage: null,
      error: null,
      historyCursor: null,
      historyCursorId: null,
      hasMoreHistory: false,
    });
    const response = await apiGet<{
      items: Array<{ id: string; role: ChatMessage['role']; content: unknown; createdAt: number }>;
      nextCursor: number | null;
      nextCursorId: string | null;
    }>(`/v1/channels/web/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`);
    const initial = response.data.items.map(toChatMessage);
    set({
      messages: initial,
      historyCursor: response.data.nextCursor,
      historyCursorId: response.data.nextCursorId,
      hasMoreHistory: response.data.nextCursor !== null,
    });
    get().ws?.send({ type: 'subscribe', channel: 'sessions', sessionId });
  },
  applySlashCommand: (command) => {
    const trimmed = command.trim();
    if (trimmed === '/new') {
      get().newChat();
      return true;
    }
    if (trimmed === '/retry') {
      get().retryLast();
      return true;
    }
    if (trimmed.startsWith('/agent ')) {
      const agentId = trimmed.slice('/agent '.length).trim();
      const config = { ...get().config, agentId };
      persistLastChatConfig(config);
      set({ config });
      return true;
    }
    if (trimmed.startsWith('/model ')) {
      const [providerId, modelId] = trimmed.slice('/model '.length).trim().split(/\s+/, 2);
      const config = { ...get().config, providerId, modelId };
      persistLastChatConfig(config);
      set({ config });
      return true;
    }
    return false;
  },
}));

function handleServerMessage(
  message: ServerMessage,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): void {
  switch (message.type) {
    case 'channels.web.event':
      if (message.sessionId !== get().sessionId) return;
      handleWebChannelEvent(message.event, set, get);
      return;
    case 'session.update':
      if (
        get().status === 'cancelled' &&
        get().sessionId === message.sessionId &&
        message.status !== 'cancelled'
      ) {
        return;
      }
      if (message.sessionId === get().sessionId) {
        set({ status: mapSessionStatus(message.status, get().status) });
      }
      return;
    case 'event.error':
      if (get().sessionId === message.sessionId && get().status !== 'cancelled') {
        set({ status: 'failed', error: message.error });
      }
      return;
    default:
      return;
  }
}

function handleWebChannelEvent(
  event: WebChannelStreamEvent,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): void {
  if (event.kind === 'message') {
    if (event.message.role === 'user') {
      // Replace the optimistic pending user bubble with the persisted one so
      // the IDs align with the backend (history fetches will match).
      set((state) => ({
        messages: replaceLastPendingUser(state.messages, event.message),
      }));
      return;
    }
    if (event.message.role === 'assistant') {
      set((state) => ({
        messages: appendOrReplaceAssistant(state.messages, event.message),
      }));
    }
    return;
  }
  if (event.kind === 'agent') {
    set((state) => ({ messages: appendAgentDelta(state.messages, event.delta) }));
    if (get().status === 'sending' || get().status === 'creating-session') {
      set({ status: 'running' });
    }
    return;
  }
  if (event.kind === 'stream') {
    handleStreamEvent(event.event, set, get);
    return;
  }
  if (event.kind === 'session.update') {
    if (event.sessionId !== get().sessionId) return;
    // Once the user cancels, ignore any later session.update that would
    // wash away the cancelled badge — matches the pre-refactor behavior.
    if (get().status === 'cancelled' && event.status !== 'cancelled') return;
    set({ status: mapSessionStatus(event.status, get().status) });
  }
}

/**
 * Apply a structured FEAT-034 StreamEvent to the chat store. Each event maps
 * onto one of three update planes: per-message bucket (thinking / message
 * deltas), session-wide tool list (timeline), or session metadata (usage /
 * status / errors). We keep the message list immutable per delta — applying
 * the bucket reducer pure-functionally so the existing `replaceLastPending*`
 * helpers continue to work alongside.
 */
function handleStreamEvent(
  event: StreamEvent,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): void {
  // Tool / hook events update the session-wide timeline. We track them in a
  // dedicated array so the side panel can render without scanning every
  // message bucket.
  if (
    event.kind === 'tool_call_start' ||
    event.kind === 'tool_call_end' ||
    event.kind === 'tool_call_error' ||
    event.kind === 'hook_pre' ||
    event.kind === 'hook_post'
  ) {
    set((state) => ({
      toolCalls: applyToolEventToList(state.toolCalls, event),
    }));
    return;
  }
  if (event.kind === 'usage_update') {
    set({ usage: event.tokens });
    return;
  }
  if (event.kind === 'session_status') {
    if (event.sessionId !== get().sessionId) return;
    if (get().status === 'cancelled' && event.status !== 'errored') return;
    set({ status: mapStreamStatus(event.status, get().status) });
    return;
  }
  if (event.kind === 'error') {
    if (get().status === 'cancelled') return;
    set({ status: 'failed', error: `${event.code}: ${event.message}` });
    return;
  }
  // Remaining: message_delta / message_done / thinking_delta / thinking_done
  // — they target per-message buckets.
  set((state) => ({ messages: applyStreamEventToMessages(state.messages, event) }));
  if (event.kind === 'message_delta' || event.kind === 'thinking_delta') {
    if (get().status === 'sending' || get().status === 'creating-session') {
      set({ status: 'running' });
    }
  }
}

function applyStreamEventToMessages(messages: ChatMessage[], event: StreamEvent): ChatMessage[] {
  const target = pickAssistantBubble(messages);
  if (target.index < 0) return messages;
  const next = messages.slice();
  const current = next[target.index]!;
  const baseBucket: ChatMessageBucket = current.bucket ?? {
    ...emptyBucket(current.id),
    streaming: true,
  };
  const updatedBucket = applyStreamEventToBucket(
    baseBucket,
    retargetBucketEvent(event, current.id),
  ) as MessageBucket;
  const streaming = event.kind === 'message_done' || event.kind === 'thinking_done' ? false : true;
  const merged: ChatMessageBucket = { ...updatedBucket, streaming };
  next[target.index] = {
    ...current,
    content:
      event.kind === 'message_delta' || event.kind === 'message_done'
        ? merged.message
        : current.content,
    bucket: merged,
  };
  return next;
}

function pickAssistantBubble(messages: ChatMessage[]): { index: number } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'assistant') return { index };
  }
  return { index: -1 };
}

/** Translate the event's `messageId` to the bubble's id so the bucket reducer
 *  applies the delta even when the wire-side messageId is the channel session
 *  id (web channel agent stream) rather than the per-bubble id. */
function retargetBucketEvent(event: StreamEvent, bubbleId: string): StreamEvent {
  if (
    event.kind === 'message_delta' ||
    event.kind === 'message_done' ||
    event.kind === 'thinking_delta' ||
    event.kind === 'thinking_done'
  ) {
    return { ...event, messageId: bubbleId };
  }
  return event;
}

function applyToolEventToList(
  list: ToolCallNode[],
  event: Extract<
    StreamEvent,
    { kind: 'tool_call_start' | 'tool_call_end' | 'tool_call_error' | 'hook_pre' | 'hook_post' }
  >,
): ToolCallNode[] {
  if (event.kind === 'tool_call_start') {
    if (list.some((node) => node.callId === event.callId)) return list;
    return [
      ...list,
      {
        callId: event.callId,
        ...(event.parentCallId ? { parentCallId: event.parentCallId } : {}),
        tool: event.tool,
        paramsSummary: event.paramsSummary,
        status: 'pending',
        startedAt: Date.now(),
      },
    ];
  }
  if (event.kind === 'tool_call_end') {
    return list.map((node) =>
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
  }
  if (event.kind === 'tool_call_error') {
    return list.map((node) =>
      node.callId === event.callId
        ? {
            ...node,
            status: 'error' as const,
            errorCode: event.errorCode,
            errorMessage: event.message,
          }
        : node,
    );
  }
  if (event.kind === 'hook_pre') {
    return list.map((node) =>
      node.callId === event.callId
        ? { ...node, hookName: event.hook, hookPre: event.status }
        : node,
    );
  }
  // hook_post
  return list.map((node) =>
    node.callId === event.callId ? { ...node, hookName: event.hook, hookPost: event.status } : node,
  );
}

function mapStreamStatus(
  raw: 'idle' | 'running' | 'completed' | 'errored',
  current: ChatState['status'],
): ChatState['status'] {
  if (raw === 'completed') return 'completed';
  if (raw === 'errored') return 'failed';
  if (raw === 'running') return 'running';
  return current;
}

function mapSessionStatus(raw: string, current: ChatState['status']): ChatState['status'] {
  if (raw === 'completed') return 'completed';
  if (raw === 'failed') return 'failed';
  if (raw === 'cancelled') return 'cancelled';
  if (raw === 'running') return 'running';
  return current;
}

function replaceLastPendingUser(
  messages: ChatMessage[],
  message: { id: string; content: unknown },
): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]!;
    if (candidate.role === 'user' && candidate.id.startsWith('user-pending-')) {
      const next = messages.slice();
      next[index] = {
        ...candidate,
        id: message.id,
        content:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      };
      return next;
    }
  }
  return messages;
}

function appendOrReplaceAssistant(
  messages: ChatMessage[],
  message: { id: string; content: unknown },
): ChatMessage[] {
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.id.startsWith('assistant-pending-')) {
    const next = messages.slice();
    next[next.length - 1] = { ...last, id: message.id, content: last.content || content };
    return next;
  }
  return [...messages, { id: message.id, role: 'assistant', content, events: [] }];
}

function toChatMessage(record: {
  id: string;
  role: ChatMessage['role'];
  content: unknown;
}): ChatMessage {
  return {
    id: record.id,
    role: record.role,
    content: typeof record.content === 'string' ? record.content : JSON.stringify(record.content),
    events: [],
  };
}

function appendAgentDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const next = messages.slice();
  let target = next[next.length - 1];
  if (!target || target.role !== 'assistant') {
    target = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', events: [] };
    next.push(target);
  } else if (target.bucket?.message) {
    // During FEAT-034 migration the server emits both the structured
    // `stream.message_*` events and a legacy `agent` envelope for old
    // clients. Prefer the structured bucket and ignore/replace the legacy
    // cumulative payload instead of appending the same final answer again.
    if (delta === target.content || delta === target.bucket.message) return messages;
    if (delta.startsWith(target.content)) {
      next[next.length - 1] = {
        ...target,
        content: delta,
        bucket: {
          ...target.bucket,
          message: delta,
          streaming: false,
        },
      };
      return next;
    }
  }
  next[next.length - 1] = { ...target, content: target.content + delta };
  return next;
}

export const __test__ = {
  handleWebChannelEventForTest(event: WebChannelStreamEvent): void {
    handleWebChannelEvent(event, useChatStore.setState, useChatStore.getState);
  },
  handleStreamEventForTest(event: StreamEvent): void {
    handleStreamEvent(event, useChatStore.setState, useChatStore.getState);
  },
};
