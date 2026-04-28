import { create } from 'zustand';
import { createWebUser, listUsersPage, updateWebUser } from '@/api/client';
import type { PageInfo, PaginatedQuery, WebUser, WebUserRole } from '@/types';

interface UsersState {
  users: WebUser[];
  total: number;
  pageInfo: PageInfo;
  query: Required<Pick<PaginatedQuery, 'page' | 'pageSize' | 'sort' | 'order' | 'q'>>;
  loading: boolean;
  error: string | null;
  loadUsers: (query?: Partial<PaginatedQuery>) => Promise<void>;
  createUser: (input: { username: string; displayName?: string; password: string; role: WebUserRole }) => Promise<boolean>;
  setUserStatus: (user: WebUser, status: 'active' | 'disabled') => Promise<void>;
}

const defaultPageInfo: PageInfo = { page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const defaultQuery = { page: 1, pageSize: 20, sort: 'createdAt', order: 'asc' as const, q: '' };

export const useUsersStore = create<UsersState>((set, getState) => ({
  users: [],
  total: 0,
  pageInfo: defaultPageInfo,
  query: defaultQuery,
  loading: false,
  error: null,
  loadUsers: async (queryPatch = {}) => run(set, async () => {
    const query = { ...getState().query, ...queryPatch };
    const response = await listUsersPage(query);
    set({ users: response.data.items, total: response.data.total, pageInfo: response.data.pageInfo, query });
  }),
  createUser: async (input) => {
    try {
      await run(set, async () => {
        await createWebUser(input);
        await getState().loadUsers();
      });
      return true;
    } catch {
      return false;
    }
  },
  setUserStatus: async (user, status) => run(set, async () => {
    await updateWebUser(user.id, { status });
    await getState().loadUsers();
  }),
}));

async function run<T>(set: (partial: Partial<UsersState>) => void, action: () => Promise<T>): Promise<T> {
  set({ loading: true, error: null });
  try {
    const value = await action();
    set({ loading: false });
    return value;
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error), loading: false });
    throw error;
  }
}
