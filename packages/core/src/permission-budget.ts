import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { initHaroDatabase } from './db/init.js';
import { buildHaroPaths } from './paths.js';
import type { Complexity, RoutingDecision, SceneDescriptor } from './scenario-router.js';

export const OPERATION_CLASSES = [
  'read-local',
  'write-local',
  'execute-local',
  'network',
  'external-service',
  'archive',
  'delete',
  'credential',
  'budget-increase',
] as const;

export type OperationClass = (typeof OPERATION_CLASSES)[number];
export type OperationPolicy = 'allow' | 'dry-run-only' | 'needs-approval' | 'deny';
export type WriteLocalTargetScope = 'workspace' | 'haro-state' | 'outside-workspace' | 'unknown';
export type BudgetState = 'ok' | 'near-limit' | 'exceeded';
export type BudgetAuditEventType = 'budget-near-limit' | 'budget-exceeded';
export type PermissionAuditEventType = 'permission-decision' | BudgetAuditEventType;

export const DEFAULT_OPERATION_POLICIES: Record<OperationClass, OperationPolicy> = {
  'read-local': 'allow',
  'write-local': 'allow',
  'execute-local': 'allow',
  network: 'needs-approval',
  'external-service': 'needs-approval',
  archive: 'needs-approval',
  delete: 'deny',
  credential: 'deny',
  'budget-increase': 'needs-approval',
};

export const DEFAULT_WORKFLOW_TOKEN_LIMIT = 200_000;
export const DEFAULT_SOFT_LIMIT_RATIO = 0.8;

const POLICY_RANK: Record<OperationPolicy, number> = {
  allow: 0,
  'dry-run-only': 1,
  'needs-approval': 2,
  deny: 3,
};

const TEAM_TEMPLATE_BRANCH_ESTIMATES: Record<string, number> = {
  'parallel-research': 3,
  'debate-design-review': 2,
  'debate-review': 2,
  'pipeline-deterministic-tools': 3,
  'hub-spoke-analysis': 3,
};

const COMPLEXITY_BASE_ESTIMATED_TOKENS: Record<Complexity, number> = {
  simple: 8_000,
  moderate: 16_000,
  complex: 28_000,
};

export interface PermissionDecision {
  operationClass: OperationClass;
  policy: OperationPolicy;
  targetScope?: WriteLocalTargetScope;
  reason?: string;
  approvalRef?: string;
}

export interface OperationClassification {
  operationClass: OperationClass;
  targetScope?: WriteLocalTargetScope;
  targetRef?: string;
  reason: string;
}

export interface ClassifyOperationInput {
  operationClass?: OperationClass;
  command?: string;
  intent?: string;
  targetPath?: string;
  targetPaths?: string[];
  workspaceRoot?: string;
  haroRoot?: string;
  externalService?: string;
  credentialKey?: string;
  budgetDeltaTokens?: number;
}

export interface OperationPolicyOverride {
  operationClass: OperationClass;
  policy: OperationPolicy;
  targetScope?: WriteLocalTargetScope;
  reason?: string;
}

export interface ResolveOperationPolicyInput {
  classification?: OperationClassification;
  operationClass?: OperationClass;
  targetScope?: WriteLocalTargetScope;
  overrides?: readonly OperationPolicyOverride[];
  minimumPolicy?: OperationPolicy;
  approvalRef?: string;
  approved?: boolean;
}

export interface WorkflowBudgetEstimate {
  budgetId: string;
  estimatedBranches: number;
  estimatedTokens: number;
  limitTokens: number;
  softLimitRatio: number;
}

