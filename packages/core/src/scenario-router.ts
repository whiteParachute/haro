import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { initHaroDatabase } from './db/init.js';
import { createWorkflowBudgetEstimate, type WorkflowBudgetEstimate } from './permission-budget.js';

export type TaskType =
  | 'quick'
  | 'code'
  | 'analysis'
  | 'research'
  | 'design'
  | 'review'
  | 'deterministic-toolchain';

export type Complexity = 'simple' | 'moderate' | 'complex';
export type CollaborationNeed = 'single-agent' | 'team';
export type TimeSensitivity = 'realtime' | 'batch';
export type ValidationNeed = 'none' | 'standard' | 'adversarial';
export type ExecutionMode = 'single-agent' | 'team';
export type OrchestrationMode = 'parallel' | 'debate' | 'pipeline' | 'hub-spoke' | 'evolution-loop';
export type WorkflowNodeType = 'router' | 'agent' | 'team' | 'validator' | 'merge' | 'tool';
export type ResumeStrategy = 'continuation-ref' | 'provider-response-id' | 'node-restart';

export interface SceneDescriptor {
  taskType: TaskType;
  complexity: Complexity;
  collaborationNeed: CollaborationNeed;
  timeSensitivity: TimeSensitivity;
  validationNeed?: ValidationNeed;
  tags?: string[];
}

export interface RoutingDecision {
  executionMode: ExecutionMode;
  orchestrationMode?: OrchestrationMode;
  workflowTemplateId: string;
  providerSelectionHints?: {
    preferredTags?: string[];
    estimatedComplexity?: Complexity;
    requiresLargeContext?: boolean;
  };
  matchedRuleId?: string;
}

export interface RawContextRef {
  kind: 'input' | 'artifact' | 'session-event';
  ref: string;
}

export interface LeafSessionRef {
  nodeId: string;
  sessionId: string;
  continuationRef?: string;
  providerResponseId?: string;
}

export interface WorkflowCheckpointState {
  workflowId: string;
  nodeId: string;
  nodeType: WorkflowNodeType;
  sceneDescriptor: SceneDescriptor;
  routingDecision: RoutingDecision;
  budget?: WorkflowBudgetEstimate;
  rawContextRefs: RawContextRef[];
  branchState: Record<string, unknown>;
  leafSessionRefs: LeafSessionRef[];
  createdAt: string;
}

export interface WorkflowCheckpoint {
  id: string;
  workflowId: string;
  nodeId: string;
  state: WorkflowCheckpointState;
  createdAt: string;
}

export interface WorkflowCheckpointInput {
  id?: string;
  workflowId?: string;
  nodeId?: string;
  createdAt?: string;
  state: WorkflowCheckpointState;
}

export interface ResumeTarget {
  workflowId: string;
  checkpointId: string;
  nodeId: string;
  strategy: ResumeStrategy;
  sessionId?: string;
  continuationRef?: string;
  providerResponseId?: string;
  checkpoint: WorkflowCheckpoint;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
}

export interface ScenarioWorkflow {
  workflowId: string;
  channelSessionId?: string;
  executionMode: ExecutionMode;
  orchestrationMode?: OrchestrationMode;
  workflowTemplateId: string;
  sceneDescriptor?: SceneDescriptor;
  budget?: WorkflowBudgetEstimate;
  nodes: WorkflowNode[];
  leafSessionRefs: LeafSessionRef[];
  createdAt: string;
}

export interface ScenarioPlan {
  scene: SceneDescriptor;
  decision: RoutingDecision;
  workflow: ScenarioWorkflow;
}

export interface SceneClassifierOptions {
  defaultTimeSensitivity?: TimeSensitivity;
}

const QUICK_KEYWORDS = [
  'quick',
  'fast',
  'brief',
  'summary',
  'summarize',
  'list',
  'lookup',
  '简单',
  '快速',
  '尽快',
  '简要',
  '总结',
  '列出',
  '查一下',
];

