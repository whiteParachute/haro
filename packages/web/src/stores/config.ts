import { create } from 'zustand';
import { get, put } from '@/api/client';
import type { ChannelHealthSummary } from './system';

export interface ConfigSource {
  id: string;
  label: string;
  path: string | null;
  present: boolean;
  active: boolean;
}

export interface FieldSource {
  source: string;
  path?: string;
  value: unknown;
}

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export interface ConfigPayload {
  config: Record<string, unknown>;
  rawYaml: string;
  sources: ConfigSource[];
  fieldSources: Record<string, FieldSource>;
  channels: ChannelHealthSummary[];
}

interface ConfigState {
  config: Record<string, unknown> | null;
  rawYaml: string;
  sources: ConfigSource[];
  fieldSources: Record<string, FieldSource>;
  channels: ChannelHealthSummary[];
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  issues: ConfigValidationIssue[];
  loadConfig: () => Promise<void>;
  loadSources: () => Promise<void>;
  saveConfig: (input: { config?: Record<string, unknown>; rawYaml?: string }) => Promise<boolean>;
  validateCommonConfig: (input: CommonConfigDraft) => ConfigValidationIssue[];
}

export interface CommonConfigDraft {
  loggingLevel?: string;
  defaultAgent?: string;
  taskTimeoutMs?: string;
}

export const useConfigStore = create<ConfigState>((set, getState) => ({
  config: null,
  rawYaml: '',
  sources: [],
  fieldSources: {},
  channels: [],
  loading: false,
  saving: false,
  saved: false,
  error: null,
  issues: [],
  loadConfig: async () => {
    set({ loading: true, error: null, saved: false });
    try {
      const response = await get<ConfigPayload>('/v1/config');
      set({
        config: response.data.config,
        rawYaml: response.data.rawYaml,
        sources: response.data.sources,
        fieldSources: response.data.fieldSources,
        channels: response.data.channels,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  loadSources: async () => {
    set({ loading: true, error: null });
    try {
      const response = await get<{ sources: ConfigSource[]; fieldSources: Record<string, FieldSource> }>('/v1/config/sources');
      set({ sources: response.data.sources, fieldSources: response.data.fieldSources, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  saveConfig: async (input) => {
    set({ saving: true, error: null, issues: [], saved: false });
    try {
      const response = await put<Omit<ConfigPayload, 'rawYaml' | 'channels'> & { saved: boolean; path: string }>('/v1/config', input);
      set({
        config: response.data.config,
        sources: response.data.sources,
        fieldSources: response.data.fieldSources,
        saving: false,
        saved: true,
      });
      await getState().loadConfig();
      set({ saved: true });
      return true;
    } catch (error) {
      const issues = readIssues(error);
      set({
        error: error instanceof Error ? error.message : String(error),
        issues,
        saving: false,
        saved: false,
      });
      return false;
    }
  },
  validateCommonConfig: (input) => {
    const issues: ConfigValidationIssue[] = [];
    if (input.loggingLevel && !['debug', 'info', 'warn', 'error'].includes(input.loggingLevel)) {
      issues.push({ path: 'logging.level', message: 'logging.level must be debug, info, warn, or error' });
    }
    if (input.taskTimeoutMs) {
      const parsed = Number.parseInt(input.taskTimeoutMs, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== input.taskTimeoutMs.trim()) {
        issues.push({ path: 'runtime.taskTimeoutMs', message: 'taskTimeoutMs must be a positive integer' });
      }
    }
    return issues;
  },
}));

function readIssues(error: unknown): ConfigValidationIssue[] {
  const maybeError = error as { issues?: ConfigValidationIssue[] };
  return Array.isArray(maybeError.issues) ? maybeError.issues : [];
}