export interface WorkflowBudget {
  budgetId: string;
  workflowId: string;
  limitTokens: number;
  softLimitRatio: number;
  estimatedBranches: number;
  estimatedTokens: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  estimatedCost?: number;
  state: BudgetState;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenBudgetLedgerEntry {
  id: string;
  budgetId: string;
  workflowId: string;
  branchId?: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  createdAt: string;
}

export interface OperationAuditLogEntry {
  id: string;
  workflowId?: string;
  branchId?: string;
  agentId?: string;
  eventType: PermissionAuditEventType;
  operationClass?: OperationClass;
  policy?: OperationPolicy;
  outcome: string;
  targetScope?: WriteLocalTargetScope;
  targetRef?: string;
  reason?: string;
  approvalRef?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WorkflowPermissionBudgetSummary {
  workflowId: string;
  budget?: WorkflowBudget & {
    usedTotalTokens: number;
    nearLimit: boolean;
    exceeded: boolean;
  };
  ledger: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    entries: TokenBudgetLedgerEntry[];
  };
  permissions: {
    denied: number;
    needsApproval: number;
    events: OperationAuditLogEntry[];
  };
  audit: {
    events: OperationAuditLogEntry[];
  };
  budgetExceeded: boolean;
  blockedReason?: string;
}

export interface PermissionBudgetStoreOptions {
  db?: Database.Database;
  dbFile?: string;
  root?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface EnsureWorkflowBudgetInput {
  workflowId: string;
  budgetId?: string;
  estimate?: WorkflowBudgetEstimate;
  limitTokens?: number;
  softLimitRatio?: number;
  estimatedBranches?: number;
  estimatedTokens?: number;
}

export interface RecordTokenUsageInput {
  budgetId?: string;
  workflowId: string;
  branchId?: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  createdAt?: string;
}

export interface BudgetCheckInput {
  workflowId: string;
  budgetId?: string;
  branchId?: string;
  agentId?: string;
  action: 'branch-attempt' | 'retry' | 'merge';
}

export interface BudgetCheckResult {
  allowed: boolean;
  state: BudgetState;
  budget: WorkflowBudget;
  reason?: string;
}

interface WorkflowBudgetRow {
  budget_id: string;
  workflow_id: string;
  limit_tokens: number;
  soft_limit_ratio: number;
  estimated_branches: number;
  estimated_tokens: number;
  used_input_tokens: number;
  used_output_tokens: number;
  estimated_cost: number | null;
  state: BudgetState;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface TokenBudgetLedgerRow {
  id: string;
  budget_id: string;
  workflow_id: string;
  branch_id: string | null;
  agent_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number | null;
  created_at: string;
}

interface OperationAuditLogRow {
  id: string;
  workflow_id: string | null;
  branch_id: string | null;
  agent_id: string | null;
  event_type: PermissionAuditEventType;
  operation_class: OperationClass | null;
  policy: OperationPolicy | null;
  outcome: string;
  target_scope: WriteLocalTargetScope | null;
  target_ref: string | null;
  reason: string | null;
  approval_ref: string | null;
  metadata_json: string | null;
  created_at: string;
}

function policyRank(policy: OperationPolicy): number {
  return POLICY_RANK[policy];
}

export function stricterPolicy(left: OperationPolicy, right: OperationPolicy): OperationPolicy {
  return policyRank(left) >= policyRank(right) ? left : right;
}

export function strictestPolicy(policies: Iterable<OperationPolicy>): OperationPolicy {
  let current: OperationPolicy = 'allow';
  for (const policy of policies) {
    current = stricterPolicy(current, policy);
  }
  return current;
}

export function classifyOperation(input: ClassifyOperationInput): OperationClassification {
  const targetRef = formatTargetRef(input.targetPath, input.targetPaths);
  if (input.operationClass) {
    return {
      operationClass: input.operationClass,
      ...(input.operationClass === 'write-local'
        ? { targetScope: classifyWriteTargetScope(input) }
        : {}),
      ...(targetRef ? { targetRef } : {}),
      reason: `explicit operation class '${input.operationClass}'`,
    };
  }

  const normalized = [input.intent, input.command, targetRef, input.externalService, input.credentialKey]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (input.credentialKey || /\b(api[_-]?key|token|secret|credential|password|凭据|密钥|令牌)\b/.test(normalized)) {
    return { operationClass: 'credential', ...(targetRef ? { targetRef } : {}), reason: 'credential access detected' };
  }
  if (typeof input.budgetDeltaTokens === 'number' && input.budgetDeltaTokens > 0) {
    return { operationClass: 'budget-increase', reason: 'budget increase requested' };
  }
  if (input.externalService) {
    return {
      operationClass: 'external-service',
      targetRef: input.externalService,
      reason: `external service '${input.externalService}' requested`,
    };
  }
  if (/\b(rm|unlink|delete|remove)\b|删除/.test(normalized)) {
    return { operationClass: 'delete', ...(targetRef ? { targetRef } : {}), reason: 'delete-like operation detected' };
  }
  if (/\b(archive|rollback|shit)\b|归档/.test(normalized)) {
    return { operationClass: 'archive', ...(targetRef ? { targetRef } : {}), reason: 'archive operation detected' };
  }
  if (/\b(curl|wget|fetch|http|https|npm install|pnpm add|git fetch|git push)\b|网络/.test(normalized)) {
    return { operationClass: 'network', ...(targetRef ? { targetRef } : {}), reason: 'network operation detected' };
  }
  if (targetRef || (input.targetPaths && input.targetPaths.length > 0)) {
    return {
      operationClass: 'write-local',
      targetScope: classifyWriteTargetScope(input),
      targetRef,
      reason: 'local write target detected',
    };
  }
  if (input.command) {
    return { operationClass: 'execute-local', reason: 'local command execution detected' };
  }
  return { operationClass: 'read-local', reason: 'default local read classification' };
}

export function resolveOperationPolicy(input: ResolveOperationPolicyInput): PermissionDecision {
  const operationClass = input.classification?.operationClass ?? input.operationClass;
  if (!operationClass) {
    throw new Error('resolveOperationPolicy requires an operationClass or classification.');
  }

  const targetScope = input.classification?.targetScope ?? input.targetScope;
  const matchingOverrides = (input.overrides ?? []).filter(
    (override) =>
      override.operationClass === operationClass &&
      (override.targetScope === undefined || override.targetScope === targetScope),
  );
  const defaultPolicy = DEFAULT_OPERATION_POLICIES[operationClass];
  const overridePolicy = matchingOverrides.length > 0
    ? strictestPolicy(matchingOverrides.map((override) => override.policy))
    : defaultPolicy;
  const minimumPolicy = input.minimumPolicy
    ? stricterPolicy(overridePolicy, input.minimumPolicy)
    : overridePolicy;
  const approvalRef = input.approvalRef;
  const approved = input.approved === true || Boolean(approvalRef);
  const policy =
    minimumPolicy === 'needs-approval' && approved
      ? 'allow'
      : minimumPolicy;
  const overrideReason = matchingOverrides.map((override) => override.reason).filter(Boolean).join('; ');

  return {
    operationClass,
    policy,
    ...(targetScope ? { targetScope } : {}),
    reason:
      policy === 'allow' && minimumPolicy === 'needs-approval' && approved
        ? `approved via ${approvalRef ?? 'explicit approval'}`
        : overrideReason || input.classification?.reason || `default ${operationClass} policy is ${defaultPolicy}`,
    ...(approvalRef ? { approvalRef } : {}),
  };
}

export function resolveStrictestPermissionDecision(
  decision: PermissionDecision,
  minimumPolicy: OperationPolicy,
): PermissionDecision {
  const policy = stricterPolicy(decision.policy, minimumPolicy);
  return {
    ...decision,
    policy,
    reason:
      policy === decision.policy
        ? decision.reason
        : `${decision.reason ?? 'permission policy'}; stricter runtime policy requires ${minimumPolicy}`,
  };
}

export function createWorkflowBudgetEstimate(input: {
  workflowId: string;
  decision: Pick<RoutingDecision, 'executionMode' | 'workflowTemplateId'>;
  sceneDescriptor?: Pick<SceneDescriptor, 'complexity'>;
  limitTokens?: number;
  softLimitRatio?: number;
}): WorkflowBudgetEstimate {
  const estimatedBranches =
    input.decision.executionMode === 'single-agent'
      ? 1
      : TEAM_TEMPLATE_BRANCH_ESTIMATES[input.decision.workflowTemplateId] ?? 2;
  const complexity = input.sceneDescriptor?.complexity ?? 'moderate';
  const base = COMPLEXITY_BASE_ESTIMATED_TOKENS[complexity];
  const mergeOverhead = input.decision.executionMode === 'team' ? Math.ceil(base * 0.5) : 0;
  return {
    budgetId: `budget:${input.workflowId}`,
    estimatedBranches,
    estimatedTokens: estimatedBranches * base + mergeOverhead,
    limitTokens: input.limitTokens ?? DEFAULT_WORKFLOW_TOKEN_LIMIT,
    softLimitRatio: input.softLimitRatio ?? DEFAULT_SOFT_LIMIT_RATIO,
  };
}

export function extractTokenUsage(input: {
  finalEvent?: { type: string; usage?: { inputTokens: number; outputTokens: number } };
  events?: readonly { type: string; usage?: { inputTokens: number; outputTokens: number } }[];
}): { inputTokens: number; outputTokens: number } {
  if (input.finalEvent?.type === 'result' && input.finalEvent.usage) {
    return normalizeUsage(input.finalEvent.usage);
  }
  const result = [...(input.events ?? [])].reverse().find((event) => event.type === 'result' && event.usage);
  return normalizeUsage(result?.usage);
}

function normalizeUsage(usage: { inputTokens: number; outputTokens: number } | undefined): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: normalizeTokenCount(usage?.inputTokens),
    outputTokens: normalizeTokenCount(usage?.outputTokens),
  };
}

function normalizeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function classifyWriteTargetScope(input: ClassifyOperationInput): WriteLocalTargetScope {
  const targetRefs = input.targetPath ? [input.targetPath] : input.targetPaths ?? [];
  if (targetRefs.length === 0) return 'unknown';
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  const haroRoot = resolve(input.haroRoot ?? buildHaroPaths().root);
  const scopes = targetRefs.map((targetRef) => {
    const target = resolve(targetRef);
    if (isInside(target, workspaceRoot)) return 'workspace';
    if (isInside(target, haroRoot)) return 'haro-state';
    return 'outside-workspace';
  });
  return mostRestrictiveTargetScope(scopes);
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function formatTargetRef(targetPath: string | undefined, targetPaths: string[] | undefined): string | undefined {
  if (targetPath) return targetPath;
  if (!targetPaths || targetPaths.length === 0) return undefined;
  return targetPaths.join(',');
}

function mostRestrictiveTargetScope(scopes: WriteLocalTargetScope[]): WriteLocalTargetScope {
  if (scopes.includes('outside-workspace')) return 'outside-workspace';
  if (scopes.includes('haro-state')) return 'haro-state';
  if (scopes.includes('workspace')) return 'workspace';
  return 'unknown';
}

function deriveBudgetState(totalTokens: number, budget: Pick<WorkflowBudget, 'limitTokens' | 'softLimitRatio'>): BudgetState {
  if (totalTokens >= budget.limitTokens) return 'exceeded';
  if (totalTokens >= Math.floor(budget.limitTokens * budget.softLimitRatio)) return 'near-limit';
  return 'ok';
}

function budgetTotal(budget: Pick<WorkflowBudget, 'usedInputTokens' | 'usedOutputTokens'>): number {
  return budget.usedInputTokens + budget.usedOutputTokens;
}

function mapBudgetRow(row: WorkflowBudgetRow): WorkflowBudget {
  return {
    budgetId: row.budget_id,
    workflowId: row.workflow_id,
    limitTokens: row.limit_tokens,
    softLimitRatio: row.soft_limit_ratio,
    estimatedBranches: row.estimated_branches,
    estimatedTokens: row.estimated_tokens,
    usedInputTokens: row.used_input_tokens,
    usedOutputTokens: row.used_output_tokens,
    ...(row.estimated_cost !== null ? { estimatedCost: row.estimated_cost } : {}),
    state: row.state,
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLedgerRow(row: TokenBudgetLedgerRow): TokenBudgetLedgerEntry {
  return {
    id: row.id,
    budgetId: row.budget_id,
    workflowId: row.workflow_id,
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    ...(row.estimated_cost !== null ? { estimatedCost: row.estimated_cost } : {}),
    createdAt: row.created_at,
  };
}

function mapAuditRow(row: OperationAuditLogRow): OperationAuditLogEntry {
  return {
    id: row.id,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    eventType: row.event_type,
    ...(row.operation_class ? { operationClass: row.operation_class } : {}),
    ...(row.policy ? { policy: row.policy } : {}),
    outcome: row.outcome,
    ...(row.target_scope ? { targetScope: row.target_scope } : {}),
    ...(row.target_ref ? { targetRef: row.target_ref } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.approval_ref ? { approvalRef: row.approval_ref } : {}),
    ...(row.metadata_json ? { metadata: JSON.parse(row.metadata_json) as Record<string, unknown> } : {}),
    createdAt: row.created_at,
  };
}

function permissionOutcome(policy: OperationPolicy): string {
  if (policy === 'deny') return 'denied';
  if (policy === 'needs-approval') return 'needs-approval';
  if (policy === 'dry-run-only') return 'dry-run-only';
  return 'allowed';
}

export class PermissionBudgetStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: PermissionBudgetStoreOptions = {}) {
    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      const opened = initHaroDatabase({
        root: options.root,
        dbFile: options.dbFile,
        keepOpen: true,
      });
      this.db = opened.database!;
      this.ownsDb = true;
    }
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  ensureWorkflowBudget(input: EnsureWorkflowBudgetInput): WorkflowBudget {
    const now = this.timestamp();
    const estimate = input.estimate;
    const budgetId = input.budgetId ?? estimate?.budgetId ?? `budget:${input.workflowId}`;
    const limitTokens = input.limitTokens ?? estimate?.limitTokens ?? DEFAULT_WORKFLOW_TOKEN_LIMIT;
    const softLimitRatio = input.softLimitRatio ?? estimate?.softLimitRatio ?? DEFAULT_SOFT_LIMIT_RATIO;
    const estimatedBranches = input.estimatedBranches ?? estimate?.estimatedBranches ?? 1;
    const estimatedTokens = input.estimatedTokens ?? estimate?.estimatedTokens ?? 0;

    this.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_budgets (
          budget_id,
          workflow_id,
          limit_tokens,
          soft_limit_ratio,
          estimated_branches,
          estimated_tokens,
          used_input_tokens,
          used_output_tokens,
          estimated_cost,
          state,
          blocked_reason,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, 'ok', NULL, ?, ?)`,
      )
      .run(
        budgetId,
        input.workflowId,
        limitTokens,
        softLimitRatio,
        estimatedBranches,
        estimatedTokens,
        now,
        now,
      );

    this.db
      .prepare(
        `UPDATE workflow_budgets
            SET estimated_branches = CASE WHEN estimated_branches = 0 THEN ? ELSE estimated_branches END,
                estimated_tokens = CASE WHEN estimated_tokens = 0 THEN ? ELSE estimated_tokens END,
                updated_at = ?
          WHERE workflow_id = ?`,
      )
      .run(estimatedBranches, estimatedTokens, now, input.workflowId);

    const budget = this.readWorkflowBudget(input.workflowId);
    if (!budget) throw new Error(`Failed to create workflow budget for '${input.workflowId}'.`);
    return budget;
  }

  recordPermissionDecision(input: {
    workflowId?: string;
    branchId?: string;
    agentId?: string;
    decision: PermissionDecision;
    targetRef?: string;
    metadata?: Record<string, unknown>;
    auditAllow?: boolean;
  }): OperationAuditLogEntry | null {
    if (input.decision.policy === 'allow' && input.auditAllow !== true) return null;
    return this.recordAudit({
      workflowId: input.workflowId,
      branchId: input.branchId,
      agentId: input.agentId,
      eventType: 'permission-decision',
      operationClass: input.decision.operationClass,
      policy: input.decision.policy,
      outcome: permissionOutcome(input.decision.policy),
      targetScope: input.decision.targetScope,
      targetRef: input.targetRef,
      reason: input.decision.reason,
      approvalRef: input.decision.approvalRef,
      metadata: input.metadata,
    });
  }

  recordAudit(input: Omit<OperationAuditLogEntry, 'id' | 'createdAt'> & { createdAt?: string }): OperationAuditLogEntry {
    const entry: OperationAuditLogEntry = {
      id: this.createId(),
      eventType: input.eventType,
      outcome: input.outcome,
      createdAt: input.createdAt ?? this.timestamp(),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.operationClass ? { operationClass: input.operationClass } : {}),
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.targetScope ? { targetScope: input.targetScope } : {}),
      ...(input.targetRef ? { targetRef: input.targetRef } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.approvalRef ? { approvalRef: input.approvalRef } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO operation_audit_log (
          id,
          workflow_id,
          branch_id,
          agent_id,
          event_type,
          operation_class,
          policy,
          outcome,
          target_scope,
          target_ref,
          reason,
          approval_ref,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.workflowId ?? null,
        entry.branchId ?? null,
        entry.agentId ?? null,
        entry.eventType,
        entry.operationClass ?? null,
        entry.policy ?? null,
        entry.outcome,
        entry.targetScope ?? null,
        entry.targetRef ?? null,
        entry.reason ?? null,
        entry.approvalRef ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.createdAt,
      );
    return entry;
  }

  recordTokenUsage(input: RecordTokenUsageInput): TokenBudgetLedgerEntry {
    const budget = this.ensureWorkflowBudget({
      workflowId: input.workflowId,
      ...(input.budgetId ? { budgetId: input.budgetId } : {}),
    });
    const createdAt = input.createdAt ?? this.timestamp();
    const inputTokens = normalizeTokenCount(input.inputTokens);
    const outputTokens = normalizeTokenCount(input.outputTokens);
    const entry: TokenBudgetLedgerEntry = {
      id: this.createId(),
      budgetId: budget.budgetId,
      workflowId: input.workflowId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      agentId: input.agentId,
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
      ...(typeof input.estimatedCost === 'number' ? { estimatedCost: input.estimatedCost } : {}),
      createdAt,
    };

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO token_budget_ledger (
            id,
            budget_id,
            workflow_id,
            branch_id,
            agent_id,
            provider,
            model,
            input_tokens,
            output_tokens,
            estimated_cost,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.id,
          entry.budgetId,
          entry.workflowId,
          entry.branchId ?? null,
          entry.agentId,
          entry.provider,
          entry.model,
          entry.inputTokens,
          entry.outputTokens,
          entry.estimatedCost ?? null,
          entry.createdAt,
        );

      const nextBudget = this.applyUsageToBudget(input.workflowId, inputTokens, outputTokens, input.estimatedCost);
      this.db.exec('COMMIT');
      this.auditBudgetTransition(budget, nextBudget, {
        action: 'token-usage',
        branchId: input.branchId,
        agentId: input.agentId,
      });
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return entry;
  }

  checkBeforeBudgetedAction(input: BudgetCheckInput): BudgetCheckResult {
    const budget = this.ensureWorkflowBudget({
      workflowId: input.workflowId,
      ...(input.budgetId ? { budgetId: input.budgetId } : {}),
    });
    const total = budgetTotal(budget);
    const nextState = deriveBudgetState(total, budget);
    if (nextState !== budget.state) {
      this.updateBudgetState(budget.workflowId, nextState, nextState === 'exceeded' ? 'token budget exceeded' : undefined);
    }
    const current = this.readWorkflowBudget(input.workflowId) ?? budget;
    if (current.state === 'exceeded') {
      const reason = `token budget exceeded for ${input.action}`;
      this.recordBudgetAudit('budget-exceeded', current, reason, input);
      return { allowed: false, state: current.state, budget: current, reason };
    }
    if (current.state === 'near-limit') {
      const reason = `token budget near soft limit for ${input.action}`;
      this.recordBudgetAudit('budget-near-limit', current, reason, input);
      return { allowed: true, state: current.state, budget: current, reason };
    }
    return { allowed: true, state: current.state, budget: current };
  }

  readWorkflowBudget(workflowId: string): WorkflowBudget | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM workflow_budgets
          WHERE workflow_id = ?
          LIMIT 1`,
      )
      .get(workflowId) as WorkflowBudgetRow | undefined;
    return row ? mapBudgetRow(row) : null;
  }

  readWorkflowPermissionBudgetSummary(workflowId: string): WorkflowPermissionBudgetSummary {
    const budget = this.readWorkflowBudget(workflowId) ?? undefined;
    const ledger = this.db
      .prepare(
        `SELECT *
           FROM token_budget_ledger
          WHERE workflow_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      )
      .all(workflowId) as TokenBudgetLedgerRow[];
    const audit = this.db
      .prepare(
        `SELECT *
           FROM operation_audit_log
          WHERE workflow_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      )
      .all(workflowId) as OperationAuditLogRow[];
    return buildWorkflowSummary(workflowId, budget, ledger.map(mapLedgerRow), audit.map(mapAuditRow));
  }

  listWorkflowPermissionBudgetSummaries(limit = 20): WorkflowPermissionBudgetSummary[] {
    const rows = this.db
      .prepare(
        `SELECT workflow_id
           FROM workflow_budgets
       ORDER BY updated_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(Math.max(1, Math.min(100, Math.floor(limit)))) as Array<{ workflow_id: string }>;
    return rows.map((row) => this.readWorkflowPermissionBudgetSummary(row.workflow_id));
  }

  private applyUsageToBudget(
    workflowId: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCost: number | undefined,
  ): WorkflowBudget {
    const before = this.readWorkflowBudget(workflowId);
    if (!before) throw new Error(`Workflow budget '${workflowId}' does not exist.`);
    const usedInputTokens = before.usedInputTokens + inputTokens;
    const usedOutputTokens = before.usedOutputTokens + outputTokens;
    const total = usedInputTokens + usedOutputTokens;
    const state = deriveBudgetState(total, before);
    const blockedReason = state === 'exceeded' ? 'token budget exceeded' : before.blockedReason;
    const now = this.timestamp();
    this.db
      .prepare(
        `UPDATE workflow_budgets
            SET used_input_tokens = ?,
                used_output_tokens = ?,
                estimated_cost = COALESCE(estimated_cost, 0) + ?,
                state = ?,
                blocked_reason = ?,
                updated_at = ?
          WHERE workflow_id = ?`,
      )
      .run(usedInputTokens, usedOutputTokens, estimatedCost ?? 0, state, blockedReason ?? null, now, workflowId);
    return this.readWorkflowBudget(workflowId)!;
  }

  private updateBudgetState(workflowId: string, state: BudgetState, blockedReason?: string): void {
    this.db
      .prepare(
        `UPDATE workflow_budgets
            SET state = ?,
                blocked_reason = COALESCE(?, blocked_reason),
                updated_at = ?
          WHERE workflow_id = ?`,
      )
      .run(state, blockedReason ?? null, this.timestamp(), workflowId);
  }

  private auditBudgetTransition(
    before: WorkflowBudget,
    after: WorkflowBudget,
    metadata: Record<string, unknown>,
  ): void {
    if (before.state === after.state) return;
    const metadataAgentId = metadata.agentId;
    const metadataBranchId = metadata.branchId;
    if (after.state === 'near-limit') {
      this.recordBudgetAudit('budget-near-limit', after, 'token budget reached soft limit', {
        workflowId: after.workflowId,
        action: 'branch-attempt',
        branchId: typeof metadataBranchId === 'string' ? metadataBranchId : undefined,
        agentId: typeof metadataAgentId === 'string' ? metadataAgentId : undefined,
      });
    }
    if (after.state === 'exceeded') {
      this.recordBudgetAudit('budget-exceeded', after, 'token budget exceeded hard limit', {
        workflowId: after.workflowId,
        action: 'branch-attempt',
        branchId: typeof metadataBranchId === 'string' ? metadataBranchId : undefined,
        agentId: typeof metadataAgentId === 'string' ? metadataAgentId : undefined,
      });
    }
  }

  private recordBudgetAudit(
    eventType: BudgetAuditEventType,
    budget: WorkflowBudget,
    reason: string,
    input: BudgetCheckInput,
  ): OperationAuditLogEntry {
    return this.recordAudit({
      workflowId: budget.workflowId,
      branchId: input.branchId,
      agentId: input.agentId,
      eventType,
      operationClass: eventType === 'budget-exceeded' ? 'budget-increase' : undefined,
      policy: eventType === 'budget-exceeded' ? 'deny' : 'needs-approval',
      outcome: eventType === 'budget-exceeded' ? 'exceeded' : 'near-limit',
      reason,
      metadata: {
        action: input.action,
        budgetId: budget.budgetId,
        limitTokens: budget.limitTokens,
        usedTokens: budgetTotal(budget),
        softLimitRatio: budget.softLimitRatio,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function buildWorkflowSummary(
  workflowId: string,
  budget: WorkflowBudget | undefined,
  ledgerEntries: TokenBudgetLedgerEntry[],
  auditEvents: OperationAuditLogEntry[],
): WorkflowPermissionBudgetSummary {
  const totalInputTokens = ledgerEntries.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const totalOutputTokens = ledgerEntries.reduce((sum, entry) => sum + entry.outputTokens, 0);
  const estimatedCost = ledgerEntries.reduce((sum, entry) => sum + (entry.estimatedCost ?? 0), 0);
  const permissionEvents = auditEvents.filter((event) => event.eventType === 'permission-decision');
  const denied = permissionEvents.filter((event) => event.policy === 'deny').length;
  const needsApproval = permissionEvents.filter((event) => event.policy === 'needs-approval').length;
  const enrichedBudget = budget
    ? {
        ...budget,
        usedTotalTokens: budgetTotal(budget),
        nearLimit: budget.state === 'near-limit',
        exceeded: budget.state === 'exceeded',
      }
    : undefined;
  return {
    workflowId,
    ...(enrichedBudget ? { budget: enrichedBudget } : {}),
    ledger: {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      ...(estimatedCost > 0 ? { estimatedCost } : {}),
      entries: ledgerEntries,
    },
    permissions: {
      denied,
      needsApproval,
      events: permissionEvents,
    },
    audit: {
      events: auditEvents,
    },
    budgetExceeded: budget?.state === 'exceeded',
    ...(budget?.blockedReason ? { blockedReason: budget.blockedReason } : {}),
  };
}