const CODE_KEYWORDS = [
  'code',
  'implement',
  'fix',
  'refactor',
  'function',
  'bug',
  'typescript',
  'javascript',
  'coding',
  '写代码',
  '实现',
  '修复',
  '重构',
  '函数',
  '代码',
  '脚本',
];

const ANALYSIS_KEYWORDS = [
  'analysis',
  'analyze',
  'investigate',
  'root cause',
  'diagnose',
  'why',
  '分析',
  '排查',
  '定位',
  '根因',
  '诊断',
  '原因',
];

const RESEARCH_KEYWORDS = [
  'research',
  'survey',
  'compare',
  'benchmark',
  'literature',
  'docs',
  '调研',
  '对比',
  '比较',
  '资料',
  '文档',
  '基准',
];

const DESIGN_KEYWORDS = [
  'design',
  'architecture',
  'plan',
  'proposal',
  'spec',
  'ui',
  'ux',
  '设计',
  '架构',
  '方案',
  '规划',
  '原型',
  '交互',
];

const REVIEW_KEYWORDS = [
  'review',
  'audit',
  'critique',
  'validate',
  'validation',
  '评审',
  '审查',
  '检查',
  '复核',
  '验证',
];

const DETERMINISTIC_TOOLCHAIN_KEYWORDS = [
  'build',
  'lint',
  'format',
  'compile',
  'package',
  'release',
  'smoke test',
  'ci',
  'toolchain',
  '构建',
  '编译',
  '打包',
  '格式化',
  '流水线',
  '批处理',
  '工具链',
];

const COMPLEX_KEYWORDS = [
  'complex',
  'deep',
  'end-to-end',
  'cross-file',
  'tradeoff',
  'multi-step',
  'multiple',
  '复杂',
  '深入',
  '端到端',
  '跨文件',
  '多步骤',
  '多维',
  '权衡',
  '多个',
];

const MODERATE_KEYWORDS = [
  'moderate',
  'compare',
  'several',
  'review',
  'analysis',
  'research',
  '设计',
  '分析',
  '调研',
  '对比',
  '若干',
  '多个',
];

const TEAM_KEYWORDS = [
  'team',
  'parallel',
  'debate',
  'hub-spoke',
  'multi-agent',
  'collaborate',
  '多人',
  '协作',
  '并行',
  '辩论',
  '分工',
  '多 agent',
];

const BATCH_KEYWORDS = ['batch', 'offline', 'nightly', 'async', '批量', '离线', '定时', '后台'];
const REALTIME_KEYWORDS = ['realtime', 'real-time', 'urgent', 'asap', 'now', '实时', '立即', '马上', '尽快'];

const PIPELINE_FORBIDDEN_TASK_TYPES = new Set<TaskType>(['analysis', 'research', 'design', 'review']);
const COMPLEX_TASK_TYPES = new Set<TaskType>(['analysis', 'research', 'design', 'review']);

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags)];
}

export class SceneClassifier {
  private readonly defaultTimeSensitivity: TimeSensitivity;

  constructor(options: SceneClassifierOptions = {}) {
    this.defaultTimeSensitivity = options.defaultTimeSensitivity ?? 'realtime';
  }

  classify(task: string): SceneDescriptor {
    const normalized = task.trim().toLowerCase();
    const taskType = this.detectTaskType(normalized);
    const complexity = this.detectComplexity(normalized, taskType);
    const collaborationNeed = this.detectCollaborationNeed(normalized, taskType, complexity);
    const timeSensitivity = this.detectTimeSensitivity(normalized, taskType);
    const validationNeed = this.detectValidationNeed(normalized, taskType, complexity);
    const tags = this.collectTags(normalized, taskType, complexity, collaborationNeed, validationNeed);

    return {
      taskType,
      complexity,
      collaborationNeed,
      timeSensitivity,
      validationNeed,
      tags,
    };
  }

