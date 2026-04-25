import { create } from 'zustand';
import { get } from '@/api/client';

export interface ChannelHealthSummary {
  id: string;
  displayName: string;
  enabled: boolean;
  source: string;
  health: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
  lastCheckedAt: string;
  config: Record<string, unknown>;
  error?: string;
}

export interface ProviderHealthSummary {
  id: string;
  healthy: boolean;
  error?: string;
}

export interface SystemStatus {
  ok: boolean;
  service: string;
  startedAt: string;
  uptimeMs: number;
  database: {
    ok: boolean;
    dbFile: string;
    journalMode: string;
    fts5Available: boolean;
  };
  providers: ProviderHealthSummary[];
  channels: ChannelHealthSummary[];
  sessions: {
    counts: Array<{ status: string; count: number }>;
    total: number;
    today: number;
    completed: number;
    failed: number;
    running: number;
    successRate: number | null;
  };
  recent: Array<{ sessionId: string; agentId: string; status: string; startedAt: string }>;
}

export interface DoctorGroupItem {
  severity: 'error' | 'warn' | 'info';
  message: string;
  path?: string;
  suggestion?: string;
}

export interface DoctorGroup {
  id: string;
  title: string;
  items: DoctorGroupItem[];
}

export interface DoctorReport {
  ok: boolean;
  config: { ok: boolean; sources: string[] };
  providers: ProviderHealthSummary[];
  channels: ChannelHealthSummary[];
  dataDir: { root: string; checks: Array<{ name: string; path: string; writable: boolean }> };
  sqlite: { ok: boolean; dbFile: string; error?: string };
  groups: DoctorGroup[];
}

interface SystemState {
  status: SystemStatus | null;
  doctor: DoctorReport | null;
  loading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  loadDoctor: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  doctor: null,
  loading: false,
  error: null,
  loadStatus: async () => {
    set({ loading: true, error: null });
    try {
      const response = await get<SystemStatus>('/v1/status');
      set({ status: response.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  loadDoctor: async () => {
    set({ loading: true, error: null });
    try {
      const response = await get<DoctorReport>('/v1/doctor');
      set({ doctor: response.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [status, doctor] = await Promise.all([
        get<SystemStatus>('/v1/status'),
        get<DoctorReport>('/v1/doctor'),
      ]);
      set({ status: status.data, doctor: doctor.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
}));
