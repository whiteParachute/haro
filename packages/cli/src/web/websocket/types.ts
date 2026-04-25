import type { AgentEvent, RunAgentResult } from '@haro/core';

export type ClientMessage =
  | { type: 'authenticate'; token?: string }
  | { type: 'chat.start'; agentId: string; provider?: string; model?: string; content?: string }
  | { type: 'chat.message'; sessionId: string; content: string }
  | { type: 'chat.cancel'; sessionId: string }
  | { type: 'subscribe'; channel: 'system' | 'sessions' | 'gateway'; sessionId?: string };

export type ServerMessage =
  | { type: 'authenticated'; ok: boolean }
  | { type: 'event.stream'; sessionId: string; event: AgentEvent }
  | { type: 'event.result'; sessionId: string; result: RunAgentResult }
  | { type: 'event.error'; sessionId: string; error: string }
  | { type: 'session.update'; sessionId: string; status: string }
  | { type: 'system.status'; metrics: SystemMetrics };

export interface SystemMetrics {
  activeSessions: number;
  dbConnections: number;
  gatewayConnected: boolean;
  uptimeSeconds: number;
}

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