  private detectTaskType(task: string): TaskType {
    if (includesAny(task, ANALYSIS_KEYWORDS)) return 'analysis';
    if (includesAny(task, RESEARCH_KEYWORDS)) return 'research';
    if (includesAny(task, DESIGN_KEYWORDS)) return 'design';
    if (includesAny(task, REVIEW_KEYWORDS)) return 'review';
    if (includesAny(task, DETERMINISTIC_TOOLCHAIN_KEYWORDS)) return 'deterministic-toolchain';
    if (includesAny(task, CODE_KEYWORDS)) return 'code';
    if (includesAny(task, QUICK_KEYWORDS) || task.length <= 48) return 'quick';
    return 'code';
  }

  private detectComplexity(task: string, taskType: TaskType): Complexity {
    if (
      includesAny(task, COMPLEX_KEYWORDS) ||
      task.length >= 200 ||
      (COMPLEX_TASK_TYPES.has(taskType) && task.length >= 80)
    ) {
      return 'complex';
    }

    if (
      includesAny(task, MODERATE_KEYWORDS) ||
      task.length >= 100 ||
      (taskType === 'code' && task.length >= 60)
    ) {
      return 'moderate';
    }

    return 'simple';
  }

  private detectCollaborationNeed(
    task: string,
    taskType: TaskType,
    complexity: Complexity,
  ): CollaborationNeed {
    if (includesAny(task, TEAM_KEYWORDS)) return 'team';
    if (taskType === 'deterministic-toolchain' && includesAny(task, BATCH_KEYWORDS)) return 'team';
    if (COMPLEX_TASK_TYPES.has(taskType) && complexity !== 'simple') return 'team';
    return 'single-agent';
  }

  private detectTimeSensitivity(task: string, taskType: TaskType): TimeSensitivity {
    if (taskType === 'deterministic-toolchain' || includesAny(task, BATCH_KEYWORDS)) return 'batch';
    if (includesAny(task, REALTIME_KEYWORDS) || includesAny(task, QUICK_KEYWORDS)) return 'realtime';
    return this.defaultTimeSensitivity;
  }

  private detectValidationNeed(
    task: string,
    taskType: TaskType,
    complexity: Complexity,
  ): ValidationNeed {
    if (taskType === 'design' || taskType === 'review') return 'adversarial';
    if (includesAny(task, ['validator', 'critic', 'audit', '批判', '审计', '验证'])) return 'adversarial';
    if (taskType === 'analysis' || taskType === 'research') return 'standard';
    if (complexity === 'complex') return 'standard';
    return 'none';
  }

  private collectTags(
    task: string,
    taskType: TaskType,
    complexity: Complexity,
    collaborationNeed: CollaborationNeed,
    validationNeed: ValidationNeed,
  ): string[] {
    const tags: string[] = [taskType, complexity, collaborationNeed, validationNeed];
    if (includesAny(task, QUICK_KEYWORDS)) tags.push('fast-path');
    if (includesAny(task, BATCH_KEYWORDS)) tags.push('batch');
    if (includesAny(task, REALTIME_KEYWORDS)) tags.push('realtime');
    return uniqueTags(tags);
  }
}

interface RoutingRule {
  id: string;
  matches(scene: SceneDescriptor): boolean;
  decide(scene: SceneDescriptor): RoutingDecision;
}

