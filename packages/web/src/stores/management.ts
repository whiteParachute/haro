import { create } from 'zustand';
import { del, get, post, put } from '@/api/client';

export interface ChannelSummary {
  id: string;
  displayName: string;
  enabled: boolean;
  removable: boolean;
  source: 'preinstalled' | 'user' | 'config';
  capabilities: Record<string, unknown>;
  health: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
  lastCheckedAt: string;
  configSource: string;
  config: Record<string, unknown>;
  error?: string;
}

export interface ChannelDoctorResult {
  ok: boolean;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface GatewayStatus {
  status: 'running' | 'stopped';
  running: boolean;
  pid?: number;
  startedAt?: string;
  connectedChannelCount: number;
  enabledChannels: Array<{ id: string; healthy: boolean }>;
  pidFile: string;
  logFile: string;
}

export interface GatewayDoctorReport {
  ok: boolean;
  gateway: { running: boolean; pid?: number; startedAt?: string };
  channels: Array<{ id: string; healthy: boolean }>;
  paths: { root: string; pidFile: string; logFile: string; channelData: string };
}

export interface AgentSummary {
  id: string;
  name: string;
  summary: string;
  defaultProvider?: string;
  defaultModel?: string;
}

export interface AgentYamlResponse {
  id: string;
  yaml: string;
  updatedAt?: string;
}

export interface AgentValidationIssue {
  path: string;
  message: string;
  code?: 'schema' | 'unknown-field' | 'id-mismatch' | 'yaml-parse' | 'conflict';
}

export type AgentValidationResponse =
  | { ok: true; id: string; issues: [] }
  | { ok: false; id?: string; issues: AgentValidationIssue[] };

interface ManagementState {
  channels: ChannelSummary[];
  channelDoctor: ChannelDoctorResult | null;
  gateway: GatewayStatus | null;
  gatewayDoctor: GatewayDoctorReport | null;
  gatewayLogs: string[];
  agents: AgentSummary[];
  selectedAgentId: string | null;
  agentYaml: string;
  validation: AgentValidationResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  loadChannels: () => Promise<void>;
  enableChannel: (id: string) => Promise<void>;
  disableChannel: (id: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  runChannelDoctor: (id: string) => Promise<void>;
  setupChannel: (id: string) => Promise<void>;
  loadGateway: () => Promise<void>;
  startGateway: () => Promise<void>;
  stopGateway: () => Promise<void>;
  runGatewayDoctor: () => Promise<void>;
  loadGatewayLogs: () => Promise<void>;
  loadAgents: () => Promise<void>;
  selectAgent: (id: string) => Promise<void>;
  newAgent: () => void;
  setAgentYaml: (yaml: string) => void;
  validateAgent: (id?: string) => Promise<AgentValidationResponse | null>;
  saveAgent: () => Promise<boolean>;
  deleteAgent: (id: string) => Promise<void>;
}

export const NEW_AGENT_TEMPLATE = `id: my-agent
name: My Agent
systemPrompt: |
  You are a helpful assistant.
tools: []
defaultProvider: codex
defaultModel: gpt-5
`;

export const useManagementStore = create<ManagementState>((set, getState) => ({
  channels: [],
  channelDoctor: null,
  gateway: null,
  gatewayDoctor: null,
  gatewayLogs: [],
  agents: [],
  selectedAgentId: null,
  agentYaml: '',
  validation: null,
  loading: false,
  saving: false,
  error: null,
  loadChannels: async () => run(set, async () => {
    const response = await get<ChannelSummary[]>('/v1/channels');
    set({ channels: response.data });
  }),
  enableChannel: async (id) => run(set, async () => {
    await post<ChannelSummary>(`/v1/channels/${id}/enable`);
    await getState().loadChannels();
  }),
  disableChannel: async (id) => run(set, async () => {
    await post<ChannelSummary>(`/v1/channels/${id}/disable`);
    await getState().loadChannels();
  }),
  removeChannel: async (id) => run(set, async () => {
    await del<{ id: string; deleted: true }>(`/v1/channels/${id}`);
    await getState().loadChannels();
  }),
  runChannelDoctor: async (id) => run(set, async () => {
    const response = await get<ChannelDoctorResult>(`/v1/channels/${id}/doctor`);
    set({ channelDoctor: response.data });
  }),
  setupChannel: async (id) => run(set, async () => {
    await post(`/v1/channels/${id}/setup`);
    await getState().loadChannels();
  }),
  loadGateway: async () => run(set, async () => {
    const response = await get<GatewayStatus>('/v1/gateway');
    set({ gateway: response.data });
  }),
  startGateway: async () => run(set, async () => {
    const response = await post<GatewayStatus>('/v1/gateway/start');
    set({ gateway: response.data });
  }),
  stopGateway: async () => run(set, async () => {
    const response = await post<GatewayStatus>('/v1/gateway/stop');
    set({ gateway: response.data });
  }),
  runGatewayDoctor: async () => run(set, async () => {
    const response = await get<GatewayDoctorReport>('/v1/gateway/doctor');
    set({ gatewayDoctor: response.data });
  }),
  loadGatewayLogs: async () => run(set, async () => {
    const response = await get<{ logFile: string; lines: string[] }>('/v1/gateway/logs?lines=100');
    set({ gatewayLogs: response.data.lines });
  }),
  loadAgents: async () => run(set, async () => {
    const response = await get<AgentSummary[]>('/v1/agents');
    set({ agents: response.data });
  }),
  selectAgent: async (id) => run(set, async () => {
    const response = await get<AgentYamlResponse>(`/v1/agents/${id}/yaml`);
    set({ selectedAgentId: id, agentYaml: response.data.yaml, validation: null });
  }),
  newAgent: () => set({ selectedAgentId: null, agentYaml: NEW_AGENT_TEMPLATE, validation: null, error: null }),
  setAgentYaml: (yaml) => set({ agentYaml: yaml }),
  validateAgent: async (id) => {
    const targetId = id ?? getState().selectedAgentId ?? extractAgentId(getState().agentYaml);
    if (!targetId) return null;
    return run(set, async () => {
      const response = await post<AgentValidationResponse>(`/v1/agents/${targetId}/validate`, { yaml: getState().agentYaml });
      set({ validation: response.data });
      return response.data;
    });
  },
  saveAgent: async () => {
    set({ saving: true, error: null });
    try {
      const validation = await getState().validateAgent();
      if (!validation?.ok) {
        set({ saving: false });
        return false;
      }
      if (getState().selectedAgentId) {
        await put<AgentYamlResponse>(`/v1/agents/${getState().selectedAgentId}/yaml`, { yaml: getState().agentYaml });
      } else {
        await post<AgentYamlResponse>('/v1/agents', { yaml: getState().agentYaml });
        set({ selectedAgentId: validation.id });
      }
      await getState().loadAgents();
      set({ saving: false });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), saving: false });
      return false;
    }
  },
  deleteAgent: async (id) => run(set, async () => {
    await del(`/v1/agents/${id}`);
    set({ selectedAgentId: null, agentYaml: '', validation: null });
    await getState().loadAgents();
  }),
}));

async function run<T>(
  set: (partial: Partial<ManagementState>) => void,
  action: () => Promise<T>,
): Promise<T> {
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

function extractAgentId(yaml: string): string | null {
  const match = yaml.match(/^id:\s*([a-z0-9-]+)/m);
  return match?.[1] ?? null;
}
