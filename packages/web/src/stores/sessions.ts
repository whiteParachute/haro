import { create } from 'zustand';
import { del, get, listSessionsPage } from '@/api/client';
import type { AgentEvent } from '@/api/ws';
import type { PageInfo, PaginatedQuery, PaginatedResponse } from '@/types';

export interface SessionSummary extends Record<string, unknown> {
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

export interface SessionListQuery extends PaginatedQuery {
  status?: string;
  agentId?: string;
}

interface SessionsState {
  items: SessionSummary[];
  total: number;
  pageInfo: PageInfo;
  query: Required<Pick<SessionListQuery, 'page' | 'pageSize' | 'sort' | 'order' | 'q'>> & { status?: string; agentId?: string };
  detail: SessionSummary | null;
  events: SessionEventRecord[];
  loading: boolean;
  error: string | null;
  loadSessions: (filters?: SessionListQuery & { limit?: number; offset?: number }) => Promise<void>;
  setQuery: (query: Partial<SessionListQuery>) => void;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

const defaultPageInfo: PageInfo = { page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const defaultQuery = { page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' as const, q: '' };

export const useSessionsStore = create<SessionsState>((set, getState) => ({
  items: [],
  total: 0,
  pageInfo: defaultPageInfo,
  query: defaultQuery,
  detail: null,
  events: [],
  loading: false,
  error: null,
  setQuery: (query) => set((state) => ({ query: { ...state.query, ...query } })),
  loadSessions: async (filters = {}) => {
    const legacyPageSize = filters.limit ?? filters.pageSize;
    const legacyPage = filters.offset !== undefined && legacyPageSize ? Math.floor(filters.offset / legacyPageSize) + 1 : filters.page;
    const query = { ...getState().query, ...filters, ...(legacyPage ? { page: legacyPage } : {}), ...(legacyPageSize ? { pageSize: legacyPageSize } : {}) };
    set({ loading: true, error: null, query });
    try {
      const response = await listSessionsPage<SessionSummary>(query);
      const data = normalizePaginated(response.data, query.page ?? 1, query.pageSize ?? 20);
      set({ items: data.items, total: data.total, pageInfo: data.pageInfo, loading: false });
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
    set((state) => ({ items: state.items.filter((item) => item.sessionId !== sessionId), total: Math.max(0, state.total - 1) }));
  },
}));

function normalizePaginated<T>(data: PaginatedResponse<T> | { items: T[]; total?: number; limit?: number; offset?: number }, page: number, pageSize: number): PaginatedResponse<T> {
  if ('pageInfo' in data && data.pageInfo) return data;
  const legacy = data as { items: T[]; total?: number; limit?: number; offset?: number };
  const total = legacy.total ?? legacy.items.length;
  const computedPageSize = legacy.limit ?? pageSize;
  const computedPage = legacy.offset !== undefined ? Math.floor(legacy.offset / computedPageSize) + 1 : page;
  const totalPages = Math.max(1, Math.ceil(total / computedPageSize));
  return {
    items: legacy.items,
    total,
    pageInfo: {
      page: computedPage,
      pageSize: computedPageSize,
      totalPages,
      hasNextPage: computedPage < totalPages,
      hasPreviousPage: computedPage > 1,
    },
  };
}
