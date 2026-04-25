import { create } from 'zustand';
import { DashboardWebSocketClient, type AgentEvent, type ServerMessage } from '@/api/ws';

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

interface ChatState {
  sessionId: string | null;
  status: string;
  messages: ChatMessage[];
  error: string | null;
  config: LastChatConfig;
  ws: DashboardWebSocketClient | null;
  connect: (client?: DashboardWebSocketClient) => void;
  disconnect: () => void;
  sendMessage: (input: { agentId: string; providerId?: string; modelId?: string; content: string }) => void;
  retryLast: () => void;
  newChat: () => void;
  applySlashCommand: (command: string) => boolean;
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

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  status: 'idle',
  messages: [],
  error: null,
  config: initialConfig,
  ws: null,
  connect: (client = new DashboardWebSocketClient()) => {
    get().ws?.close();
    client.onMessage((message) => handleServerMessage(message, set, get));
    client.connect();
    set({ ws: client });
  },
  disconnect: () => {
    get().ws?.close();
    set({ ws: null });
  },
  sendMessage: ({ agentId, providerId, modelId, content }) => {
    const config = { agentId, providerId, modelId } satisfies LastChatConfig;
    persistLastChatConfig(config);
    const client = get().ws ?? new DashboardWebSocketClient();
    if (!get().ws) {
      client.onMessage((message) => handleServerMessage(message, set, get));
      client.connect();
      set({ ws: client });
    }
    set((state) => ({
      status: 'running',
      error: null,
      config,
      messages: [
        ...state.messages,
        { id: `user-${Date.now()}`, role: 'user', content, events: [] },
        { id: `assistant-${Date.now()}`, role: 'assistant', content: '', events: [] },
      ],
    }));
    client.send({
      type: 'chat.start',
      agentId,
      ...(providerId ? { provider: providerId } : {}),
      ...(modelId ? { model: modelId } : {}),
      content,
    });
  },
  retryLast: () => {
    const lastUser = [...get().messages].reverse().find((message) => message.role === 'user');
    const { agentId, providerId, modelId } = get().config;
    if (!lastUser || !agentId) return;
    get().sendMessage({ agentId, providerId, modelId, content: lastUser.content });
  },
  newChat: () => set({ sessionId: null, status: 'idle', messages: [], error: null }),
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
    case 'session.update':
      set({ sessionId: message.sessionId, status: message.status });
      if (message.status !== 'completed' && message.status !== 'failed') {
        get().ws?.send({ type: 'subscribe', channel: 'sessions', sessionId: message.sessionId });
      }
      return;
    case 'event.stream':
      set((state) => ({ messages: appendAgentEvent(state.messages, message.event) }));
      return;
    case 'event.result':
      set({ status: 'completed' });
      return;
    case 'event.error':
      set({ status: 'failed', error: message.error });
      return;
    default:
      return;
  }
}

function appendAgentEvent(messages: ChatMessage[], event: AgentEvent): ChatMessage[] {
  const next = [...messages];
  let target = next[next.length - 1];
  if (!target || target.role !== 'assistant') {
    target = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', events: [] };
    next.push(target);
  }
  const content = event.type === 'text' || event.type === 'result' ? target.content + event.content : target.content;
  next[next.length - 1] = {
    ...target,
    content,
    events: [...target.events, event],
  };
  return next;
}
