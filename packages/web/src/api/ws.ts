import { readPersistedApiKey, useAuthStore } from '@/stores/auth';

export type AgentEvent =
  | { type: 'text'; content: string; delta?: boolean }
  | { type: 'tool_call'; callId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; result: unknown; isError?: boolean }
  | { type: 'result'; content: string; responseId?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; code: string; message: string; retryable: boolean; hint?: string };

export type ServerMessage =
  | { type: 'authenticated'; ok: boolean }
  | { type: 'event.stream'; sessionId: string; event: AgentEvent }
  | { type: 'event.result'; sessionId: string; result: unknown }
  | { type: 'event.error'; sessionId: string; error: string }
  | { type: 'session.update'; sessionId: string; status: string }
  | { type: 'system.status'; metrics: { activeSessions: number; dbConnections: number; gatewayConnected: boolean; uptimeSeconds: number } };

export type ClientMessage =
  | { type: 'authenticate'; token?: string }
  | { type: 'chat.start'; agentId: string; provider?: string; model?: string; content?: string }
  | { type: 'chat.message'; sessionId: string; content: string }
  | { type: 'chat.cancel'; sessionId: string }
  | { type: 'subscribe'; channel: 'system' | 'sessions' | 'gateway'; sessionId?: string };

type Listener = (message: ServerMessage) => void;

type WebSocketCtor = typeof WebSocket;

export class DashboardWebSocketClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly pending: ClientMessage[] = [];
  private readonly observedSessions = new Set<string>();
  private reconnectAttempt = 0;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      url?: string;
      WebSocketImpl?: WebSocketCtor;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
    } = {},
  ) {}

  connect(): void {
    this.manualClose = false;
    const Ctor = this.options.WebSocketImpl ?? WebSocket;
    this.socket = new Ctor(this.options.url ?? resolveWebSocketUrl('/ws'));
    this.socket.addEventListener('open', () => this.handleOpen());
    this.socket.addEventListener('message', (event) => this.handleMessage(event));
    this.socket.addEventListener('close', () => this.scheduleReconnect());
    this.socket.addEventListener('error', () => undefined);
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      (this.options.clearTimeoutFn ?? clearTimeout)(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: ClientMessage): void {
    if (message.type === 'subscribe' && message.sessionId) {
      this.observedSessions.add(message.sessionId);
      if (this.socket?.readyState !== WebSocket.OPEN) return;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
  }

  reconnectDelay(attempt = this.reconnectAttempt): number {
    return Math.min(30_000, 1000 * 2 ** attempt);
  }

  private handleOpen(): void {
    this.reconnectAttempt = 0;
    const token = resolveApiKey();
    this.sendNow({ type: 'authenticate', ...(token ? { token } : {}) });
    for (const sessionId of this.observedSessions) {
      this.sendNow({ type: 'subscribe', channel: 'sessions', sessionId });
    }
    while (this.pending.length > 0) this.sendNow(this.pending.shift()!);
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'session.update' && !isTerminalSessionStatus(message.status)) {
        this.observedSessions.add(message.sessionId);
      }
      for (const listener of this.listeners) listener(message);
    } catch {
      // Ignore malformed server messages; the store will surface protocol errors sent by the server.
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    const delay = this.reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = (this.options.setTimeoutFn ?? setTimeout)(() => this.connect(), delay);
  }

  private sendNow(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }
}

function isTerminalSessionStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function resolveApiKey(): string | null {
  const storeKey = useAuthStore.getState().apiKey?.trim();
  return storeKey && storeKey.length > 0 ? storeKey : readPersistedApiKey();
}

export function resolveWebSocketUrl(path: string): string {
  const configured = import.meta.env.VITE_WS_BASE_URL?.trim();
  if (configured) return `${configured.replace(/\/$/, '')}${path}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