const ROUTING_RULES: readonly RoutingRule[] = [
  {
    id: 'quick-simple-single',
    matches: (scene) =>
      scene.taskType === 'quick' &&
      scene.complexity === 'simple' &&
      scene.collaborationNeed === 'single-agent',
    decide: (scene) => ({
      executionMode: 'single-agent',
      workflowTemplateId: 'single-fast',
      matchedRuleId: 'quick-simple-single',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: false,
      },
    }),
  },
  {
    id: 'code-default-single',
    matches: (scene) =>
      scene.taskType === 'code' &&
      scene.collaborationNeed === 'single-agent' &&
      (scene.complexity === 'simple' || scene.complexity === 'moderate'),
    decide: (scene) => ({
      executionMode: 'single-agent',
      workflowTemplateId: 'single-code-default',
      matchedRuleId: 'code-default-single',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: scene.complexity === 'moderate',
      },
    }),
  },
  {
    id: 'analysis-team-hub-spoke',
    matches: (scene) =>
      scene.taskType === 'analysis' &&
      scene.collaborationNeed === 'team' &&
      (scene.complexity === 'moderate' || scene.complexity === 'complex'),
    decide: (scene) => ({
      executionMode: 'team',
      orchestrationMode: 'hub-spoke',
      workflowTemplateId: 'hub-spoke-analysis',
      matchedRuleId: 'analysis-team-hub-spoke',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: true,
      },
    }),
  },
  {
    id: 'research-team-parallel',
    matches: (scene) =>
      scene.taskType === 'research' &&
      scene.collaborationNeed === 'team' &&
      (scene.complexity === 'moderate' || scene.complexity === 'complex'),
    decide: (scene) => ({
      executionMode: 'team',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      matchedRuleId: 'research-team-parallel',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: true,
      },
    }),
  },
  {
    id: 'design-team-debate',
    matches: (scene) =>
      scene.taskType === 'design' &&
      scene.collaborationNeed === 'team' &&
      (scene.complexity === 'moderate' || scene.complexity === 'complex'),
    decide: (scene) => ({
      executionMode: 'team',
      orchestrationMode: 'debate',
      workflowTemplateId: 'debate-design-review',
      matchedRuleId: 'design-team-debate',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: true,
      },
    }),
  },
  {
    id: 'review-team-debate',
    matches: (scene) =>
      scene.taskType === 'review' &&
      scene.collaborationNeed === 'team' &&
      (scene.complexity === 'moderate' || scene.complexity === 'complex'),
    decide: (scene) => ({
      executionMode: 'team',
      orchestrationMode: 'debate',
      workflowTemplateId: 'debate-review',
      matchedRuleId: 'review-team-debate',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: true,
      },
    }),
  },
  {
    id: 'deterministic-toolchain-team-pipeline',
    matches: (scene) =>
      scene.taskType === 'deterministic-toolchain' &&
      scene.timeSensitivity === 'batch' &&
      scene.collaborationNeed === 'team',
    decide: (scene) => ({
      executionMode: 'team',
      orchestrationMode: 'pipeline',
      workflowTemplateId: 'pipeline-deterministic-tools',
      matchedRuleId: 'deterministic-toolchain-team-pipeline',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: false,
      },
    }),
  },
  {
    id: 'fallback-single-default',
    matches: () => true,
    decide: (scene) => ({
      executionMode: 'single-agent',
      workflowTemplateId: 'single-default-fallback',
      matchedRuleId: 'fallback-single-default',
      providerSelectionHints: {
        preferredTags: scene.tags,
        estimatedComplexity: scene.complexity,
        requiresLargeContext: scene.complexity === 'complex',
      },
    }),
  },
];

export class RoutingMatrix {
  private readonly rules: readonly RoutingRule[];

  constructor(rules: readonly RoutingRule[] = ROUTING_RULES) {
    this.rules = rules;
  }

  route(scene: SceneDescriptor): RoutingDecision {
    const decision = this.rules.find((rule) => rule.matches(scene))?.decide(scene);
    if (!decision) {
      throw new Error('No routing rule matched and no fallback was configured.');
    }
    if (decision.orchestrationMode === 'evolution-loop') {
      throw new Error('Phase 1 Scenario Router must not emit evolution-loop workflows.');
    }
    if (
      PIPELINE_FORBIDDEN_TASK_TYPES.has(scene.taskType) &&
      decision.orchestrationMode === 'pipeline'
    ) {
      throw new Error(`Task type '${scene.taskType}' must not route to pipeline.`);
    }
    return decision;
  }
}

export interface ScenarioRouterOptions {
  classifier?: SceneClassifier;
  routingMatrix?: RoutingMatrix;
  createId?: () => string;
  now?: () => Date;
}

export interface CreateWorkflowOptions {
  sceneDescriptor?: SceneDescriptor;
  channelSessionId?: string;
  workflowId?: string;
  leafSessionId?: string;
}

