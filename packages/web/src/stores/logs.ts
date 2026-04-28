import { create } from 'zustand';
import { listProviderFallbacks, listSessionEvents } from '@/api/client';
import type { LogSessionEventFilters, LogSessionEventRecord, PageInfo, PaginatedQuery, ProviderFallbackRecord } from '@/types';

export interface LogsQuery extends LogSessionEventFilters, PaginatedQuery {}

interface LogsState {
  events: LogSessionEventRecord[];
  fallbacks: ProviderFallbackRecord[];
  total: number;
  pageInfo: PageInfo;
  query: Required<Pick<LogsQuery, 'page' | 'pageSize' | 'sort' | 'order' | 'q'>>;
  loading: boolean;
  error: string | null;
  loadLogs: (query?: Partial<LogsQuery>) => Promise<void>;
  setQuery: (query: Partial<LogsQuery>) => void;
}

const defaultPageInfo: PageInfo = { page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const defaultQuery = { page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' as const, q: '' };

export const useLogsStore = create<LogsState>((set, getState) => ({
  events: [],
  fallbacks: [],
  total: 0,
  pageInfo: defaultPageInfo,
  query: defaultQuery,
  loading: false,
  error: null,
  setQuery: (query) => set((state) => ({ query: { ...state.query, ...query } })),
  loadLogs: async (queryPatch = {}) => {
    const query = { ...getState().query, ...queryPatch };
    set({ loading: true, error: null, query });
    try {
      const [events, fallbacks] = await Promise.all([
        listSessionEvents(query),
        listProviderFallbacks({ sessionId: query.sessionId, from: query.from, to: query.to, page: query.page, pageSize: 5, sort: 'createdAt', order: 'desc' } as never),
      ]);
      set({ events: events.data.items, total: events.data.total ?? events.data.items.length, pageInfo: events.data.pageInfo ?? defaultPageInfo, fallbacks: fallbacks.data.items, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
}));
