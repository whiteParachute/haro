import { randomUUID } from 'node:crypto';
import { DEFAULT_AGENT_ID } from './agent/index.js';
import {
  PermissionBudgetStore,
  createWorkflowBudgetEstimate,
  extractTokenUsage,
  type WorkflowBudget,
  type WorkflowBudgetEstimate,
} from './permission-budget.js';
import type { RunAgentInput, RunAgentResult } from './runtime/index.js';
import {
  CheckpointStore,
  type LeafSessionRef,
  type OrchestrationMode,
  type RawContextRef,
  type ResumeTarget,
  type RoutingDecision,
  type ScenarioWorkflow,
  type WorkflowCheckpoint,
  type WorkflowCheckpointState,
} from './scenario-router.js';

export const BRANCH_STATUS_VALUES = [
  'pending',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'merge-consumed',
] as const;

export type BranchStatus = (typeof BRANCH_STATUS_VALUES)[number];
export type TeamStatus =
  | 'planned'
  | 'running'
  | 'needs-human-intervention'
  | 'merge-ready'
  | 'merged'
  | 'failed'
  | 'cancelled'
  | 'timed-out';
export type MergeStatus = 'pending' | 'ready' | 'completed' | 'blocked';
export type MergeEnvelopeStatus = 'ready' | 'completed' | 'blocked';
export type TeamOrchestrationMode = Exclude<OrchestrationMode, 'evolution-loop'>;
export type MergeCheckpointPhase = 'fork-dispatch' | 'leaf-terminal' | 'merge';
export type MergeSourceBranchStatus = 'completed' | 'failed' | 'cancelled' | 'timed-out' | 'skipped';
export type DebateRole = 'proposer' | 'critic';
export type HubSpokeRole = 'slice';
export type PipelineStepType = 'deterministic-tool';

export const FORBIDDEN_CRITIC_OUTPUT_KEYS = [
  'fix',
  'patch',
  'implementationPlan',
  'revisedProposal',
  'delegateTo',
] as const;

export interface BranchEvidenceItem {
  summary: string;
  evidenceRefs: string[];
}

export interface CriticOutput {
  issues: BranchEvidenceItem[];
  risks?: BranchEvidenceItem[];
  counterExamples?: BranchEvidenceItem[];
  uncoveredEdges?: BranchEvidenceItem[];
}

export interface BranchExecutionOutput {
  content: string;
  evidenceRefs: string[];
  responseId?: string;
  structured?: unknown;
}

export interface BranchTokenUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
}

