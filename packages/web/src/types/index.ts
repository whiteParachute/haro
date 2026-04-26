export type Theme = 'light' | 'dark' | 'system';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type WorkflowStatus =
  | 'running'
  | 'merge-ready'
  | 'merged'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'blocked'
  | 'needs-human-intervention'
  | 'unknown';

export type WorkflowBlockedReason =
  | 'permission'
  | 'budget'
  | 'validator'
  | 'tool-failure'
  | 'timeout'
  | 'unknown';

export type WorkflowPermissionState = 'allowed' | 'needs-approval' | 'denied';
export type WorkflowBudgetState = 'ok' | 'near-limit' | 'exceeded';

export interface WorkflowBranchReadModel {
  branchId: string;
  memberKey: string;
  status: string;
  attempt: number;
  nodeId?: string;
  startedAt?: string;
  lastEventAt?: string;
  finishedAt?: string;
  lastError?: string;
  leafSessionRef?: {
    nodeId?: string;
    sessionId?: string;
    continuationRef?: string;
    providerResponseId?: string;
    [key: string]: unknown;
  };
  outputRef?: string;
  consumedByMerge: boolean;
  branchRole?: string;
}

export interface WorkflowBudgetReadModel {
  budgetId: string;
  usedTokens: number;
  limitTokens: number;
  state: WorkflowBudgetState;
}

export interface WorkflowPermissionReadModel {
  requiredClass?: string;
  state: WorkflowPermissionState;
}

export interface WorkflowCheckpointMetadata {
  checkpointId: string;
  nodeId: string;
  nodeType?: string;
  createdAt: string;
  parseError?: string;
}

export interface WorkflowDebugSummary {
  workflowId: string;
  status: WorkflowStatus;
  executionMode: string;
  orchestrationMode?: string;
  templateId: string;
  workflowTemplateId: string;
  currentNodeId: string;
  latestCheckpointRef?: string;
  createdAt: string;
  updatedAt: string;
  blockedReason?: WorkflowBlockedReason;
  budgetState?: WorkflowBudgetReadModel;
  permissionState?: WorkflowPermissionReadModel;
  stalledBranches: WorkflowBranchReadModel[];
  checkpointError?: {
    checkpointId: string;
    message: string;
  };
}

export interface WorkflowDebugDetail extends WorkflowDebugSummary {
  branchLedger: WorkflowBranchReadModel[];
  mergeEnvelope?: unknown;
  mergeState?: unknown;
  leafSessionRefs: unknown[];
  rawContextRefs: unknown[];
  recentCheckpointRef?: string;
  checkpoints: WorkflowCheckpointMetadata[];
  budgetPermissionSummary: unknown;
}

export interface WorkflowListResponse {
  items: WorkflowDebugSummary[];
  limit: number;
}
