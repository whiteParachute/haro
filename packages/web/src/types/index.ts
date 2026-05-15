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
  requiredTests: string[];
  manualChecks: string[];
  regressionRisks: string[];
  rollbackPlan: RollbackPlan;
  decisionOptions: ApprovalDecisionOption[];
  reviewerInstruction: string;
  humanReviewRequired: true;
  evidenceRefs: Ref[];
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

export interface ApprovalRequestView {
  request: ApprovalRequestRecord;
  latestDecision?: ApprovalDecisionRecord;
}

export interface DailyFrontierRunStep {
  name: string;
  command: string;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped?: boolean;
}

export interface DailyFrontierRunRecord {
  id: string;
  status: 'success' | 'error';
  startedAt: string;
  completedAt: string;
  cron: string;
  sourceConfigPath?: string;
  generatedSourceConfigPath?: string;
  collectCommandConfigured: boolean;
  steps: DailyFrontierRunStep[];
  error?: string;
}

export interface DailyFrontierStatus {
  enabled: boolean;
  cron: string;
  nextRunAt: string | null;
  running: boolean;
  sourceConfigPath: string;
  collectCommandConfigured: boolean;
  runDirectory: string;
  lastRun?: DailyFrontierRunRecord;
}