export class ScenarioRouter {
  private readonly classifier: SceneClassifier;
  private readonly routingMatrix: RoutingMatrix;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: ScenarioRouterOptions = {}) {
    this.classifier = options.classifier ?? new SceneClassifier();
    this.routingMatrix = options.routingMatrix ?? new RoutingMatrix();
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  classify(task: string): SceneDescriptor {
    return this.classifier.classify(task);
  }

  route(scene: SceneDescriptor): RoutingDecision {
    return this.routingMatrix.route(scene);
  }

  createWorkflow(decision: RoutingDecision, options: CreateWorkflowOptions = {}): ScenarioWorkflow {
    const disallowedIds = new Set<string>();
    if (options.channelSessionId) disallowedIds.add(options.channelSessionId);

    const workflowId = options.workflowId ?? this.createUniqueId(disallowedIds);
    disallowedIds.add(workflowId);
    const createdAt = this.timestamp();
    const nodes = this.createNodes(decision);
    const budget = createWorkflowBudgetEstimate({
      workflowId,
      decision,
      sceneDescriptor: options.sceneDescriptor,
    });
    const leafSessionRefs =
      decision.executionMode === 'single-agent'
        ? [
            {
              nodeId: 'leaf-1',
              sessionId: options.leafSessionId ?? this.createUniqueId(disallowedIds),
            },
          ]
        : [];

    return {
      workflowId,
      channelSessionId: options.channelSessionId,
      executionMode: decision.executionMode,
      orchestrationMode: decision.orchestrationMode,
      workflowTemplateId: decision.workflowTemplateId,
      sceneDescriptor: options.sceneDescriptor,
      budget,
      nodes,
      leafSessionRefs,
      createdAt,
    };
  }

  plan(task: string, options: Omit<CreateWorkflowOptions, 'sceneDescriptor'> = {}): ScenarioPlan {
    const scene = this.classify(task);
    const decision = this.route(scene);
    const workflow = this.createWorkflow(decision, {
      ...options,
      sceneDescriptor: scene,
    });
    return {
      scene,
      decision,
      workflow,
    };
  }

  private createNodes(decision: RoutingDecision): WorkflowNode[] {
    if (decision.executionMode === 'single-agent') {
      return [{ id: 'leaf-1', type: 'agent' }];
    }

    return [
      { id: 'dispatch-1', type: 'team' },
      { id: 'merge-1', type: 'merge' },
    ];
  }

  private createUniqueId(disallowedIds: Set<string>): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = this.createId();
      if (!disallowedIds.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('Failed to allocate a unique workflow/session identifier.');
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export interface CheckpointStoreOptions {
  db?: Database.Database;
  dbFile?: string;
  root?: string;
  createId?: () => string;
  now?: () => Date;
}

export class CheckpointStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: CheckpointStoreOptions = {}) {
    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      const opened = initHaroDatabase({
        dbFile: options.dbFile,
        root: options.root,
        keepOpen: true,
      });
      this.db = opened.database!;
      this.ownsDb = true;
    }
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  save(checkpoint: WorkflowCheckpointInput): WorkflowCheckpoint {
    const id = checkpoint.id ?? this.createId();
    const workflowId = checkpoint.workflowId ?? checkpoint.state.workflowId;
    const nodeId = checkpoint.nodeId ?? checkpoint.state.nodeId;
    const createdAt = checkpoint.createdAt ?? checkpoint.state.createdAt ?? this.timestamp();
    const state = this.normalizeState({
      ...checkpoint.state,
      workflowId,
      nodeId,
      createdAt,
    });

    this.db
      .prepare(
        `INSERT INTO workflow_checkpoints (id, workflow_id, node_id, state, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, workflowId, nodeId, JSON.stringify(state), createdAt);

    return {
      id,
      workflowId,
      nodeId,
      state,
      createdAt,
    };
  }

  loadLatest(workflowId: string): WorkflowCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT id, workflow_id, node_id, state, created_at
           FROM workflow_checkpoints
          WHERE workflow_id = ?
       ORDER BY created_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(workflowId) as
      | { id: string; workflow_id: string; node_id: string; state: string; created_at: string }
      | undefined;

    return row ? this.hydrateCheckpoint(row) : null;
  }

  loadAll(workflowId: string): WorkflowCheckpoint[] {
    const rows = this.db
      .prepare(
        `SELECT id, workflow_id, node_id, state, created_at
           FROM workflow_checkpoints
          WHERE workflow_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      )
      .all(workflowId) as Array<{
      id: string;
      workflow_id: string;
      node_id: string;
      state: string;
      created_at: string;
    }>;

    return rows.map((row) => this.hydrateCheckpoint(row));
  }

  resolveResume(workflowId: string): ResumeTarget | null {
    const checkpoint = this.loadLatest(workflowId);
    if (!checkpoint) {
      return null;
    }

    const candidateRefs = checkpoint.state.leafSessionRefs.filter((ref) => ref.nodeId === checkpoint.nodeId);
    const refs = candidateRefs.length > 0 ? candidateRefs : checkpoint.state.leafSessionRefs;
    const continuationLeaf = refs.find((ref) => typeof ref.continuationRef === 'string');
    if (continuationLeaf?.continuationRef) {
      return {
        workflowId,
        checkpointId: checkpoint.id,
        nodeId: checkpoint.nodeId,
        strategy: 'continuation-ref',
        sessionId: continuationLeaf.sessionId,
        continuationRef: continuationLeaf.continuationRef,
        checkpoint,
      };
    }

    const responseLeaf = refs.find((ref) => typeof ref.providerResponseId === 'string');
    if (responseLeaf?.providerResponseId) {
      return {
        workflowId,
        checkpointId: checkpoint.id,
        nodeId: checkpoint.nodeId,
        strategy: 'provider-response-id',
        sessionId: responseLeaf.sessionId,
        providerResponseId: responseLeaf.providerResponseId,
        checkpoint,
      };
    }

    return {
      workflowId,
      checkpointId: checkpoint.id,
      nodeId: checkpoint.nodeId,
      strategy: 'node-restart',
      sessionId: refs[0]?.sessionId,
      checkpoint,
    };
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  private hydrateCheckpoint(row: {
    id: string;
    workflow_id: string;
    node_id: string;
    state: string;
    created_at: string;
  }): WorkflowCheckpoint {
    const state = this.normalizeState(JSON.parse(row.state) as WorkflowCheckpointState);
    return {
      id: row.id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      state: {
        ...state,
        workflowId: row.workflow_id,
        nodeId: row.node_id,
        createdAt: row.created_at,
      },
      createdAt: row.created_at,
    };
  }

  private normalizeState(state: WorkflowCheckpointState): WorkflowCheckpointState {
    return {
      workflowId: state.workflowId,
      nodeId: state.nodeId,
      nodeType: state.nodeType,
      sceneDescriptor: {
        ...state.sceneDescriptor,
        tags: state.sceneDescriptor.tags ? [...state.sceneDescriptor.tags] : undefined,
      },
      routingDecision: {
        ...state.routingDecision,
        providerSelectionHints: state.routingDecision.providerSelectionHints
          ? {
              ...state.routingDecision.providerSelectionHints,
              preferredTags: state.routingDecision.providerSelectionHints.preferredTags
                ? [...state.routingDecision.providerSelectionHints.preferredTags]
                : undefined,
            }
          : undefined,
      },
      budget: state.budget ? { ...state.budget } : undefined,
      rawContextRefs: state.rawContextRefs.map((ref) => ({
        kind: ref.kind,
        ref: ref.ref,
      })),
      branchState: { ...state.branchState },
      leafSessionRefs: state.leafSessionRefs.map((ref) => ({
        nodeId: ref.nodeId,
        sessionId: ref.sessionId,
        continuationRef: ref.continuationRef,
        providerResponseId: ref.providerResponseId,
      })),
      createdAt: state.createdAt,
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
