import type { WebLogger } from './types.js';

export interface ApprovalConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewConversationReplyInput {
  approvalRequest: {
    id: string;
    title: string;
    level: string;
    targetKind: string;
    riskLevel: string;
    whyChange: string[];
    howChange: string[];
    expectedBenefits: string[];
    regressionRisks: string[];
  };
  messages: ApprovalConversationMessage[];
  onText?: (chunk: string) => void;
}

export interface ReviewConversationReplyResult {
  content: string;
  provider?: string;
  model?: string;
  sessionId?: string;
}

export interface ApprovalDecisionAutoApplyInput {
  requestId: string;
  proposalId: string;
  validationId: string;
  decisionId: string;
}

export interface ApprovalDecisionAutoApplyResult {
  attempted: boolean;
  status: 'applied' | 'blocked' | 'skipped' | 'error';
  proposalId: string;
  gateCode?: string;
  blockingReasons?: string[];
  applicationId?: string;
}

export interface WebRuntime {
  /** HARO_HOME root that contains evolution/approval-requests and auth DB. */
  root?: string;
  /** Optional project root retained for host-level diagnostics/log context. */
  projectRoot?: string;
  /** Optional SQLite DB path used by the local Web auth store. */
  dbFile?: string;
  /** Optional hook used by the CLI-hosted web server to run sidecar gated apply after approve. */
  autoApplyApprovedDecision?: (
    input: ApprovalDecisionAutoApplyInput,
  ) => ApprovalDecisionAutoApplyResult | Promise<ApprovalDecisionAutoApplyResult>;
  /** Optional Haro provider/modelhub-backed helper for request-changes review conversations. */
  reviewConversationReply?: (
    input: ReviewConversationReplyInput,
  ) => ReviewConversationReplyResult | Promise<ReviewConversationReplyResult>;
  logger: WebLogger;
  startedAt: number;
}
