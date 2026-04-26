export type Theme = 'light' | 'dark' | 'system';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'merge-ready'
  | 'merged'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'blocked'
  | 'needs-human-intervention'
  | 'unknown';

export type WorkflowExecutionMode = 'single-agent' | 'team' | 'unknown';

export type WorkflowOrchestrationMode =
  | 'parallel'
  | 'debate'
  | 'pipeline'
  | 'hub-spoke'
  | 'evolution-loop'
  | 'unknown';

export type WorkflowBlockedReason =
  | 'permission'
  | 'budget'
  | 'validator'
  | 'tool-failure'
  | 'timeout'
  | 'unknown';

export interface WorkflowBudgetState {
  budgetId?: string;
  usedTokens?: number;
  limitTokens?: number;
  state: 'ok' | 'near-limit' | 'exceeded' | 'unknown';
}

export interface WorkflowPermissionState {
  requiredClass?: string;
  state: 'allowed' | 'needs-approval' | 'denied' | 'unknown';
}

export interface WorkflowLeafSessionRef {
  sessionId: string;
  continuationRef?: string;
  providerResponseId?: string;
  retryOfSessionId?: string;
}

export interface WorkflowBranchLedgerEntry {
  branchId: string;
  nodeId?: string;
  memberKey?: string;
  status: string;
  attempt?: number;
  startedAt?: string;
  lastEventAt?: string;
  completedAt?: string;
  lastError?: string;
  leafSessionRef?: WorkflowLeafSessionRef;
  outputRef?: string;
  consumedByMerge?: boolean;
}

export type WorkflowBranchReadModel = WorkflowBranchLedgerEntry;

export interface WorkflowMergeEnvelope {
  workflowId?: string;
  nodeId?: string;
  status?: string;
  consumedBranches?: string[];
  blockedReason?: WorkflowBlockedReason | string;
  body?: JsonValue;
  createdAt?: string;
}

export interface WorkflowSummary {
  workflowId: string;
  executionMode: WorkflowExecutionMode;
  orchestrationMode?: WorkflowOrchestrationMode;
  workflowTemplateId?: string;
  templateId?: string;
  status: WorkflowStatus;
  createdAt?: string;
  updatedAt?: string;
  currentNodeId?: string;
  blockedReason?: WorkflowBlockedReason | string;
  budgetState?: WorkflowBudgetState;
  permissionState?: WorkflowPermissionState;
}

export interface WorkflowDebugSummary extends WorkflowSummary {
  latestCheckpointRef?: string;
  recentCheckpointRef?: string;
  stalledBranches?: WorkflowBranchReadModel[];
}

export interface WorkflowDetail extends WorkflowSummary {
  branchLedger: WorkflowBranchLedgerEntry[];
  mergeEnvelope?: WorkflowMergeEnvelope | null;
  leafSessionRefs: WorkflowLeafSessionRef[];
  rawContextRefs: JsonValue[];
  latestCheckpointRef?: string;
  stalledBranches: WorkflowBranchLedgerEntry[];
}

export interface WorkflowDebugDetail extends WorkflowDebugSummary {
  branchLedger: WorkflowBranchReadModel[];
  stalledBranches: WorkflowBranchReadModel[];
  mergeEnvelope?: WorkflowMergeEnvelope | JsonValue | null;
  mergeState?: JsonValue;
  leafSessionRefs: WorkflowLeafSessionRef[];
  rawContextRefs: JsonValue[];
  latestCheckpointRef?: string;
  recentCheckpointRef?: string;
  checkpoints: WorkflowCheckpointMetadata[];
  budgetPermissionSummary?: JsonValue;
}

export interface WorkflowListResponse {
  items: WorkflowDebugSummary[];
  count?: number;
  limit?: number;
}

export interface WorkflowCheckpointMetadata {
  checkpointId: string;
  workflowId?: string;
  nodeId?: string | null;
  nodeType?: string | null;
  status?: WorkflowStatus | string | null;
  createdAt?: string;
  updatedAt?: string;
  latest?: boolean;
  parseError?: string;
}

export interface WorkflowCheckpointDetail extends WorkflowCheckpointMetadata {
  rawJson?: JsonValue;
  sceneDescriptor?: JsonValue;
  routingDecision?: JsonValue;
  branchState?: {
    branches?: WorkflowBranchLedgerEntry[];
    merge?: WorkflowMergeEnvelope | JsonValue | null;
    [key: string]: JsonValue | WorkflowBranchLedgerEntry[] | WorkflowMergeEnvelope | undefined;
  };
  leafSessionRefs?: WorkflowLeafSessionRef[];
  rawContextRefs?: JsonValue[];
  budgetState?: WorkflowBudgetState;
  permissionState?: WorkflowPermissionState;
}