export interface BranchLedgerEntry {
  workflowId: string;
  branchId: string;
  nodeId: string;
  memberKey: string;
  instructions: string;
  mode: TeamOrchestrationMode;
  status: BranchStatus;
  attempt: number;
  leafSessionRef?: LeafSessionRef;
  outputRef?: string;
  output?: BranchExecutionOutput;
  usage?: BranchTokenUsage;
  consumedByMerge: boolean;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  branchRole?: DebateRole | HubSpokeRole | PipelineStepType | 'candidate';
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface ParallelMergeBody {
  kind: 'parallel';
  candidates: Array<{
    branchId: string;
    outputRef: string;
    confidence?: number;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    id: string;
    summary: string;
    type: 'observation' | 'conflict' | 'gap';
    sourceBranchIds: string[];
    evidenceRefs: string[];
  }>;
  decision: {
    mode: 'select-one' | 'select-many' | 'union' | 'blocked';
    selectedBranchIds: string[];
    rationale: string;
    evidenceRefs: string[];
  };
}

export interface DebateMergeBody {
  kind: 'debate';
  candidates: Array<{
    branchId: string;
    role: 'proposer';
    outputRef: string;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    branchId: string;
    role: 'critic';
    summary: string;
    severity: 'low' | 'medium' | 'high';
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'accepted' | 'accepted-with-risk' | 'blocked' | 'needs-replan';
    rationale: string;
    evidenceRefs: string[];
  };
}

export interface PipelineMergeBody {
  kind: 'pipeline';
  candidates: Array<{
    stepId: string;
    outputRef: string;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    stepId: string;
    summary: string;
    type: 'step-output' | 'warning' | 'failure';
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'completed' | 'blocked' | 'partial';
    rationale: string;
    evidenceRefs: string[];
  };
}

export interface HubSpokeMergeBody {
  kind: 'hub-spoke';
  candidates: Array<{
    branchId: string;
    outputRef: string;
    role: 'slice';
    evidenceRefs: string[];
  }>;
  findings: Array<{
    summary: string;
    type: 'synthesis' | 'gap' | 'conflict';
    sourceBranchIds: string[];
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'synthesized' | 'blocked';
    rationale: string;
    evidenceRefs: string[];
  };
}

export type MergeEnvelopeBody =
  | ParallelMergeBody
  | DebateMergeBody
  | PipelineMergeBody
  | HubSpokeMergeBody;

export interface MergeEnvelope {
  workflowId: string;
  mergeNodeId: string;
  orchestrationMode: TeamOrchestrationMode;
  status: MergeEnvelopeStatus;
  sourceBranches: Array<{
    branchId: string;
    nodeId: string;
    status: MergeSourceBranchStatus;
    outputRef?: string;
  }>;
  consumedBranches: string[];
  checkpointRef: string;
  evidenceRefs: string[];
  body: MergeEnvelopeBody;
}

export interface TeamBranchState {
  teamStatus: TeamStatus;
  activeNodeId: string;
  branches: Record<string, BranchLedgerEntry>;
  merge?: {
    status: MergeStatus;
    consumedBranches: string[];
    envelopeRef?: string;
    envelope?: MergeEnvelope;
  };
  workflowDeadline?: string;
  leafTimeoutMs?: Record<string, number>;
  fallbackExecutionMode?: 'single-agent' | null;
  teamOrchestratorPending?: boolean;
  workflow?: ScenarioWorkflow;
  budget?: WorkflowBudget;
}

export interface TeamBranchBlueprint {
  memberKey: string;
  nodeId: string;
  instructions: string;
  branchRole?: DebateRole | HubSpokeRole | PipelineStepType | 'candidate';
  metadata?: Record<string, string | number | boolean | null | undefined>;
  leafTimeoutMs?: number;
  upstreamBranchId?: string;
  deterministicToolStep?: boolean;
  reasoningAllowed?: boolean;
}

interface TeamTemplateMetadata {
  id: string;
  mode: TeamOrchestrationMode;
  mergeStrategy: string;
  branches: TeamBranchBlueprint[];
  pipeline?: {
    strictFailFast: boolean;
    requiresDeterministicToolchain: true;
  };
}

export interface TeamOrchestratorAgentRunner {
  run(input: RunAgentInput): Promise<RunAgentResult>;
}

interface DispatchBranchInput {
  rawContextRefs?: RawContextRef[];
  agentId?: string;
  upstreamOutputRef?: string;
  reviewTargetOutputRef?: string;
  leafTimeoutMs?: number;
  timeoutErrorFactory?: () => Error;
}

export interface MergeSynthesisInput {
  mode: TeamOrchestrationMode;
  branches: BranchLedgerEntry[];
}

export interface TeamOrchestratorOptions {
  agentRunner: TeamOrchestratorAgentRunner;
  checkpointStore: CheckpointStore;
  now?: () => Date;
  createId?: () => string;
  defaultAgentId?: string;
  workflowTimeoutMs?: number;
  leafTimeoutMs?: number;
  budgetStore?: PermissionBudgetStore;
  budgetEstimate?: WorkflowBudgetEstimate;
  mergeSynthesizer?: (input: MergeSynthesisInput) => Promise<MergeEnvelopeBody> | MergeEnvelopeBody;
}

export interface TeamCheckpointWriteInput {
  workflow: ScenarioWorkflow;
  decision: RoutingDecision;
  rawContextRefs: RawContextRef[];
  branchState: TeamBranchState;
}

export interface TeamWorkflowExecutionResult {
  workflow: ScenarioWorkflow;
  state: TeamBranchState;
  envelope: MergeEnvelope;
}

export interface TeamWorkflowResumeResult {
  workflow: ScenarioWorkflow;
  state: TeamBranchState;
  envelope?: MergeEnvelope;
  resumeTarget: ResumeTarget | null;
  checkpoint: WorkflowCheckpoint;
}

const DEFAULT_WORKFLOW_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_LEAF_TIMEOUT_MS = 5 * 60 * 1000;
const MERGE_NODE_ID = 'merge-1';
const DISPATCH_NODE_ID = 'dispatch-1';

const TEAM_TEMPLATES: Record<string, TeamTemplateMetadata> = {
  'parallel-research': {
    id: 'parallel-research',
    mode: 'parallel',
    mergeStrategy: 'union',
    branches: [
      {
        memberKey: 'local-code-source',
        nodeId: 'parallel-branch-1',
        instructions: '覆盖本地代码与仓库内实现线索。',
        metadata: { splitDimension: 'information-source', source: 'local-code' },
      },
      {
        memberKey: 'official-doc-source',
        nodeId: 'parallel-branch-2',
        instructions: '覆盖协议、文档与外部/内建知识来源。',
        metadata: { splitDimension: 'information-source', source: 'docs' },
      },
      {
        memberKey: 'historical-memory-source',
        nodeId: 'parallel-branch-3',
        instructions: '覆盖历史记忆、变更记录与已有经验。',
        metadata: { splitDimension: 'information-source', source: 'memory' },
      },
    ],
  },
  'debate-design-review': {
    id: 'debate-design-review',
    mode: 'debate',
    mergeStrategy: 'adversarial-eval',
    branches: [
      {
        memberKey: 'design-proposer',
        nodeId: 'debate-branch-1',
        instructions: '产出完整方案候选。',
        branchRole: 'proposer',
        metadata: { splitDimension: 'stance', stance: 'proposal' },
      },
      {
        memberKey: 'design-critic',
        nodeId: 'debate-branch-2',
        instructions: '仅输出问题、风险、反例与未覆盖边界。',
        branchRole: 'critic',
        metadata: { splitDimension: 'stance', stance: 'adversarial' },
      },
    ],
  },
  'debate-review': {
    id: 'debate-review',
    mode: 'debate',
    mergeStrategy: 'adversarial-eval',
    branches: [
      {
        memberKey: 'review-proposer',
        nodeId: 'debate-branch-1',
        instructions: '提出完整评审结论或候选判断。',
        branchRole: 'proposer',
        metadata: { splitDimension: 'stance', stance: 'proposal' },
      },
      {
        memberKey: 'review-critic',
        nodeId: 'debate-branch-2',
        instructions: '仅输出否定意见与风险，不提供修复方案。',
        branchRole: 'critic',
        metadata: { splitDimension: 'stance', stance: 'adversarial' },
      },
    ],
  },
  'pipeline-deterministic-tools': {
    id: 'pipeline-deterministic-tools',
    mode: 'pipeline',
    mergeStrategy: 'ordered-steps',
    pipeline: {
      strictFailFast: true,
      requiresDeterministicToolchain: true,
    },
    branches: [
      {
        memberKey: 'collect-inputs',
        nodeId: 'pipeline-step-1',
        instructions: '执行确定性输入收集与归档。',
        branchRole: 'deterministic-tool',
        deterministicToolStep: true,
        reasoningAllowed: false,
        metadata: { splitDimension: 'tool-step', step: 'collect-inputs' },
      },
      {
        memberKey: 'normalize-output',
        nodeId: 'pipeline-step-2',
        instructions: '执行确定性格式规范化。',
        branchRole: 'deterministic-tool',
        deterministicToolStep: true,
        reasoningAllowed: false,
        metadata: { splitDimension: 'tool-step', step: 'normalize-output' },
      },
      {
        memberKey: 'publish-artifact',
        nodeId: 'pipeline-step-3',
        instructions: '执行确定性产物发布。',
        branchRole: 'deterministic-tool',
        deterministicToolStep: true,
        reasoningAllowed: false,
        metadata: { splitDimension: 'tool-step', step: 'publish-artifact' },
      },
    ],
  },
  'hub-spoke-analysis': {
    id: 'hub-spoke-analysis',
    mode: 'hub-spoke',
    mergeStrategy: 'synthesis',
    branches: [
      {
        memberKey: 'code-slice',
        nodeId: 'hub-spoke-branch-1',
        instructions: '覆盖本地代码切片与实现路径。',
        branchRole: 'slice',
        metadata: { splitDimension: 'information-slice', slice: 'code' },
      },
      {
        memberKey: 'doc-slice',
        nodeId: 'hub-spoke-branch-2',
        instructions: '覆盖文档、协议与规范切片。',
        branchRole: 'slice',
        metadata: { splitDimension: 'information-slice', slice: 'docs' },
      },
      {
        memberKey: 'ci-log-slice',
        nodeId: 'hub-spoke-branch-3',
        instructions: '覆盖 CI、日志与运行时观测切片。',
        branchRole: 'slice',
        metadata: { splitDimension: 'information-slice', slice: 'ci-logs' },
      },
    ],
  },
};

const TERMINAL_BRANCH_STATUSES = new Set<BranchStatus>([
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'merge-consumed',
]);

const MERGE_SOURCE_BRANCH_STATUSES = new Set<MergeSourceBranchStatus>([
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'skipped',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneLeafSessionRef(ref: LeafSessionRef | undefined): LeafSessionRef | undefined {
  return ref
    ? {
        nodeId: ref.nodeId,
        sessionId: ref.sessionId,
        continuationRef: ref.continuationRef,
        providerResponseId: ref.providerResponseId,
      }
    : undefined;
}

function cloneBranchOutput(output: BranchExecutionOutput | undefined): BranchExecutionOutput | undefined {
  return output
    ? {
        content: output.content,
        evidenceRefs: [...output.evidenceRefs],
        responseId: output.responseId,
        structured: output.structured,
      }
    : undefined;
}

function cloneBranchUsage(usage: BranchTokenUsage | undefined): BranchTokenUsage | undefined {
  return usage ? { ...usage } : undefined;
}

function cloneBranch(entry: BranchLedgerEntry): BranchLedgerEntry {
  return {
    ...entry,
    leafSessionRef: cloneLeafSessionRef(entry.leafSessionRef),
    output: cloneBranchOutput(entry.output),
    usage: cloneBranchUsage(entry.usage),
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
  };
}

function cloneWorkflow(workflow: ScenarioWorkflow): ScenarioWorkflow {
  return {
    ...workflow,
    budget: workflow.budget ? { ...workflow.budget } : undefined,
    nodes: workflow.nodes.map((node) => ({ ...node })),
    leafSessionRefs: workflow.leafSessionRefs.map((ref) => ({ ...ref })),
  };
}

function cloneState(state: TeamBranchState): TeamBranchState {
  return {
    ...state,
    branches: Object.fromEntries(
      Object.entries(state.branches).map(([branchId, entry]) => [branchId, cloneBranch(entry)]),
    ),
    merge: state.merge
      ? {
          ...state.merge,
          consumedBranches: [...state.merge.consumedBranches],
          envelope: state.merge.envelope ? cloneEnvelope(state.merge.envelope) : undefined,
        }
      : undefined,
    leafTimeoutMs: state.leafTimeoutMs ? { ...state.leafTimeoutMs } : undefined,
    workflow: state.workflow ? cloneWorkflow(state.workflow) : undefined,
    budget: state.budget ? { ...state.budget } : undefined,
  };
}

function cloneEnvelopeBody(body: MergeEnvelopeBody): MergeEnvelopeBody {
  return JSON.parse(JSON.stringify(body)) as MergeEnvelopeBody;
}

function cloneEnvelope(envelope: MergeEnvelope): MergeEnvelope {
  return {
    ...envelope,
    sourceBranches: envelope.sourceBranches.map((branch) => ({ ...branch })),
    consumedBranches: [...envelope.consumedBranches],
    evidenceRefs: [...envelope.evidenceRefs],
    body: cloneEnvelopeBody(envelope.body),
  };
}

export function isTerminalBranchStatus(status: BranchStatus): boolean {
  return TERMINAL_BRANCH_STATUSES.has(status);
}

export function assertValidCriticOutput(value: unknown): asserts value is CriticOutput {
  if (!isObject(value)) {
    throw new Error('CriticOutput must be an object.');
  }

  for (const forbiddenKey of FORBIDDEN_CRITIC_OUTPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, forbiddenKey)) {
      throw new Error(`CriticOutput must not contain '${forbiddenKey}'.`);
    }
  }

  if (!Array.isArray(value.issues)) {
    throw new Error('CriticOutput.issues must be an array.');
  }

  for (const field of ['issues', 'risks', 'counterExamples', 'uncoveredEdges'] as const) {
    const items = value[field];
    if (items === undefined) continue;
    if (!Array.isArray(items)) {
      throw new Error(`CriticOutput.${field} must be an array when provided.`);
    }
    for (const item of items) {
      if (!isObject(item) || typeof item.summary !== 'string' || !Array.isArray(item.evidenceRefs)) {
        throw new Error(`CriticOutput.${field} entries must contain summary and evidenceRefs.`);
      }
    }
  }
}

export function validateMergeEnvelope(envelope: MergeEnvelope): void {
  if (!envelope.workflowId || !envelope.mergeNodeId || !envelope.checkpointRef) {
    throw new Error('MergeEnvelope must contain workflowId, mergeNodeId, and checkpointRef.');
  }
  if (!Array.isArray(envelope.sourceBranches) || envelope.sourceBranches.length === 0) {
    throw new Error('MergeEnvelope.sourceBranches must not be empty.');
  }
  for (const source of envelope.sourceBranches) {
    if (!MERGE_SOURCE_BRANCH_STATUSES.has(source.status)) {
      throw new Error(`MergeEnvelope source branch status '${source.status}' is invalid.`);
    }
  }
  if (!Array.isArray(envelope.consumedBranches) || !Array.isArray(envelope.evidenceRefs)) {
    throw new Error('MergeEnvelope consumedBranches and evidenceRefs must be arrays.');
  }
  if (envelope.body.kind !== envelope.orchestrationMode) {
    throw new Error('MergeEnvelope body kind must match orchestrationMode.');
  }
  validateMergeBody(envelope.body);
}

function validateMergeBody(body: MergeEnvelopeBody): void {
  switch (body.kind) {
    case 'parallel':
      assertMergeBodySections(body, 'Parallel');
      return;
    case 'debate':
      assertMergeBodySections(body, 'Debate');
      return;
    case 'pipeline':
      assertMergeBodySections(body, 'Pipeline');
      return;
    case 'hub-spoke':
      assertMergeBodySections(body, 'Hub-spoke');
      return;
    default:
      throw new Error('Unsupported merge body kind.');
  }
}

function assertMergeBodySections(
  body: { candidates: unknown; findings: unknown; decision: unknown },
  label: string,
): void {
  if (!Array.isArray(body.candidates) || !Array.isArray(body.findings) || !isObject(body.decision)) {
    throw new Error(`${label} merge body must contain candidates, findings, and decision.`);
  }
}

function ensureTeamDecision(workflow: ScenarioWorkflow, decision: RoutingDecision): TeamOrchestrationMode {
  if (decision.executionMode !== 'team' || workflow.executionMode !== 'team') {
    throw new Error('TeamOrchestrator only accepts team workflows.');
  }
  const mode = decision.orchestrationMode ?? workflow.orchestrationMode;
  if (!mode || mode === 'evolution-loop') {
    throw new Error('Phase 1 TeamOrchestrator only supports parallel, debate, pipeline, and hub-spoke.');
  }
  return mode;
}

function resolveTemplate(workflow: ScenarioWorkflow, mode: TeamOrchestrationMode): TeamTemplateMetadata {
  const template = TEAM_TEMPLATES[workflow.workflowTemplateId];
  if (!template) {
    throw new Error(`Unsupported team workflow template '${workflow.workflowTemplateId}'.`);
  }
  if (template.mode !== mode) {
    throw new Error(
      `Workflow template '${workflow.workflowTemplateId}' is declared as '${template.mode}', not '${mode}'.`,
    );
  }
  return template;
}

function ensureValidPipelineTemplate(workflow: ScenarioWorkflow, template: TeamTemplateMetadata): void {
  if (template.mode !== 'pipeline') return;
  if (!template.pipeline?.requiresDeterministicToolchain) {
    throw new Error('Pipeline template metadata must declare deterministic-toolchain enforcement.');
  }
  if (workflow.sceneDescriptor?.taskType !== 'deterministic-toolchain') {
    throw new Error('Pipeline workflows are only valid for deterministic-toolchain scenes.');
  }
  for (const branch of template.branches) {
    if (branch.deterministicToolStep !== true || branch.reasoningAllowed !== false) {
      throw new Error(`Pipeline branch '${branch.memberKey}' must be a deterministic non-reasoning tool step.`);
    }
  }
}

function workflowBudgetEstimate(
  workflow: ScenarioWorkflow,
  fallback?: WorkflowBudgetEstimate,
): WorkflowBudgetEstimate {
  return workflow.budget ?? fallback ?? createWorkflowBudgetEstimate({
    workflowId: workflow.workflowId,
    decision: {
      executionMode: workflow.executionMode,
      workflowTemplateId: workflow.workflowTemplateId,
    },
    sceneDescriptor: workflow.sceneDescriptor,
  });
}

function branchAllocatedTokens(estimate: WorkflowBudgetEstimate): number {
  return Math.max(1, Math.ceil(estimate.limitTokens / Math.max(1, estimate.estimatedBranches)));
}

function toTimestamp(date: Date): string {
  return date.toISOString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorFactory: () => Error): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(errorFactory()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function recordLeafSessionRef(refs: LeafSessionRef[], ref: LeafSessionRef): LeafSessionRef[] {
  const next: LeafSessionRef[] = [];
  let matched = false;
  for (const item of refs) {
    if (item.nodeId === ref.nodeId && item.sessionId === ref.sessionId) {
      if (!matched) {
        next.push({ ...item, ...ref });
        matched = true;
      }
      continue;
    }
    next.push({ ...item });
  }
  if (!matched) {
    next.unshift({ ...ref });
  }
  return next;
}

function normalizeSourceStatus(status: BranchStatus): MergeSourceBranchStatus {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'timed-out':
      return status;
    case 'merge-consumed':
      return 'completed';
    default:
      return 'skipped';
  }
}

function deriveEnvelopeStatus(body: MergeEnvelopeBody): MergeEnvelopeStatus {
  switch (body.kind) {
    case 'parallel':
      return body.decision.mode === 'blocked' ? 'blocked' : 'completed';
    case 'debate':
      return body.decision.outcome === 'blocked' ? 'blocked' : 'completed';
    case 'pipeline':
      return body.decision.outcome === 'blocked' ? 'blocked' : 'completed';
    case 'hub-spoke':
      return body.decision.outcome === 'blocked' ? 'blocked' : 'completed';
    default:
      throw new Error('Unsupported merge body kind.');
  }
}

function extractStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function toEvidenceRefs(branch: BranchLedgerEntry): string[] {
  const refs = new Set<string>();
  if (branch.outputRef) refs.add(branch.outputRef);
  for (const ref of branch.output?.evidenceRefs ?? []) {
    refs.add(ref);
  }
  return [...refs];
}

function buildOutputRef(branch: BranchLedgerEntry): string {
  return `workflow://${branch.workflowId}/branches/${branch.branchId}/attempt/${branch.attempt}`;
}

function buildBudgetBlockedBody(
  mode: TeamOrchestrationMode,
  branches: BranchLedgerEntry[],
  reason: string,
): MergeEnvelopeBody {
  const evidenceRefs = branches.flatMap((branch) => toEvidenceRefs(branch));
  switch (mode) {
    case 'parallel':
      return {
        kind: 'parallel',
        candidates: [],
        findings: [
          {
            id: 'budget-exceeded',
            summary: reason,
            type: 'gap',
            sourceBranchIds: branches.map((branch) => branch.branchId),
            evidenceRefs,
          },
        ],
        decision: {
          mode: 'blocked',
          selectedBranchIds: [],
          rationale: reason,
          evidenceRefs,
        },
      };
    case 'debate':
      return {
        kind: 'debate',
        candidates: [],
        findings: branches.map((branch) => ({
          branchId: branch.branchId,
          role: 'critic',
          summary: reason,
          severity: 'high',
          evidenceRefs: toEvidenceRefs(branch),
        })),
        decision: {
          outcome: 'blocked',
          rationale: reason,
          evidenceRefs,
        },
      };
    case 'pipeline':
      return {
        kind: 'pipeline',
        candidates: [],
        findings: branches.map((branch) => ({
          stepId: branch.branchId,
          summary: reason,
          type: 'failure',
          evidenceRefs: toEvidenceRefs(branch),
        })),
        decision: {
          outcome: 'blocked',
          rationale: reason,
          evidenceRefs,
        },
      };
    case 'hub-spoke':
      return {
        kind: 'hub-spoke',
        candidates: [],
        findings: [
          {
            summary: reason,
            type: 'gap',
            sourceBranchIds: branches.map((branch) => branch.branchId),
            evidenceRefs,
          },
        ],
        decision: {
          outcome: 'blocked',
          rationale: reason,
          evidenceRefs,
        },
      };
    default:
      throw new Error(`Unsupported merge mode '${mode satisfies never}'.`);
  }
}

function buildBudgetBlockedEnvelope(
  workflow: ScenarioWorkflow,
  mode: TeamOrchestrationMode,
  branches: BranchLedgerEntry[],
  checkpointRef: string,
  reason: string,
): MergeEnvelope {
  const evidenceRefs = [...new Set(branches.flatMap((branch) => toEvidenceRefs(branch)))];
  const envelope: MergeEnvelope = {
    workflowId: workflow.workflowId,
    mergeNodeId: MERGE_NODE_ID,
    orchestrationMode: mode,
    status: 'blocked',
    sourceBranches: branches.map((branch) => ({
      branchId: branch.branchId,
      nodeId: branch.nodeId,
      status: normalizeSourceStatus(branch.status),
      ...(branch.outputRef ? { outputRef: branch.outputRef } : {}),
    })),
    consumedBranches: [],
    checkpointRef,
    evidenceRefs,
    body: buildBudgetBlockedBody(mode, branches, reason),
  };
  validateMergeEnvelope(envelope);
  return envelope;
}

function parseCriticPayload(branch: BranchLedgerEntry): CriticOutput {
  const structured = branch.output?.structured;
  if (structured !== undefined) {
    assertValidCriticOutput(structured);
    return structured;
  }

  const parsed = extractStructuredOutput(branch.output?.content ?? '');
  if (parsed !== undefined) {
    assertValidCriticOutput(parsed);
    return parsed;
  }

  return {
    issues: [
      {
        summary: branch.output?.content ?? 'critic reported an unspecified issue',
        evidenceRefs: toEvidenceRefs(branch),
      },
    ],
  };
}

function extractConfidence(branch: BranchLedgerEntry): number | undefined {
  const raw = branch.metadata?.confidence;
  return typeof raw === 'number' ? raw : undefined;
}

function inferDebateSeverity(summary: string): 'low' | 'medium' | 'high' {
  const normalized = summary.toLowerCase();
  if (normalized.includes('critical') || normalized.includes('blocked') || normalized.includes('fatal')) {
    return 'high';
  }
  if (normalized.includes('risk') || normalized.includes('warning') || normalized.includes('gap')) {
    return 'medium';
  }
  return 'low';
}

function asTeamBranchState(value: unknown): TeamBranchState | null {
  if (!isObject(value) || !isObject(value.branches)) {
    return null;
  }
  return value as unknown as TeamBranchState;
}

function computeDeadline(now: Date, timeoutMs: number): string {
  return new Date(now.getTime() + timeoutMs).toISOString();
}

function isWorkflowExpired(state: TeamBranchState, now: Date): boolean {
  return typeof state.workflowDeadline === 'string' && Date.parse(state.workflowDeadline) <= now.getTime();
}

function branchShouldRun(branch: BranchLedgerEntry): boolean {
  return !branch.consumedByMerge && !['completed', 'merge-consumed'].includes(branch.status);
}

function hasPendingMergeWork(state: TeamBranchState): boolean {
  return Object.values(state.branches).some((branch) => !branch.consumedByMerge && branch.status !== 'merge-consumed');
}

function isWorkflowDeadlineCancellation(branch: BranchLedgerEntry): boolean {
  return (
    branch.status === 'cancelled' &&
    typeof branch.lastError === 'string' &&
    branch.lastError.startsWith('workflow deadline reached')
  );
}

function markOutstandingBranchesCancelled(state: TeamBranchState, now: string): void {
  for (const branch of Object.values(state.branches)) {
    if (isTerminalBranchStatus(branch.status)) continue;
    branch.status = 'cancelled';
    branch.finishedAt = now;
    branch.lastError = branch.lastError ?? 'workflow deadline reached';
  }
}

export class TeamOrchestrator {
  private readonly agentRunner: TeamOrchestratorAgentRunner;
  private readonly checkpointStore: CheckpointStore;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly defaultAgentId: string;
  private readonly workflowTimeoutMs: number;
  private readonly leafTimeoutMs: number;
  private readonly budgetStore?: PermissionBudgetStore;
  private readonly budgetEstimate?: WorkflowBudgetEstimate;
  private readonly mergeSynthesizer: (input: MergeSynthesisInput) => Promise<MergeEnvelopeBody>;

