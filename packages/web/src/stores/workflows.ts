import { create } from 'zustand';
import { get } from '@/api/client';

export interface WorkflowSummary {
  workflowId: string;
  executionMode: string;
  orchestrationMode?: string;
  templateId: string;
  workflowTemplateId?: string;
  status: 'running' | 'merge-ready' | 'merged' | 'failed' | 'cancelled' | 'timed-out' | 'blocked';
  createdAt: string;
  updatedAt: string;
  currentNodeId: string;
  latestCheckpointRef?: string;
  blockedReason?: 'permission' | 'budget' | 'validator' | 'tool-failure' | 'timeout' | 'unknown';
  budgetState?: { budgetId: string; usedTokens: number; limitTokens: number; state: string };
  permissionState?: { requiredClass?: string; state: 'allowed' | 'needs-approval' | 'denied' };
}

export interface BranchLedgerEntry {
  branchId: string;
  memberKey: string;
  status: string;
  attempt: number;
  startedAt?: string;
  lastEventAt?: string;
  lastError?: string;
  leafSessionRef?: unknown;
  outputRef?: string;
  consumedByMerge: boolean;
}

export interface WorkflowCheckpointDebug {
  checkpointId: string;
  workflowId: string;
  nodeId: string;
  nodeType?: string;
  createdAt: string;
  state: Record<string, unknown>;
}

export interface WorkflowDetail extends WorkflowSummary {
  latestCheckpoint?: WorkflowCheckpointDebug;
  branchLedger: BranchLedgerEntry[];
  stalledBranches: BranchLedgerEntry[];
  mergeEnvelope?: unknown;
  leafSessionRefs: unknown[];
  rawContextRefs: unknown[];
  branchState: Record<string, unknown>;
  checkpointTimeline: WorkflowCheckpointDebug[];
  permissionBudget?: unknown;
}

interface WorkflowState {
  items: WorkflowSummary[];
  total: number;
  selectedWorkflowId: string | null;
  detail: WorkflowDetail | null;
  loading: boolean;
  error: string | null;
  loadWorkflows: () => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  items: [],
  total: 0,
  selectedWorkflowId: null,
  detail: null,
  loading: false,
  error: null,
  loadWorkflows: async () => {
    set({ loading: true, error: null });
    try {
      const response = await get<{ items: WorkflowSummary[]; total: number }>('/v1/workflows');
      set({ items: response.data.items, total: response.data.total, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  selectWorkflow: async (workflowId) => {
    set({ loading: true, error: null, selectedWorkflowId: workflowId });
    try {
      const response = await get<WorkflowDetail>(`/v1/workflows/${workflowId}`);
      set({ detail: response.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
}));
