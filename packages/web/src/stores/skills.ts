import { create } from 'zustand';
import { disableSkill, enableSkill, installSkill, listSkills, uninstallSkill } from '@/api/client';
import type { PageInfo, PaginatedQuery, SkillAuditResult, SkillSummary } from '@/types';

interface SkillsState {
  skills: SkillSummary[];
  total: number;
  pageInfo: PageInfo;
  query: Required<Pick<PaginatedQuery, 'page' | 'pageSize' | 'sort' | 'order' | 'q'>>;
  audit: SkillAuditResult | null;
  loading: boolean;
  error: string | null;
  loadSkills: (query?: Partial<PaginatedQuery>) => Promise<void>;
  toggleSkill: (skill: SkillSummary) => Promise<void>;
  install: (source: string) => Promise<void>;
  uninstall: (skill: SkillSummary) => Promise<void>;
}

const defaultPageInfo: PageInfo = { page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const defaultQuery = { page: 1, pageSize: 20, sort: 'id', order: 'asc' as const, q: '' };

export const useSkillsStore = create<SkillsState>((set, getState) => ({
  skills: [],
  total: 0,
  pageInfo: defaultPageInfo,
  query: defaultQuery,
  audit: null,
  loading: false,
  error: null,
  loadSkills: async (queryPatch = {}) => run(set, async () => {
    const query = { ...getState().query, ...queryPatch };
    const response = await listSkills(query);
    set({ skills: response.data.items, total: response.data.total, pageInfo: response.data.pageInfo, query });
  }),
  toggleSkill: async (skill) => run(set, async () => {
    const response = await (skill.enabled ? disableSkill(skill.id) : enableSkill(skill.id));
    set({ audit: response.data.audit ?? null });
    await getState().loadSkills();
  }),
  install: async (source) => run(set, async () => {
    const response = await installSkill(source);
    set({ audit: response.data.audit ?? null });
    await getState().loadSkills();
  }),
  uninstall: async (skill) => run(set, async () => {
    const response = await uninstallSkill(skill.id);
    set({ audit: response.data.audit ?? null });
    await getState().loadSkills();
  }),
}));

async function run<T>(set: (partial: Partial<SkillsState>) => void, action: () => Promise<T>): Promise<T> {
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
