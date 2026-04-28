import { create } from 'zustand';
import { queryMemoryPage, runMemoryMaintenance, writeMemory } from '@/api/client';
import type { MemoryQueryFilters, MemorySearchResult, PageInfo, PaginatedQuery } from '@/types';

export interface KnowledgeQuery extends MemoryQueryFilters, PaginatedQuery {}

interface KnowledgeState {
  results: MemorySearchResult[];
  total: number;
  pageInfo: PageInfo;
  query: Required<Pick<KnowledgeQuery, 'page' | 'pageSize' | 'sort' | 'order' | 'q'>>;
  loading: boolean;
  error: string | null;
  message: string | null;
  loadKnowledge: (query?: Partial<KnowledgeQuery>) => Promise<void>;
  writeKnowledge: (input: { scope: 'shared' | 'agent'; agentId?: string; topic: string; summary?: string; content: string; assetRef?: string }) => Promise<void>;
  runMaintenance: () => Promise<void>;
}

const defaultPageInfo: PageInfo = { page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const defaultQuery = { page: 1, pageSize: 20, sort: 'updatedAt', order: 'desc' as const, q: '' };

export const useKnowledgeStore = create<KnowledgeState>((set, getState) => ({
  results: [],
  total: 0,
  pageInfo: defaultPageInfo,
  query: defaultQuery,
  loading: false,
  error: null,
  message: null,
  loadKnowledge: async (queryPatch = {}) => {
    const query = { ...getState().query, ...queryPatch };
    set({ loading: true, error: null, query });
    try {
      const response = await queryMemoryPage(query);
      set({ results: response.data.items, total: response.data.total, pageInfo: response.data.pageInfo, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  writeKnowledge: async (input) => {
    set({ loading: true, error: null, message: null });
    try {
      await writeMemory({ ...input, layer: 'persistent', sourceRef: 'web-dashboard', verificationStatus: 'unverified' });
      set({ message: 'Memory write accepted' });
      await getState().loadKnowledge();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  runMaintenance: async () => {
    const response = await runMemoryMaintenance({});
    set({ message: `Maintenance accepted: ${response.data.taskId}` });
  },
}));
