import { create } from 'zustand';
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  events: AgentEvent[];
  collapsed?: boolean;
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
  status: 'idle' | 'creating-session' | 'sending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'disabled';
  messages: ChatMessage[];
  error: string | null;
  config: LastChatConfig;
  ws: DashboardWebSocketClient | null;
  channelEnabled: boolean;
  historyCursor: number | null;
  historyCursorId: string | null;
  hasMoreHistory: boolean;
  connect: (client?: DashboardWebSocketClient) => void;
  disconnect: () => void;
  sendMessage: (input: { agentId: string; providerId?: string; modelId?: string; content: string }) => Promise<void>;
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
  if (event.kind === 'session.update') {
    if (event.sessionId !== get().sessionId) return;
    // Once the user cancels, ignore any later session.update that would
    // wash away the cancelled badge — matches the pre-refactor behavior.
    if (get().status === 'cancelled' && event.status !== 'cancelled') return;
    set({ status: mapSessionStatus(event.status, get().status) });
  }
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
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
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
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
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
  }
  next[next.length - 1] = { ...target, content: target.content + delta };
  return next;
}
