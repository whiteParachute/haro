export type Theme = 'light' | 'dark' | 'system';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type WebUserRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type WebUserStatus = 'active' | 'disabled';

export interface WebUser {
  id: string;
  username: string;
  displayName: string;
  role: WebUserRole;
  status?: WebUserStatus;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
}

export interface Ref {
  id: string;
  kind: string;
  uri?: string;
}

export type EvolutionLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type ProposalTargetKind =
  | 'prompt'
  | 'skill'
  | 'runner-profile'
  | 'routing-rule'
  | 'mcp-tool-config'
  | 'schedule-config'
  | 'haro-code'
  | 'agentdock-contract';
export type ApprovalDecisionOption = 'approve' | 'reject' | 'request-changes';
export type ApprovalLifecycleStatus = 'undecided' | 'approved' | 'rejected' | 'applied' | 'rolled-back';
export type ApprovalConversationRole = 'user' | 'assistant';

export interface RollbackPlan {
  strategy: string;
  snapshotRequired: boolean;
  rollbackRefs: Ref[];
}

export interface ApprovalRequestRecord {
  id: string;
  proposalId: string;
  validationId: string;
  status: 'pending';
  title: string;
  level: EvolutionLevel;
  targetKind: ProposalTargetKind;
  riskLevel: 'low' | 'medium' | 'high';
  sourceRef: Ref;
  validationRef: Ref;
  whyChange: string[];
  howChange: string[];
  expectedBenefits: string[];
  scope?: string[];
  requiredTests: string[];
  manualChecks: string[];
  regressionRisks: string[];
  rollbackPlan: RollbackPlan;
  decisionOptions: ApprovalDecisionOption[];
  reviewerInstruction: string;
  humanReviewRequired: true;
  evidenceRefs: Ref[];
  descriptionRewrittenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDecisionRecord {
  id: string;
  approvalRequestId: string;
  proposalId: string;
  validationId: string;
  decision: ApprovalDecisionOption;
  direction?: string;
  reviewer: {
    source: 'haro-web';
    userId?: string;
    username?: string;
    role?: string;
  };
  sourceRef: Ref;
  approvalRef?: Ref;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestLifecycle {
  status: ApprovalLifecycleStatus;
  decision?: {
    id: string;
    decision: ApprovalDecisionOption;
    direction?: string;
    reviewer: ApprovalDecisionRecord['reviewer'];
    createdAt: string;
    updatedAt: string;
  };
  application?: {
    id: string;
    status: 'ready' | 'blocked' | 'applied' | 'rolled-back';
    gateCode: string;
    applied: boolean;
    snapshotId?: string;
    rollbackId?: string;
    assetEventIds: string[];
    blockingReasons: string[];
    createdAt: string;
    updatedAt: string;
  };
  assetEvents: Array<{
    id: string;
    eventType: string;
    status: string;
    assetId: string;
    kind: string;
    contentHash: string;
    createdAt: string;
  }>;
  snapshot?: {
    id: string;
    createdAt: string;
    entryCount: number;
    assetIds: string[];
  };
  rollback?: {
    id: string;
    createdAt: string;
    reversible: boolean;
    entryCount: number;
    rolledBack: boolean;
  };
  proposalContent?: {
    contentHashes: string[];
    contentRefs: string[];
    targetRefs: string[];
  };
}



export type ApprovalRequestRevisionLabel = 'original' | 'revision' | 'superseded-source';

export interface ApprovalRequestRevisionFeedbackItem {
  id: string;
  category: string;
  disposition: string;
  userText: string;
  normalizedRequirement: string;
  explanation: string;
}

export interface ApprovalRequestRevisionView {
  isRevision: boolean;
  label: ApprovalRequestRevisionLabel;
  rootProposalId?: string;
  revisionOfProposalId?: string;
  revisionDepth?: number;
  sourceApprovalRequestId?: string;
  sourceDecisionId?: string;
  sourceDecisionDirection?: string;
  sourceConversationRefs: string[];
  resubmissionReason?: string;
  incorporatedFeedback: ApprovalRequestRevisionFeedbackItem[];
  unresolvedFeedback: ApprovalRequestRevisionFeedbackItem[];
  supersedesProposalIds: string[];
  supersedesBlockedEventIds: string[];
  noOpCheck?: {
    verdict: string;
    changedFields: string[];
    reason: string;
    priorProposalContentHashes: string[];
    revisedProposalContentHashes: string[];
    priorSemanticFingerprint?: string;
    revisedSemanticFingerprint?: string;
    revisionDepth: number;
  };
  supersededBy?: {
    proposalId: string;
    approvalRequestId?: string;
    revisionDepth?: number;
    sourceDecisionId?: string;
  };
}

export interface ApprovalRequestView {
  request: ApprovalRequestRecord;
  latestDecision?: ApprovalDecisionRecord;
  lifecycle: ApprovalRequestLifecycle;
  revision: ApprovalRequestRevisionView;
}

export interface ApprovalConversationMessage {
  id: string;
  role: ApprovalConversationRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalConversationRecord {
  id: string;
  associatedApprovalRequestId: string;
  proposalId: string;
  validationId: string;
  messages: ApprovalConversationMessage[];
  createdAt: string;
  updatedAt: string;
}