  constructor(options: TeamOrchestratorOptions) {
    this.agentRunner = options.agentRunner;
    this.checkpointStore = options.checkpointStore;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.defaultAgentId = options.defaultAgentId ?? DEFAULT_AGENT_ID;
    this.workflowTimeoutMs = options.workflowTimeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS;
    this.leafTimeoutMs = options.leafTimeoutMs ?? DEFAULT_LEAF_TIMEOUT_MS;
    this.budgetStore = options.budgetStore;
    this.budgetEstimate = options.budgetEstimate;
    this.mergeSynthesizer = async (input) =>
      (await options.mergeSynthesizer?.(input)) ?? this.defaultMergeSynthesis(input);
  }

  async executeWorkflow(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
  ): Promise<TeamWorkflowExecutionResult> {
    const mode = ensureTeamDecision(workflow, decision);
    const branches = this.expandBranches(workflow);
    const state = this.createInitialState(workflow, branches);

    this.writeCheckpoint('fork-dispatch', {
      workflow,
      decision,
      rawContextRefs,
      branchState: state,
    });

    if (mode === 'pipeline') {
      await this.executePipeline(workflow, decision, rawContextRefs, state);
    } else if (mode === 'debate') {
      await this.executeDebate(workflow, decision, rawContextRefs, state);
    } else {
      await Promise.all(
        Object.values(state.branches).map(async (branch) => {
          await this.executeBranch(workflow, decision, rawContextRefs, state, branch.branchId);
        }),
      );
    }

    const envelope = await this.finalizeMerge(workflow, decision, rawContextRefs, state);
    return {
      workflow: cloneWorkflow(workflow),
      state: cloneState(state),
      envelope: cloneEnvelope(envelope),
    };
  }

