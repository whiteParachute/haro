import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRANCH_STATUS_VALUES,
  CheckpointStore,
  TeamOrchestrator,
  assertValidCriticOutput,
  type BranchLedgerEntry,
  type RunAgentInput,
  type RunAgentResult,
  type ScenarioWorkflow,
  type TeamBranchState,
  type TeamOrchestratorAgentRunner,
} from '../src/index.js';

interface RunnerReply {
  content?: string;
  responseId?: string;
  sessionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

class FakeAgentRunner implements TeamOrchestratorAgentRunner {
  readonly calls: RunAgentInput[] = [];

  constructor(private readonly replies: Record<string, RunnerReply[] | RunnerReply> = {}) {}

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    this.calls.push(input);
    const memberKey = /memberKey: (.+)/.exec(input.task)?.[1] ?? 'unknown';
    const reply = this.nextReply(memberKey);
    const sessionId = reply.sessionId ?? `session-${memberKey}-${this.countCallsFor(memberKey)}`;

    if (reply.errorCode) {
      return {
        sessionId,
        ruleId: 'team-test',
        provider: 'fake-provider',
        model: 'fake-model',
        events: [],
        finalEvent: {
          type: 'error',
          code: reply.errorCode,
          message: reply.errorMessage ?? reply.errorCode,
          retryable: true,
        },
      };
    }

    return {
      sessionId,
      ruleId: 'team-test',
      provider: 'fake-provider',
      model: 'fake-model',
      events: [],
      finalEvent: {
        type: 'result',
        content: reply.content ?? `ok:${memberKey}`,
        ...(reply.responseId ? { responseId: reply.responseId } : {}),
      },
    };
  }

  private countCallsFor(memberKey: string): number {
    return this.calls.filter((call) => call.task.includes(`memberKey: ${memberKey}`)).length;
  }

  private nextReply(memberKey: string): RunnerReply {
    const raw = this.replies[memberKey] ?? this.replies['*'] ?? {};
    if (Array.isArray(raw)) {
      return raw.shift() ?? {};
    }
    return raw;
  }
}

function createTeamWorkflow(input: {
  workflowId: string;
  orchestrationMode: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke';
  workflowTemplateId: string;
  taskType?:
    | 'analysis'
    | 'research'
    | 'design'
    | 'review'
    | 'deterministic-toolchain';
}): ScenarioWorkflow {
  return {
    workflowId: input.workflowId,
    executionMode: 'team',
    orchestrationMode: input.orchestrationMode,
    workflowTemplateId: input.workflowTemplateId,
    sceneDescriptor: {
      taskType: input.taskType ?? 'research',
      complexity: 'complex',
      collaborationNeed: 'team',
      timeSensitivity: input.taskType === 'deterministic-toolchain' ? 'batch' : 'realtime',
      validationNeed:
        input.orchestrationMode === 'debate' ? 'adversarial' : input.taskType === 'research' ? 'standard' : 'none',
      tags: [input.workflowTemplateId],
    },
    nodes: [
      { id: 'dispatch-1', type: 'team' },
      { id: 'merge-1', type: 'merge' },
    ],
    leafSessionRefs: [],
    createdAt: '2026-04-22T11:00:00.000Z',
  };
}

function createRawContextRefs(): Array<{ kind: 'input'; ref: string }> {
  return [{ kind: 'input', ref: 'channel://cli/sessions/1' }];
}

function createTeamState(workflow: ScenarioWorkflow, branches: BranchLedgerEntry[]): TeamBranchState {
  return {
    teamStatus: 'running',
    activeNodeId: 'dispatch-1',
    branches: Object.fromEntries(branches.map((branch) => [branch.branchId, { ...branch }])),
    merge: {
      status: 'pending',
      consumedBranches: [],
    },
    workflowDeadline: '2026-04-23T11:30:00.000Z',
    leafTimeoutMs: Object.fromEntries(branches.map((branch) => [branch.branchId, 5000])),
    fallbackExecutionMode: null,
    teamOrchestratorPending: false,
    workflow,
  };
}

