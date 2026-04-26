import { create } from 'zustand';
import { getWorkflow, listWorkflows } from '@/api/client';
import type {
  WorkflowBranchReadModel,
  WorkflowDebugDetail,
  WorkflowDebugSummary,
} from '@/types';

interface WorkflowsState {
  items: WorkflowDebugSummary[];
  selectedWorkflowId: string | null;
  detail: WorkflowDebugDetail | null;
  loading: boolean;
  error: string | null;
  loadWorkflows: (filters?: { limit?: number }) => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
  refreshSelected: () => Promise<void>;
  clearSelection: () => void;
}

export const useWorkflowsStore = create<WorkflowsState>((set, getState) => ({
  items: [],
  selectedWorkflowId: null,
  detail: null,
  loading: false,
  error: null,
  loadWorkflows: async (filters = {}) => {
    set({ loading: true, error: null });
    try {
      const response = await listWorkflows(filters);
      const selectedWorkflowId = getState().selectedWorkflowId ?? response.data.items[0]?.workflowId ?? null;
      set({
        items: response.data.items,
        selectedWorkflowId,
        loading: false,
      });
      if (selectedWorkflowId && !getState().detail) {
        await getState().selectWorkflow(selectedWorkflowId);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  selectWorkflow: async (workflowId) => {
    set({ selectedWorkflowId: workflowId, loading: true, error: null });
    try {
      const response = await getWorkflow(workflowId);
      set({ detail: response.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  refreshSelected: async () => {
    const workflowId = getState().selectedWorkflowId;
    if (!workflowId) {
      await getState().loadWorkflows();
      return;
    }
    await Promise.all([getState().loadWorkflows(), getState().selectWorkflow(workflowId)]);
  },
  clearSelection: () => set({ selectedWorkflowId: null, detail: null, error: null }),
}));

export function isWorkflowBlocked(workflow: Pick<WorkflowDebugSummary, 'status' | 'blockedReason'>): boolean {
  return (
    workflow.status === 'blocked' ||
    workflow.status === 'needs-human-intervention' ||
    Boolean(workflow.blockedReason)
  );
}

export function isBranchStalled(branch: Pick<WorkflowBranchReadModel, 'status' | 'lastError'>): boolean {
  return (
    branch.status === 'failed' ||
    branch.status === 'timed-out' ||
    branch.status === 'cancelled' ||
    branch.status === 'blocked' ||
    Boolean(branch.lastError)
  );
}