  expandBranches(workflow: ScenarioWorkflow): BranchLedgerEntry[] {
    if (workflow.executionMode !== 'team') {
      throw new Error('Cannot expand branches for a non-team workflow.');
    }
    const mode = workflow.orchestrationMode;
    if (!mode || mode === 'evolution-loop') {
      throw new Error('Cannot expand branches without a supported orchestrationMode.');
    }
    const template = resolveTemplate(workflow, mode);
    ensureValidPipelineTemplate(workflow, template);

    return template.branches.map((branch) => ({
      workflowId: workflow.workflowId,
      branchId: `${workflow.workflowId}:${branch.memberKey}`,
      nodeId: branch.nodeId,
      memberKey: branch.memberKey,
      instructions: branch.instructions,
      mode,
      status: 'pending',
      attempt: 0,
      consumedByMerge: false,
      branchRole: branch.branchRole,
      metadata: branch.metadata ? { ...branch.metadata } : undefined,
    }));
  }

  async dispatchBranch(
    branch: BranchLedgerEntry,
    agentRunner: TeamOrchestratorAgentRunner,
    input?: DispatchBranchInput,
  ): Promise<BranchLedgerEntry> {
    const next = cloneBranch(branch);
    const startedAt = toTimestamp(this.now());
    next.status = 'dispatched';
    next.startedAt = startedAt;
    next.finishedAt = undefined;
    next.lastError = undefined;
    next.attempt = Math.max(1, next.attempt + 1);
    next.status = 'running';

    try {
      const timeoutMs = input?.leafTimeoutMs ?? this.leafTimeoutMs;
      const retryOfSessionId =
        next.attempt > 1 && next.leafSessionRef?.sessionId ? next.leafSessionRef.sessionId : undefined;
      const result = await withTimeout(
        agentRunner.run({
          agentId: input?.agentId ?? this.defaultAgentId,
          task: this.buildBranchTask(
            next,
            input?.rawContextRefs ?? [],
            input?.upstreamOutputRef,
            input?.reviewTargetOutputRef,
          ),
          ...(retryOfSessionId ? { retryOfSessionId } : {}),
          continueLatestSession: false,
        }),
        timeoutMs,
        input?.timeoutErrorFactory ?? (() => new Error(`Branch '${next.branchId}' timed out after ${timeoutMs}ms.`)),
      );
      const usage = extractTokenUsage({ finalEvent: result.finalEvent, events: result.events });
      next.usage = {
        provider: result.provider,
        model: result.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };

      next.leafSessionRef = {
        nodeId: next.nodeId,
        sessionId: result.sessionId,
        ...(result.finalEvent.type === 'result' && result.finalEvent.responseId
          ? { providerResponseId: result.finalEvent.responseId }
          : {}),
      };

      if (result.finalEvent.type === 'result') {
        next.output = {
          content: result.finalEvent.content,
          evidenceRefs: [`session://${result.sessionId}`],
          responseId: result.finalEvent.responseId,
          structured: extractStructuredOutput(result.finalEvent.content),
        };
        next.outputRef = buildOutputRef(next);
        next.status = 'completed';
      } else {
        next.lastError = `[${result.finalEvent.code}] ${result.finalEvent.message}`;
        next.status = 'failed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.lastError = message;
      next.status = message.includes('workflow deadline reached')
        ? 'cancelled'
        : message.includes('timed out')
          ? 'timed-out'
          : 'failed';
    }

    next.finishedAt = toTimestamp(this.now());
    return next;
  }

  async runMerge(
    branches: BranchLedgerEntry[],
    options?: { alreadyConsumedBranchIds?: Iterable<string> },
  ): Promise<MergeEnvelope> {
    if (branches.length === 0) {
      throw new Error('Cannot merge an empty branch set.');
    }
    const mode = branches[0]?.mode;
    const workflowId = branches[0]?.workflowId;
    if (!mode || !workflowId) {
      throw new Error('Merge branches must contain workflowId and mode.');
    }
    if (branches.some((branch) => branch.mode !== mode || branch.workflowId !== workflowId)) {
      throw new Error('All merge branches must belong to the same workflow and orchestration mode.');
    }

    const body = await this.mergeSynthesizer({ mode, branches: branches.map(cloneBranch) });
    const alreadyConsumedBranchIds = new Set(options?.alreadyConsumedBranchIds ?? []);
    const consumedBranches = branches
      .filter(
        (branch) =>
          isTerminalBranchStatus(branch.status) &&
          !branch.consumedByMerge &&
          !alreadyConsumedBranchIds.has(branch.branchId),
      )
      .map((branch) => branch.branchId);
    const evidenceRefs = new Set<string>();
    for (const branch of branches) {
      for (const ref of toEvidenceRefs(branch)) {
        evidenceRefs.add(ref);
      }
    }

    const envelope: MergeEnvelope = {
      workflowId,
      mergeNodeId: MERGE_NODE_ID,
      orchestrationMode: mode,
      status:
        deriveEnvelopeStatus(body),
      sourceBranches: branches.map((branch) => ({
        branchId: branch.branchId,
        nodeId: branch.nodeId,
        status: normalizeSourceStatus(branch.status),
        ...(branch.outputRef ? { outputRef: branch.outputRef } : {}),
      })),
      consumedBranches,
      checkpointRef: `checkpoint://${workflowId}/${MERGE_NODE_ID}/${this.createId()}`,
      evidenceRefs: [...evidenceRefs],
      body,
    };
    validateMergeEnvelope(envelope);
    return envelope;
  }

  writeCheckpoint(
    phase: MergeCheckpointPhase,
    state: TeamCheckpointWriteInput,
  ): WorkflowCheckpoint {
    const checkpointCreatedAt = toTimestamp(this.now());
    const nodeId =
      phase === 'fork-dispatch'
        ? DISPATCH_NODE_ID
        : phase === 'merge'
          ? MERGE_NODE_ID
          : state.branchState.activeNodeId;
    const nodeType: WorkflowCheckpointState['nodeType'] =
      phase === 'merge' ? 'merge' : phase === 'leaf-terminal' ? 'agent' : 'team';
    const workflowSnapshot = cloneWorkflow(state.branchState.workflow ?? state.workflow);
    for (const ref of Object.values(state.branchState.branches)
      .map((branch) => branch.leafSessionRef)
      .filter((ref): ref is LeafSessionRef => Boolean(ref))) {
      workflowSnapshot.leafSessionRefs = recordLeafSessionRef(workflowSnapshot.leafSessionRefs, ref);
    }

    return this.checkpointStore.save({
      workflowId: state.workflow.workflowId,
      nodeId,
      state: {
        workflowId: state.workflow.workflowId,
        nodeId,
        nodeType,
        sceneDescriptor: state.workflow.sceneDescriptor ?? {
          taskType: 'code',
          complexity: 'moderate',
          collaborationNeed: 'team',
          timeSensitivity: 'realtime',
        },
        routingDecision: {
          ...state.decision,
          orchestrationMode: state.workflow.orchestrationMode,
        },
        budget: workflowSnapshot.budget ?? workflowBudgetEstimate(state.workflow, this.budgetEstimate),
        rawContextRefs: state.rawContextRefs.map((ref) => ({ ...ref })),
        branchState: {
          ...cloneState(state.branchState),
          workflow: workflowSnapshot,
        },
        leafSessionRefs: workflowSnapshot.leafSessionRefs,
        createdAt: checkpointCreatedAt,
      },
    });
  }

  async resumeWorkflow(workflowId: string): Promise<TeamWorkflowResumeResult | null> {
    const checkpoint = this.checkpointStore.loadLatest(workflowId);
    if (!checkpoint) {
      return null;
    }

    const workflow = this.hydrateWorkflow(checkpoint.state);
    const decision = checkpoint.state.routingDecision;
    const rawContextRefs = checkpoint.state.rawContextRefs;
    const state = this.hydrateState(workflow, checkpoint.state.branchState);
    const resumeTarget = this.checkpointStore.resolveResume(workflowId);

    if (!state.merge) {
      state.merge = { status: 'pending', consumedBranches: [] };
    }

    if (state.merge.status === 'ready' && state.merge.envelope) {
      const envelope = this.commitPreparedMerge(workflow, decision, rawContextRefs, state, state.merge.envelope);
      return {
        workflow: cloneWorkflow(workflow),
        state: cloneState(state),
        envelope: cloneEnvelope(envelope),
        resumeTarget,
        checkpoint,
      };
    }

    if (state.merge.status !== 'completed' && hasPendingMergeWork(state)) {
      if (workflow.orchestrationMode === 'pipeline') {
        await this.executePipeline(workflow, decision, rawContextRefs, state);
      } else if (workflow.orchestrationMode === 'debate') {
        await this.executeDebate(workflow, decision, rawContextRefs, state);
      } else {
        for (const branch of Object.values(state.branches)) {
          if (!branchShouldRun(branch)) continue;
          await this.executeBranch(workflow, decision, rawContextRefs, state, branch.branchId);
        }
      }
    }

    let envelope = state.merge.envelope;
    if (state.merge.status !== 'completed' && state.merge.status !== 'blocked') {
      envelope = await this.finalizeMerge(workflow, decision, rawContextRefs, state);
    }

    return {
      workflow: cloneWorkflow(workflow),
      state: cloneState(state),
      ...(envelope ? { envelope: cloneEnvelope(envelope) } : {}),
      resumeTarget,
      checkpoint,
    };
  }

  private createInitialState(
    workflow: ScenarioWorkflow,
    branches: BranchLedgerEntry[],
  ): TeamBranchState {
    const template = resolveTemplate(workflow, workflow.orchestrationMode as TeamOrchestrationMode);
    const now = this.now();
    const estimate = workflowBudgetEstimate(workflow, this.budgetEstimate);
    const budget = this.budgetStore?.ensureWorkflowBudget({
      workflowId: workflow.workflowId,
      estimate,
    });
    const allocatedTokens = branchAllocatedTokens(estimate);
    return {
      teamStatus: 'running',
      activeNodeId: DISPATCH_NODE_ID,
      branches: Object.fromEntries(
        branches.map((branch) => [
          branch.branchId,
          {
            ...cloneBranch(branch),
            metadata: {
              ...(branch.metadata ?? {}),
              budgetId: estimate.budgetId,
              allocatedTokens,
            },
          },
        ]),
      ),
      merge: {
        status: 'pending',
        consumedBranches: [],
      },
      workflowDeadline: computeDeadline(now, this.workflowTimeoutMs),
      leafTimeoutMs: Object.fromEntries(
        template.branches.map((branch) => [
          `${workflow.workflowId}:${branch.memberKey}`,
          branch.leafTimeoutMs ?? this.leafTimeoutMs,
        ]),
      ),
      fallbackExecutionMode: null,
      teamOrchestratorPending: false,
      workflow: cloneWorkflow(workflow),
      ...(budget ? { budget } : {}),
    };
  }

  private hydrateWorkflow(state: WorkflowCheckpointState): ScenarioWorkflow {
    const branchState = asTeamBranchState(state.branchState);
    if (branchState?.workflow) {
      return cloneWorkflow(branchState.workflow);
    }
    return {
      workflowId: state.workflowId,
      executionMode: 'team',
      orchestrationMode: state.routingDecision.orchestrationMode as TeamOrchestrationMode,
      workflowTemplateId: state.routingDecision.workflowTemplateId,
      sceneDescriptor: state.sceneDescriptor,
      budget: state.budget,
      nodes: [
        { id: DISPATCH_NODE_ID, type: 'team' },
        { id: MERGE_NODE_ID, type: 'merge' },
      ],
      leafSessionRefs: state.leafSessionRefs.map((ref) => ({ ...ref })),
      createdAt: state.createdAt,
    };
  }

  private hydrateState(workflow: ScenarioWorkflow, value: unknown): TeamBranchState {
    const existing = asTeamBranchState(value);
    if (!existing) {
      return this.createInitialState(workflow, this.expandBranches(workflow));
    }

    const state = cloneState(existing);
    state.workflow = cloneWorkflow(workflow);
    state.budget =
      this.budgetStore?.readWorkflowBudget(workflow.workflowId) ??
      this.budgetStore?.ensureWorkflowBudget({
        workflowId: workflow.workflowId,
        estimate: workflowBudgetEstimate(workflow, this.budgetEstimate),
      }) ??
      state.budget;
    if (!state.workflowDeadline) {
      state.workflowDeadline = computeDeadline(this.now(), this.workflowTimeoutMs);
    }
    if (!state.merge) {
      state.merge = { status: 'pending', consumedBranches: [] };
    }
    if (Object.keys(state.branches).length === 0) {
      state.branches = Object.fromEntries(
        this.expandBranches(workflow).map((branch) => [branch.branchId, branch]),
      );
    }
    const persistedConsumed = new Set(state.merge.consumedBranches);
    for (const branch of Object.values(state.branches)) {
      if (branch.status === 'merge-consumed' || persistedConsumed.has(branch.branchId)) {
        branch.consumedByMerge = true;
      }
      if (
        persistedConsumed.has(branch.branchId) &&
        (state.merge.status === 'completed' || state.merge.status === 'blocked')
      ) {
        branch.status = 'merge-consumed';
      }
    }
    return state;
  }

  private async executePipeline(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
  ): Promise<void> {
    const template = resolveTemplate(workflow, 'pipeline');
    let upstreamOutputRef: string | undefined;
    for (const branch of Object.values(state.branches)) {
      if (isWorkflowExpired(state, this.now())) {
        state.teamStatus = 'timed-out';
        markOutstandingBranchesCancelled(state, toTimestamp(this.now()));
        break;
      }
      await this.executeBranch(workflow, decision, rawContextRefs, state, branch.branchId, upstreamOutputRef);
      const updated = state.branches[branch.branchId]!;
      if (updated.outputRef) {
        upstreamOutputRef = updated.outputRef;
      }
      if (template.pipeline?.strictFailFast && updated.status !== 'completed') {
        state.teamStatus =
          updated.status === 'timed-out' || isWorkflowDeadlineCancellation(updated) ? 'timed-out' : 'failed';
        markOutstandingBranchesCancelled(state, toTimestamp(this.now()));
        break;
      }
    }
  }

  private async executeDebate(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
  ): Promise<void> {
    const branches = Object.values(state.branches);
    const proposer = branches.find((branch) => branch.branchRole === 'proposer');
    if (proposer) {
      await this.executeBranch(workflow, decision, rawContextRefs, state, proposer.branchId);
    }
    const reviewTargetOutputRef = proposer ? state.branches[proposer.branchId]?.outputRef : undefined;
    await Promise.all(
      branches
        .filter((branch) => branch.branchId !== proposer?.branchId)
        .map(async (branch) => {
          await this.executeBranch(
            workflow,
            decision,
            rawContextRefs,
            state,
            branch.branchId,
            undefined,
            reviewTargetOutputRef,
          );
        }),
    );
  }

  private async executeBranch(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
    branchId: string,
    upstreamOutputRef?: string,
    reviewTargetOutputRef?: string,
  ): Promise<void> {
    const branch = state.branches[branchId];
    if (!branch || !branchShouldRun(branch)) {
      return;
    }
    if (isWorkflowExpired(state, this.now())) {
      branch.status = 'cancelled';
      branch.finishedAt = toTimestamp(this.now());
      branch.lastError = 'workflow deadline reached';
      state.teamStatus = 'timed-out';
      return;
    }
    const budgetEstimate = workflowBudgetEstimate(workflow, this.budgetEstimate);
    const budgetCheck = this.budgetStore?.checkBeforeBudgetedAction({
      workflowId: workflow.workflowId,
      budgetId: budgetEstimate.budgetId,
      branchId,
      agentId: this.defaultAgentId,
      action: branch.attempt > 0 ? 'retry' : 'branch-attempt',
    });
    if (budgetCheck) {
      state.budget = budgetCheck.budget;
      if (budgetCheck.state === 'near-limit') {
        state.teamStatus = 'needs-human-intervention';
        state.teamOrchestratorPending = true;
      }
      if (!budgetCheck.allowed) {
        const now = toTimestamp(this.now());
        branch.status = 'cancelled';
        branch.startedAt = now;
        branch.finishedAt = now;
        branch.lastError = budgetCheck.reason ?? 'token budget exceeded';
        state.teamStatus = 'failed';
        this.writeCheckpoint('leaf-terminal', {
          workflow,
          decision,
          rawContextRefs,
          branchState: state,
        });
        return;
      }
    }

    const configuredLeafTimeoutMs = state.leafTimeoutMs?.[branchId] ?? this.leafTimeoutMs;
    const workflowRemainingMs =
      typeof state.workflowDeadline === 'string'
        ? Math.max(1, Date.parse(state.workflowDeadline) - this.now().getTime())
        : undefined;
    const leafTimeoutMs =
      workflowRemainingMs === undefined ? configuredLeafTimeoutMs : Math.min(configuredLeafTimeoutMs, workflowRemainingMs);
    const updated = await this.dispatchBranch(branch, this.agentRunner, {
      rawContextRefs,
      upstreamOutputRef,
      reviewTargetOutputRef,
      leafTimeoutMs,
      timeoutErrorFactory:
        workflowRemainingMs !== undefined && workflowRemainingMs < configuredLeafTimeoutMs
          ? () => new Error(`workflow deadline reached before branch '${branch.branchId}' finished`)
          : undefined,
    });
    state.branches[branchId] = updated;
    if (updated.usage) {
      this.budgetStore?.recordTokenUsage({
        budgetId: budgetEstimate.budgetId,
        workflowId: workflow.workflowId,
        branchId,
        agentId: this.defaultAgentId,
        provider: updated.usage.provider,
        model: updated.usage.model,
        inputTokens: updated.usage.inputTokens,
        outputTokens: updated.usage.outputTokens,
        estimatedCost: updated.usage.estimatedCost,
      });
      state.budget = this.budgetStore?.readWorkflowBudget(workflow.workflowId) ?? state.budget;
      if (state.budget?.state === 'near-limit') {
        state.teamStatus = 'needs-human-intervention';
        state.teamOrchestratorPending = true;
      }
    }
    state.activeNodeId = updated.nodeId;
    state.workflow = state.workflow
      ? {
          ...state.workflow,
          leafSessionRefs: updated.leafSessionRef
            ? recordLeafSessionRef(state.workflow.leafSessionRefs, updated.leafSessionRef)
            : state.workflow.leafSessionRefs,
        }
      : state.workflow;

    if (updated.status === 'timed-out' || isWorkflowDeadlineCancellation(updated)) {
      state.teamStatus = 'timed-out';
    } else if (updated.status === 'failed') {
      state.teamStatus = workflow.orchestrationMode === 'pipeline' ? 'failed' : state.teamStatus;
    }

    this.writeCheckpoint('leaf-terminal', {
      workflow,
      decision,
      rawContextRefs,
      branchState: state,
    });
  }

  private async finalizeMerge(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
  ): Promise<MergeEnvelope> {
    state.activeNodeId = MERGE_NODE_ID;
    state.teamStatus =
      state.teamStatus === 'timed-out'
        ? 'timed-out'
        : Object.values(state.branches).every((branch) => branch.status === 'cancelled')
          ? 'cancelled'
          : 'merge-ready';
    const envelope =
      state.merge?.status === 'ready' && state.merge.envelope
        ? cloneEnvelope(state.merge.envelope)
        : await this.prepareMerge(workflow, decision, rawContextRefs, state);
    return this.commitPreparedMerge(workflow, decision, rawContextRefs, state, envelope);
  }

  private buildBranchTask(
    branch: BranchLedgerEntry,
    rawContextRefs: RawContextRef[],
    upstreamOutputRef?: string,
    reviewTargetOutputRef?: string,
  ): string {
    const lines = [
      `workflowId: ${branch.workflowId}`,
      `branchId: ${branch.branchId}`,
      `memberKey: ${branch.memberKey}`,
      `instructions: ${branch.instructions}`,
      `mode: ${branch.mode}`,
      `attempt: ${branch.attempt}`,
      `branchRole: ${branch.branchRole ?? 'candidate'}`,
      'rawContextRefs:',
      ...rawContextRefs.map((ref) => `- ${ref.kind}:${ref.ref}`),
    ];
    if (upstreamOutputRef) {
      lines.push(`upstreamOutputRef: ${upstreamOutputRef}`);
    }
    if (reviewTargetOutputRef) {
      lines.push(`reviewTargetOutputRef: ${reviewTargetOutputRef}`);
    }
    return lines.join('\n');
  }

  private async prepareMerge(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
  ): Promise<MergeEnvelope> {
    state.merge = state.merge ?? { status: 'pending', consumedBranches: [] };
    state.merge.status = 'ready';
    const budgetCheck = this.budgetStore?.checkBeforeBudgetedAction({
      workflowId: workflow.workflowId,
      budgetId: workflowBudgetEstimate(workflow, this.budgetEstimate).budgetId,
      agentId: this.defaultAgentId,
      action: 'merge',
    });
    if (budgetCheck) {
      state.budget = budgetCheck.budget;
      if (budgetCheck.state === 'near-limit') {
        state.teamStatus = 'needs-human-intervention';
        state.teamOrchestratorPending = true;
      }
      if (!budgetCheck.allowed) {
        const mode = workflow.orchestrationMode as TeamOrchestrationMode;
        state.teamStatus = 'failed';
        const envelope = buildBudgetBlockedEnvelope(
          workflow,
          mode,
          Object.values(state.branches),
          `checkpoint://${workflow.workflowId}/${MERGE_NODE_ID}/${this.createId()}`,
          budgetCheck.reason ?? 'token budget exceeded before merge',
        );
        state.merge.envelopeRef = envelope.checkpointRef;
        state.merge.envelope = cloneEnvelope(envelope);
        this.writeCheckpoint('merge', {
          workflow,
          decision,
          rawContextRefs,
          branchState: state,
        });
        return envelope;
      }
    }
    const envelope = await this.runMerge(Object.values(state.branches), {
      alreadyConsumedBranchIds: state.merge.consumedBranches,
    });
    state.merge.envelopeRef = envelope.checkpointRef;
    state.merge.envelope = cloneEnvelope(envelope);
    state.merge.consumedBranches = [...new Set([...state.merge.consumedBranches, ...envelope.consumedBranches])];
    this.writeCheckpoint('merge', {
      workflow,
      decision,
      rawContextRefs,
      branchState: state,
    });
    return envelope;
  }

  private commitPreparedMerge(
    workflow: ScenarioWorkflow,
    decision: RoutingDecision,
    rawContextRefs: RawContextRef[],
    state: TeamBranchState,
    envelope: MergeEnvelope,
  ): MergeEnvelope {
    state.merge = state.merge ?? { status: 'pending', consumedBranches: [] };
    const consumedBranches = new Set(state.merge.consumedBranches);
    for (const branchId of consumedBranches) {
      const branch = state.branches[branchId];
      if (!branch) continue;
      branch.consumedByMerge = true;
      branch.status = 'merge-consumed';
      branch.finishedAt = branch.finishedAt ?? toTimestamp(this.now());
    }
    state.merge.status = envelope.status === 'blocked' ? 'blocked' : 'completed';
    state.merge.envelopeRef = envelope.checkpointRef;
    state.merge.envelope = cloneEnvelope(envelope);
    state.teamStatus = envelope.status === 'blocked' ? state.teamStatus : 'merged';

    this.writeCheckpoint('merge', {
      workflow,
      decision,
      rawContextRefs,
      branchState: state,
    });
    return envelope;
  }

  private async defaultMergeSynthesis(input: MergeSynthesisInput): Promise<MergeEnvelopeBody> {
    switch (input.mode) {
      case 'parallel':
        return this.buildParallelMergeBody(input.branches);
      case 'debate':
        return this.buildDebateMergeBody(input.branches);
      case 'pipeline':
        return this.buildPipelineMergeBody(input.branches);
      case 'hub-spoke':
        return this.buildHubSpokeMergeBody(input.branches);
      default:
        throw new Error(`Unsupported merge mode '${input.mode satisfies never}'.`);
    }
  }

  private buildParallelMergeBody(branches: BranchLedgerEntry[]): ParallelMergeBody {
    const candidates = branches
      .filter((branch) => branch.status === 'completed' || branch.status === 'merge-consumed')
      .map((branch) => ({
        branchId: branch.branchId,
        outputRef: branch.outputRef ?? buildOutputRef(branch),
        ...(extractConfidence(branch) !== undefined ? { confidence: extractConfidence(branch) } : {}),
        evidenceRefs: toEvidenceRefs(branch),
      }));

    const findings: ParallelMergeBody['findings'] = candidates.map((candidate, index) => ({
      id: `finding-${index + 1}`,
      summary: `branch '${candidate.branchId}' contributed parallel coverage`,
      type: 'observation' as const,
      sourceBranchIds: [candidate.branchId],
      evidenceRefs: [...candidate.evidenceRefs],
    }));

    const missingBranches = branches.filter((branch) => !candidateIds(candidates).has(branch.branchId));
    if (missingBranches.length > 0) {
      findings.push({
        id: `finding-gap-${findings.length + 1}`,
        summary: 'some parallel branches did not produce a completed candidate',
        type: 'gap',
        sourceBranchIds: missingBranches.map((branch) => branch.branchId),
        evidenceRefs: missingBranches.flatMap((branch) => toEvidenceRefs(branch)),
      });
    }

    return {
      kind: 'parallel',
      candidates,
      findings,
      decision: {
        mode: candidates.length > 0 ? 'union' : 'blocked',
        selectedBranchIds: candidates.map((candidate) => candidate.branchId),
        rationale:
          candidates.length > 0
            ? 'union all completed parallel candidates into a structured merge result'
            : 'blocked because no completed parallel candidate is available',
        evidenceRefs: candidates.flatMap((candidate) => candidate.evidenceRefs),
      },
    };
  }

  private buildDebateMergeBody(branches: BranchLedgerEntry[]): DebateMergeBody {
    const proposers = branches.filter((branch) => branch.branchRole === 'proposer');
    const critics = branches.filter((branch) => branch.branchRole === 'critic');
    const candidates = proposers
      .filter((branch) => branch.outputRef)
      .map((branch) => ({
        branchId: branch.branchId,
        role: 'proposer' as const,
        outputRef: branch.outputRef!,
        evidenceRefs: toEvidenceRefs(branch),
      }));

    const findings = critics.flatMap((branch) => {
      const critic = parseCriticPayload(branch);
      return [
        ...critic.issues,
        ...(critic.risks ?? []),
        ...(critic.counterExamples ?? []),
        ...(critic.uncoveredEdges ?? []),
      ].map((item) => ({
        branchId: branch.branchId,
        role: 'critic' as const,
        summary: item.summary,
        severity: inferDebateSeverity(item.summary),
        evidenceRefs: [...item.evidenceRefs],
      }));
    });

    const highSeverity = findings.some((finding) => finding.severity === 'high');
    return {
      kind: 'debate',
      candidates,
      findings,
      decision: {
        outcome:
          candidates.length === 0
            ? 'blocked'
            : highSeverity
              ? 'blocked'
              : findings.length > 0
                ? 'accepted-with-risk'
                : 'accepted',
        rationale:
          candidates.length === 0
            ? 'blocked because proposer did not produce a candidate'
            : highSeverity
              ? 'blocked because critic reported high-severity findings'
              : findings.length > 0
                ? 'accepted with risk after integrating critic findings'
                : 'accepted because no critic findings were reported',
        evidenceRefs: [...new Set([...candidates.flatMap((candidate) => candidate.evidenceRefs), ...findings.flatMap((finding) => finding.evidenceRefs)])],
      },
    };
  }

  private buildPipelineMergeBody(branches: BranchLedgerEntry[]): PipelineMergeBody {
    const candidates = branches
      .filter((branch) => branch.outputRef)
      .map((branch) => ({
        stepId: branch.memberKey,
        outputRef: branch.outputRef!,
        evidenceRefs: toEvidenceRefs(branch),
      }));
    const findings = branches.map((branch) => ({
      stepId: branch.memberKey,
      summary:
        branch.status === 'completed' || branch.status === 'merge-consumed'
          ? `step '${branch.memberKey}' completed`
          : `step '${branch.memberKey}' ended with status '${branch.status}'`,
      type:
        branch.status === 'completed' || branch.status === 'merge-consumed'
          ? ('step-output' as const)
          : branch.status === 'failed' || branch.status === 'timed-out'
            ? ('failure' as const)
            : ('warning' as const),
      evidenceRefs: toEvidenceRefs(branch),
    }));
    const allCompleted = branches.every(
      (branch) => branch.status === 'completed' || branch.status === 'merge-consumed',
    );
    const noneCompleted = branches.every((branch) => !branch.outputRef);
    return {
      kind: 'pipeline',
      candidates,
      findings,
      decision: {
        outcome: allCompleted ? 'completed' : noneCompleted ? 'blocked' : 'partial',
        rationale: allCompleted
          ? 'all deterministic pipeline steps completed in order'
          : noneCompleted
            ? 'blocked because no pipeline step completed successfully'
            : 'partial because at least one deterministic step completed before failure or cancellation',
        evidenceRefs: [...new Set(candidates.flatMap((candidate) => candidate.evidenceRefs))],
      },
    };
  }

  private buildHubSpokeMergeBody(branches: BranchLedgerEntry[]): HubSpokeMergeBody {
    const candidates = branches
      .filter((branch) => branch.outputRef)
      .map((branch) => ({
        branchId: branch.branchId,
        outputRef: branch.outputRef!,
        role: 'slice' as const,
        evidenceRefs: toEvidenceRefs(branch),
      }));

    const findings: HubSpokeMergeBody['findings'] = candidates.map((candidate) => ({
      summary: `slice '${candidate.branchId}' contributed complementary coverage`,
      type: 'synthesis',
      sourceBranchIds: [candidate.branchId],
      evidenceRefs: [...candidate.evidenceRefs],
    }));
    const gaps = branches.filter((branch) => !branch.outputRef);
    if (gaps.length > 0) {
      findings.push({
        summary: 'hub-spoke merge detected coverage gaps across complementary slices',
        type: 'gap',
        sourceBranchIds: gaps.map((branch) => branch.branchId),
        evidenceRefs: gaps.flatMap((branch) => toEvidenceRefs(branch)),
      });
    }

    return {
      kind: 'hub-spoke',
      candidates,
      findings,
      decision: {
        outcome: gaps.length === 0 && candidates.length > 0 ? 'synthesized' : 'blocked',
        rationale:
          gaps.length === 0 && candidates.length > 0
            ? 'all complementary slices were synthesized into a single structured result'
            : 'blocked because one or more complementary slices are missing',
        evidenceRefs: [...new Set(candidates.flatMap((candidate) => candidate.evidenceRefs))],
      },
    };
  }
}

function candidateIds<T extends { branchId: string }>(candidates: T[]): Set<string> {
  return new Set(candidates.map((candidate) => candidate.branchId));
}
