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
  delayMs?: number;
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

    if (reply.delayMs && reply.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    }

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

const NON_EXPIRING_TEST_WORKFLOW_DEADLINE = '2999-01-01T00:00:00.000Z';

function createTeamState(workflow: ScenarioWorkflow, branches: BranchLedgerEntry[]): TeamBranchState {
  return {
    teamStatus: 'running',
    activeNodeId: 'dispatch-1',
    branches: Object.fromEntries(branches.map((branch) => [branch.branchId, { ...branch }])),
    merge: {
      status: 'pending',
      consumedBranches: [],
    },
    workflowDeadline: NON_EXPIRING_TEST_WORKFLOW_DEADLINE,
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

  it('mode: debate executes proposer first and passes proposal output ref to critic', async () => {
    const runner = new FakeAgentRunner({
      'design-proposer': { content: 'full proposal' },
      'design-critic': {
        content: JSON.stringify({
          issues: [{ summary: 'missing rollback plan', evidenceRefs: ['artifact://critic'] }],
        }),
      },
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-debate-sequenced',
      orchestrationMode: 'debate',
      workflowTemplateId: 'debate-design-review',
      taskType: 'design',
    });

    const result = await orchestrator.executeWorkflow(
      workflow,
      {
        executionMode: 'team',
        orchestrationMode: 'debate',
        workflowTemplateId: 'debate-design-review',
      },
      createRawContextRefs(),
    );

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]?.task).toContain('memberKey: design-proposer');
    expect(runner.calls[1]?.task).toContain('memberKey: design-critic');
    expect(runner.calls[1]?.task).toContain(
      'reviewTargetOutputRef: workflow://workflow-debate-sequenced/branches/workflow-debate-sequenced:design-proposer/attempt/1',
    );
    expect(result.envelope.body.kind).toBe('debate');
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
    expect(runner.calls[0]?.continueLatestSession).toBe(false);
    expect(runner.calls[1]?.continueLatestSession).toBe(false);
    expect(runner.calls[1]?.retryOfSessionId).toBe(first.leafSessionRef?.sessionId);
  });

  it('lifecycle: branch retry is isolated from other branch latest sessions', async () => {
    const runner = new FakeAgentRunner({
      'local-code-source': [{ content: 'branch-a-1' }, { content: 'branch-a-2' }],
      'official-doc-source': [{ content: 'branch-b-1' }, { content: 'branch-b-2' }],
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-retry-isolation',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branches = orchestrator.expandBranches(workflow);
    const branchA = branches[0]!;
    const branchB = branches[1]!;

    const firstB = await orchestrator.dispatchBranch(branchB, runner, {
      rawContextRefs: createRawContextRefs(),
    });
    const firstA = await orchestrator.dispatchBranch(branchA, runner, {
      rawContextRefs: createRawContextRefs(),
    });
    const secondB = await orchestrator.dispatchBranch(firstB, runner, {
      rawContextRefs: createRawContextRefs(),
    });

    expect(secondB.status).toBe('completed');
    expect(secondB.attempt).toBe(2);
    expect(runner.calls[2]?.retryOfSessionId).toBe(firstB.leafSessionRef?.sessionId);
    expect(runner.calls[2]?.retryOfSessionId).not.toBe(firstA.leafSessionRef?.sessionId);
    expect(runner.calls[2]?.continueLatestSession).toBe(false);
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

  it('lifecycle: workflow deadline caps branch execution before leaf timeout', async () => {
    const runner = new FakeAgentRunner({
      '*': { content: 'slow-success', delayMs: 40 },
    });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
      workflowTimeoutMs: 10,
      leafTimeoutMs: 100,
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-deadline',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });

    const result = await orchestrator.executeWorkflow(
      workflow,
      {
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
      },
      createRawContextRefs(),
    );

    expect(result.state.teamStatus).toBe('timed-out');
    expect(result.envelope.sourceBranches.every((branch) => branch.status === 'cancelled')).toBe(true);
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

  it('checkpoint/writeCheckpoint: preserves retry leafSessionRefs history for the same node', () => {
    const root = freshRoot(tempRoots);
    const store = new CheckpointStore({ root });
    const orchestrator = new TeamOrchestrator({
      agentRunner: new FakeAgentRunner(),
      checkpointStore: store,
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-session-history',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const [branch] = orchestrator.expandBranches(workflow);
    const state = createTeamState(workflow, [branch]);

    state.workflow = {
      ...workflow,
      leafSessionRefs: [
        {
          nodeId: branch.nodeId,
          sessionId: 'leaf-session-2',
          continuationRef: 'cont-2',
        },
        {
          nodeId: branch.nodeId,
          sessionId: 'leaf-session-1',
          providerResponseId: 'resp-1',
        },
      ],
    };
    state.branches[branch.branchId] = {
      ...branch,
      attempt: 2,
      status: 'completed',
      leafSessionRef: {
        nodeId: branch.nodeId,
        sessionId: 'leaf-session-2',
        continuationRef: 'cont-2',
      },
      outputRef: 'workflow://workflow-session-history/branches/1',
      output: {
        content: 'retry output',
        evidenceRefs: ['artifact://retry'],
      },
    };

    const checkpoint = orchestrator.writeCheckpoint('leaf-terminal', {
      workflow,
      decision: {
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
      },
      rawContextRefs: createRawContextRefs(),
      branchState: state,
    });

    expect(checkpoint.state.leafSessionRefs).toHaveLength(2);
    expect(checkpoint.state.leafSessionRefs[0]).toMatchObject({
      sessionId: 'leaf-session-2',
      continuationRef: 'cont-2',
    });
    expect(checkpoint.state.leafSessionRefs[1]).toMatchObject({
      sessionId: 'leaf-session-1',
      providerResponseId: 'resp-1',
    });
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

  it('checkpoint/resume: commits a persisted merge-ready envelope without rerunning merge', async () => {
    const root = freshRoot(tempRoots);
    const runner = new FakeAgentRunner();
    let synthesizeCalls = 0;
    const store = new CheckpointStore({ root });
    const orchestrator = new TeamOrchestrator({
      agentRunner: runner,
      checkpointStore: store,
      createId: createIdFactory(['merge-ref-ready']),
      mergeSynthesizer: async () => {
        synthesizeCalls += 1;
        return {
          kind: 'parallel',
          candidates: [],
          findings: [],
          decision: {
            mode: 'blocked',
            selectedBranchIds: [],
            rationale: 'should not rerun merge synthesis during resume',
            evidenceRefs: [],
          },
        };
      },
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-resume-merge-ready',
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
    const state = createTeamState(workflow, branches);
    state.merge = {
      status: 'ready',
      consumedBranches: branches.map((branch) => branch.branchId),
      envelopeRef: 'checkpoint://workflow-resume-merge-ready/merge-1/merge-ref-ready',
      envelope: {
        workflowId: workflow.workflowId,
        mergeNodeId: 'merge-1',
        orchestrationMode: 'parallel',
        status: 'completed',
        sourceBranches: branches.map((branch) => ({
          branchId: branch.branchId,
          nodeId: branch.nodeId,
          status: 'completed' as const,
          outputRef: branch.outputRef,
        })),
        consumedBranches: branches.map((branch) => branch.branchId),
        checkpointRef: 'checkpoint://workflow-resume-merge-ready/merge-1/merge-ref-ready',
        evidenceRefs: branches.flatMap((branch) => branch.output?.evidenceRefs ?? []),
        body: {
          kind: 'parallel',
          candidates: branches.map((branch) => ({
            branchId: branch.branchId,
            outputRef: branch.outputRef!,
            evidenceRefs: branch.output?.evidenceRefs ?? [],
          })),
          findings: [],
          decision: {
            mode: 'union',
            selectedBranchIds: branches.map((branch) => branch.branchId),
            rationale: 'resume should commit persisted envelope',
            evidenceRefs: branches.flatMap((branch) => branch.output?.evidenceRefs ?? []),
          },
        },
      },
    };

    orchestrator.writeCheckpoint('merge', {
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

    expect(resumed?.state.teamStatus).toBe('merged');
    expect(resumed?.state.merge?.status).toBe('completed');
    expect(Object.values(resumed?.state.branches ?? {}).every((branch) => branch.status === 'merge-consumed')).toBe(
      true,
    );
    expect(runner.calls).toHaveLength(0);
    expect(synthesizeCalls).toBe(0);
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

  it('schema: rejects invalid merge body returned by a custom synthesizer', async () => {
    const orchestrator = new TeamOrchestrator({
      agentRunner: new FakeAgentRunner(),
      checkpointStore: new CheckpointStore({ root: freshRoot(tempRoots) }),
      mergeSynthesizer: async () =>
        ({
          kind: 'parallel',
          findings: [],
          decision: {
            mode: 'union',
            selectedBranchIds: [],
            rationale: 'missing candidates should be rejected',
            evidenceRefs: [],
          },
        }) as never,
    });
    const workflow = createTeamWorkflow({
      workflowId: 'workflow-invalid-envelope',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
      taskType: 'research',
    });
    const branches = orchestrator.expandBranches(workflow).map((branch) => ({
      ...branch,
      status: 'completed' as const,
      attempt: 1,
      outputRef: `workflow://${workflow.workflowId}/${branch.memberKey}`,
      output: {
        content: branch.memberKey,
        evidenceRefs: [`artifact://${branch.memberKey}`],
      },
    }));

    await expect(orchestrator.runMerge(branches)).rejects.toThrow(/candidates/);
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
