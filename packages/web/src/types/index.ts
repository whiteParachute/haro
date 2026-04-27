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

export type MemoryScope = 'platform' | 'shared' | 'agent';
export type MemoryLayer = 'session' | 'persistent' | 'skill';
export type VerificationStatus = 'unverified' | 'verified' | 'conflicted' | 'rejected';

export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  scope: 'platform' | 'shared' | `agent:${string}` | `project:${string}`;
  agentId?: string;
  topic: string;
  summary: string;
  content: string;
  contentPath?: string;
  sourceRef: string;
  assetRef?: string;
  verificationStatus: VerificationStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  rank: number;
  matchedBy: string[];
}

export interface MemoryQueryResponse {
  items: MemorySearchResult[];
  count: number;
  limit: number;
}

export interface MemoryQueryFilters {
  keyword?: string;
  scope?: MemoryScope | '';
  agentId?: string;
  layer?: MemoryLayer | '';
  verificationStatus?: VerificationStatus | '';
  limit?: number;
}

export interface MemoryWriteInput {
  scope: 'shared' | 'agent';
  agentId?: string;
  layer: MemoryLayer;
  topic: string;
  summary?: string;
  content: string;
  sourceRef?: string;
  assetRef?: string;
  verificationStatus?: VerificationStatus;
  tags?: string[];
}

export interface MemoryStats {
  root: string;
  totalEntries?: number;
  archivedEntries?: number;
  byLayer?: Partial<Record<MemoryLayer, number>>;
  byScope?: Record<string, number>;
  byVerificationStatus?: Partial<Record<VerificationStatus, number>>;
  lastMaintenanceAt?: string;
}

export interface MemoryMaintenanceTask {
  taskId: string;
  status: 'accepted';
  async: true;
}

export type SkillSource = 'preinstalled' | 'user';
export type SkillAssetStatus = 'proposed' | 'active' | 'archived' | 'rejected' | 'superseded' | 'missing';

export interface SkillSummary {
  id: string;
  source: SkillSource;
  enabled: boolean;
  installedAt: string;
  isPreinstalled: boolean;
  originalSource: string;
  pinnedCommit: string;
  license: string;
  description?: string;
  assetStatus: SkillAssetStatus;
  assetRef: string;
  lastUsedAt?: string;
  useCount: number;
}

export interface SkillDetail extends SkillSummary {
  descriptor: {
    id: string;
    description: string;
    content: string;
  };
  asset?: {
    id: string;
    status: SkillAssetStatus;
    updatedAt: string;
    events?: Array<{
      id: string;
      assetId: string;
      type: string;
      createdAt: string;
    }>;
  };
}

export interface SkillListResponse {
  items: SkillSummary[];
  count: number;
}

export interface SkillAuditResult {
  status: 'recorded' | 'missing';
  event?: {
    id: string;
    assetId: string;
    type: string;
    createdAt: string;
  };
  asset?: {
    id: string;
    status: SkillAssetStatus;
    updatedAt: string;
  };
}

export interface SkillMutationResponse {
  skill: SkillSummary;
  audit?: SkillAuditResult;
}

export interface LogSessionEventRecord {
  id: number;
  sessionId: string;
  agentId: string;
  provider: string;
  model: string;
  eventType: string;
  payload: JsonValue | string | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface ProviderFallbackRecord {
  id: number;
  sessionId: string;
  originalProvider: string;
  originalModel: string;
  fallbackProvider: string;
  fallbackModel: string;
  trigger: string;
  ruleId?: string | null;
  createdAt: string;
}

export interface LogSessionEventFilters {
  sessionId?: string;
  agentId?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ProviderStats {
  provider: string;
  model: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export type ProviderStatsWindow = '24h' | '7d' | 'all';

export interface ProviderStatsResponse {
  windows: Record<ProviderStatsWindow, ProviderStats[]>;
  generatedAt: string;
}