describe('TeamOrchestrator [FEAT-014]', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('schema: exposes the required branch status enum and merge envelope shape', async () => {
    expect(BRANCH_STATUS_VALUES).toEqual([
      'pending',
      'dispatched',
      'running',
      'completed',
      'failed',
      'cancelled',
      'timed-out',
      'merge-consumed',
    ]);

    const runner = new FakeAgentRunner();
    const store = new CheckpointStore({ root: freshRoot(tempRoots) });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: store,
      createId: createIdFactory(['merge-ref-1']),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-parallel-schema',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branches = orchestrator.expandBranches(workflow).map((branch, index) => ({
      ...branch,
      status: 'completed' as const,
      attempt: 1,
      outputRef: `workflow://${workflow.workflowId}/branch/${index + 1}`,
      output: {
        content: `candidate-${index + 1}`,
        evidenceRefs: [`artifact://${index + 1}`],
      },
    }));

    const envelope = await orchestrator.runMerge(branches);

    expect(envelope).toMatchObject({
      workflowId: workflow.workflowId,
      mergeNodeId: 'merge-1',
      orchestrationMode: 'parallel',
      status: 'completed',
      body: {
        kind: 'parallel',
      },
    });
    expect(envelope.sourceBranches).toHaveLength(3);
    expect(envelope.body.kind).toBe('parallel');
    expect(envelope.body.candidates).toHaveLength(3);
    expect(envelope.body.findings.length).toBeGreaterThanOrEqual(3);
    expect(envelope.body.decision.selectedBranchIds).toHaveLength(3);
    store.close();
  });

  it('schema: rejects critic payloads that contain handoff fields', () => {
    expect(() =>
      assertValidCriticOutput({
        issues: [],
        implementationPlan: ['should not exist'],
      }),
    ).toThrow(/implementationPlan/);
  });

  it('mode: parallel splits by information source instead of human roles', () => {
    const orchestrator = new TeamOrchestrator({
      agentRunner: new FakeAgentRunner(),
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-parallel',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });

    const branches = orchestrator.expandBranches(workflow);

    expect(branches.map((branch) => branch.memberKey)).toEqual([
      'local-code-source',
      'official-doc-source',
      'historical-memory-source',
    ]);
    expect(branches.map((branch) => branch.metadata?.splitDimension)).toEqual([
      'information-source',
      'information-source',
      'information-source',
    ]);
  });

  it('mode: debate critic stays negative-only and runMerge blocks illegal payloads', async () => {
    const orchestrator = new TeamOrchestrator({
      agentRunner: new FakeAgentRunner(),
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-debate',
      orchestrationMode: 'debate',
      workflowTemplateId: 'debate-design-review',
      taskType: 'design',
    });
    const [proposer, critic] = orchestrator.expandBranches(workflow);

    proposer.status = 'completed';
    proposer.attempt = 1;
    proposer.outputRef = 'workflow://proposal';
    proposer.output = {
      content: 'full proposal',
      evidenceRefs: ['artifact://proposal'],
    };

    critic.status = 'completed';
    critic.attempt = 1;
    critic.outputRef = 'workflow://critic';
    critic.output = {
      content: JSON.stringify({ issues: [], revisedProposal: 'illegal handoff' }),
      evidenceRefs: ['artifact://critic'],
    };

    await expect(orchestrator.runMerge([proposer, critic])).rejects.toThrow(/revisedProposal/);
  });

  it('mode: pipeline enforces deterministic-toolchain via static metadata and runtime guard', async () => {
    const runner = new FakeAgentRunner({
      'collect-inputs': { content: 'step-1' },
      'normalize-output': { content: 'step-2' },
      'publish-artifact': { content: 'step-3' },
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
      createId: createIdFactory(['merge-ref-pipeline']),
    });

    const legalWorkflow = createTeamWorkflow({
      workflowId: 'workflow-pipeline',
      orchestrationMode: 'pipeline',
      workflowTemplateId: 'pipeline-deterministic-tools',
      taskType: 'deterministic-toolchain',
    });
    const illegalWorkflow = createTeamWorkflow({
      workflowId: 'workflow-pipeline-illegal',
      orchestrationMode: 'pipeline',
      workflowTemplateId: 'pipeline-deterministic-tools',
      taskType: 'analysis',
    });

    expect(() => orchestrator.expandBranches(illegalWorkflow)).toThrow(/deterministic-toolchain/);

    const result = await orchestrator.executeWorkflow(
      legalWorkflow,
      {
        executionMode: 'team',
        orchestrationMode: 'pipeline',
        workflowTemplateId: 'pipeline-deterministic-tools',
      },
      createRawContextRefs(),
    );

    expect(result.envelope.body.kind).toBe('pipeline');
    expect(result.envelope.body.decision.outcome).toBe('completed');
    expect(runner.calls[1]?.task).toContain('upstreamOutputRef: workflow://workflow-pipeline/branches/workflow-pipeline:collect-inputs/attempt/1');
  });

  it('mode: hub-spoke models complementary slices and synthesis merge', async () => {
    const orchestrator = new TeamOrchestrator({
      agentRunner: new FakeAgentRunner(),
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
      createId: createIdFactory(['merge-ref-hub']),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-hub',
      orchestrationMode: 'hub-spoke',
      workflowTemplateId: 'hub-spoke-analysis',
      taskType: 'analysis',
    });
    const branches = orchestrator.expandBranches(workflow).map((branch, index) => ({
      ...branch,
      status: 'completed' as const,
      attempt: 1,
      outputRef: `workflow://workflow-hub/slice/${index + 1}`,
      output: {
        content: `slice-${index + 1}`,
        evidenceRefs: [`artifact://slice-${index + 1}`],
      },
    }));

    const envelope = await orchestrator.runMerge(branches);

    expect(branches.map((branch) => branch.metadata?.slice)).toEqual(['code', 'docs', 'ci-logs']);
    expect(envelope.body.kind).toBe('hub-spoke');
    expect(envelope.body.decision.outcome).toBe('synthesized');
    expect(envelope.body.candidates.every((candidate) => candidate.role === 'slice')).toBe(true);
  });

  it('lifecycle: dispatchBranch follows status transitions and retry increments attempt', async () => {
    const runner = new FakeAgentRunner({
      'local-code-source': [{ content: 'attempt-1' }, { content: 'attempt-2' }],
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-retry',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branch = orchestrator.expandBranches(workflow)[0]!;

    const first = await orchestrator.dispatchBranch(branch, runner, {
      rawContextRefs: createRawContextRefs(),
    });
    const second = await orchestrator.dispatchBranch(first, runner, {
      rawContextRefs: createRawContextRefs(),
    });

    expect(first.status).toBe('completed');
    expect(first.attempt).toBe(1);
    expect(second.status).toBe('completed');
    expect(second.attempt).toBe(2);
    expect(second.output?.content).toBe('attempt-2');
  });

  it('lifecycle: provider fallback inside runner does not create extra branch ledger entries', async () => {
    const runner = new FakeAgentRunner({
      'local-code-source': { content: 'completed-after-provider-fallback', responseId: 'resp-1' },
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-fallback',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branch = orchestrator.expandBranches(workflow)[0]!;
    const state = createTeamState(workflow, [branch]);

    state.branches[branch.branchId] = await orchestrator.dispatchBranch(branch, runner, {
      rawContextRefs: createRawContextRefs(),
    });

    expect(Object.keys(state.branches)).toEqual([branch.branchId]);
    expect(state.branches[branch.branchId]?.leafSessionRef?.sessionId).toBe('session-local-code-source-1');
  });

  it('checkpoint/resume: resumes from fork checkpoint without reclassification and merges once', async () => {
    const root = freshRoot(tempRoots);
    const runner = new FakeAgentRunner();
    const store = new CheckpointStore({ root });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: store,
      createId: createIdFactory(['merge-ref-resume']),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-resume-fork',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branches = orchestrator.expandBranches(workflow);
    const state = createTeamState(workflow, branches);

    orchestrator.writeCheckpoint('fork-dispatch', {
      workflow,
      decision: {
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
      },
      rawContextRefs: createRawContextRefs(),
      branchState: state,
    });

    const resumed = await orchestrator.resumeWorkflow(workflow.workflowId);

    expect(resumed).not.toBeNull();
    expect(resumed?.resumeTarget?.strategy).toBe('node-restart');
    expect(resumed?.workflow.workflowId).toBe(workflow.workflowId);
    expect(resumed?.state.teamStatus).toBe('merged');
    expect(resumed?.state.merge?.consumedBranches).toHaveLength(3);
    expect(runner.calls).toHaveLength(3);
    store.close();
  });

  it('checkpoint/resume: partial-merge dedupe does not re-consume consumedBranches', async () => {
    const root = freshRoot(tempRoots);
    const runner = new FakeAgentRunner();
    const store = new CheckpointStore({ root });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: store,
      createId: createIdFactory(['merge-ref-first', 'merge-ref-second']),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-resume-dedupe',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });

    const first = await orchestrator.executeWorkflow(
      workflow,
      {
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
      },
      createRawContextRefs(),
    );
    const callCountAfterFirstRun = runner.calls.length;
    const resumed = await orchestrator.resumeWorkflow(workflow.workflowId);

    expect(resumed?.state.merge?.consumedBranches).toEqual(first.state.merge?.consumedBranches);
    expect(runner.calls.length).toBe(callCountAfterFirstRun);
    expect(resumed?.state.merge?.consumedBranches).toHaveLength(3);
    store.close();
  });

  it('checkpoint/resume: continuationRef has priority over providerResponseId and node restart', async () => {
    const root = freshRoot(tempRoots);
    const runner = new FakeAgentRunner();
    const store = new CheckpointStore({ root });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: store,
      createId: createIdFactory(['merge-ref-cont']),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-resume-continuation',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const [branch] = orchestrator.expandBranches(workflow);
    branch.status = 'running';
    branch.attempt = 1;
    branch.leafSessionRef = {
      nodeId: branch.nodeId,
      sessionId: 'leaf-session-1',
      continuationRef: 'cont-1',
      providerResponseId: 'resp-1',
    };
    const state = createTeamState(workflow, [branch]);
    state.activeNodeId = branch.nodeId;

    orchestrator.writeCheckpoint('leaf-terminal', {
      workflow,
      decision: {
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
      },
      rawContextRefs: createRawContextRefs(),
      branchState: state,
    });

    const resumed = await orchestrator.resumeWorkflow(workflow.workflowId);

    expect(resumed?.resumeTarget).toMatchObject({
      strategy: 'continuation-ref',
      continuationRef: 'cont-1',
      sessionId: 'leaf-session-1',
    });
    store.close();
  });
});

function freshRoot(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'haro-team-orchestrator-'));
  tempRoots.push(root);
  return root;
}

function createIdFactory(ids: string[]) {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    if (!value) {
      return `generated-${index}`;
    }
    return value;
  };
}
