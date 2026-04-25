import { create } from 'zustand';
import { del, get } from '@/api/client';
import type { AgentEvent } from '@/api/ws';

export interface SessionSummary {
  sessionId: string;
  agentId: string;
  status: string;
  createdAt: string;
  provider?: string;
  model?: string;
  endedAt?: string | null;
}

export interface SessionEventRecord {
  id: number;
  sessionId: string;
  eventType: string;
  event: AgentEvent | Record<string, unknown> | string | null;
  createdAt: string;
}

interface SessionsState {
  items: SessionSummary[];
  total: number;
  detail: SessionSummary | null;
  events: SessionEventRecord[];
  loading: boolean;
  error: string | null;
  loadSessions: (filters?: { status?: string; agentId?: string; limit?: number; offset?: number }) => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  items: [],
  total: 0,
  detail: null,
  events: [],
  loading: false,
  error: null,
  loadSessions: async (filters = {}) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.agentId) params.set('agentId', filters.agentId);
      if (filters.limit) params.set('limit', String(filters.limit));
      if (filters.offset) params.set('offset', String(filters.offset));
      const suffix = params.size > 0 ? `?${params}` : '';
      const response = await get<{ items: SessionSummary[]; total: number }>(`/v1/sessions${suffix}`);
      set({ items: response.data.items, total: response.data.total, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  loadSessionDetail: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const [detail, events] = await Promise.all([
        get<SessionSummary>(`/v1/sessions/${sessionId}`),
        get<{ items: SessionEventRecord[] }>(`/v1/sessions/${sessionId}/events`),
      ]);
      set({ detail: detail.data, events: events.data.items, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  deleteSession: async (sessionId) => {
    await del(`/v1/sessions/${sessionId}`);
    set((state) => ({ items: state.items.filter((item) => item.sessionId !== sessionId) }));
  },
}));
