import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore, PermissionBudgetStore, classifyOperation, resolveOperationPolicy } from '@haro/core';
import { createWebApp } from '../src/web/index.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('web orchestration debugger REST [FEAT-018]', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat018-'));
    roots.push(root);
    return root;
  }

  it('exposes workflow list/detail/checkpoint read models from checkpoint JSON and guard summary', async () => {
    const root = tempRoot();
    const checkpointStore = new CheckpointStore({ root, createId: createIdFactory(['checkpoint-fork', 'checkpoint-merge']) });
    checkpointStore.save({ state: createCheckpointState('workflow-feat018', 'dispatch-1', 'team') });
    checkpointStore.save({ state: createCheckpointState('workflow-feat018', 'merge-1', 'merge') });
    checkpointStore.close();

    const budgetStore = new PermissionBudgetStore({ root, createId: createIdFactory(['budget-ledger', 'budget-audit-1', 'budget-audit-2', 'permission-audit']) });
    budgetStore.ensureWorkflowBudget({ workflowId: 'workflow-feat018', budgetId: 'budget:workflow-feat018', limitTokens: 100, softLimitRatio: 0.8 });
    budgetStore.recordTokenUsage({
      workflowId: 'workflow-feat018',
      budgetId: 'budget:workflow-feat018',
      branchId: 'workflow-feat018:branch-b',
      agentId: 'agent-b',
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 70,
      outputTokens: 40,
    });
    const classification = classifyOperation({ externalService: 'feishu', intent: 'send approval request' });
    budgetStore.recordPermissionDecision({
      workflowId: 'workflow-feat018',
      decision: resolveOperationPolicy({ classification }),
      targetRef: classification.targetRef,
    });
    budgetStore.close();

    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });
    const list = await (await app.request('/api/v1/workflows')).json();
    expect(list.data.items[0]).toMatchObject({
      workflowId: 'workflow-feat018',
      executionMode: 'team',
      orchestrationMode: 'parallel',
      templateId: 'parallel-research',
      status: 'blocked',
      currentNodeId: 'merge-1',
      blockedReason: 'budget',
    });

    const detail = await (await app.request('/api/v1/workflows/workflow-feat018')).json();
    expect(detail.data.branchLedger).toHaveLength(3);
    expect(detail.data.stalledBranches[0]).toMatchObject({
      branchId: 'workflow-feat018:branch-b',
      memberKey: 'branch-b',
      status: 'timed-out',
      lastError: 'leaf timed out',
      consumedByMerge: false,
    });
    expect(detail.data.mergeEnvelope).toMatchObject({ status: 'blocked', consumedBranches: ['workflow-feat018:branch-a'] });
    expect(detail.data.rawContextRefs[0]).toEqual({ kind: 'input', ref: 'channel://cli/sessions/1' });
    expect(detail.data.budgetState).toMatchObject({ budgetId: 'budget:workflow-feat018', usedTokens: 110, state: 'exceeded' });
    expect(detail.data.permissionState).toMatchObject({ state: 'needs-approval', requiredClass: 'external-service' });

    const checkpoints = await (await app.request('/api/v1/workflows/workflow-feat018/checkpoints')).json();
    expect(checkpoints.data.items.map((item: { checkpointId: string }) => item.checkpointId)).toEqual(['checkpoint-fork', 'checkpoint-merge']);
    expect(checkpoints.data.items[1].state.branchState.merge.envelope.body.decision.outcome).toBe('blocked');
  });

  it('returns an empty success envelope for workflow list when no checkpoint data exists', async () => {
    const root = tempRoot();
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });
    const response = await app.request('/api/v1/workflows');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { items: [], total: 0 } });
  });
});

function createIdFactory(ids: string[]) {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('No test id left');
    return id;
  };
}

function createCheckpointState(workflowId: string, nodeId: string, nodeType: 'team' | 'merge') {
  const mergeStatus = nodeType === 'merge' ? 'blocked' : 'pending';
  return {
    workflowId,
    nodeId,
    nodeType,
    sceneDescriptor: {
      taskType: 'research',
      complexity: 'complex',
      collaborationNeed: 'team',
      timeSensitivity: 'realtime',
      validationNeed: 'standard',
    },
    routingDecision: {
      executionMode: 'team',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
    },
    rawContextRefs: [{ kind: 'input', ref: 'channel://cli/sessions/1' }],
    branchState: {
      teamStatus: nodeType === 'merge' ? 'blocked' : 'running',
      activeNodeId: nodeId,
      branches: {
        [`${workflowId}:branch-a`]: {
          branchId: `${workflowId}:branch-a`,
          memberKey: 'branch-a',
          nodeId: 'branch-a-node',
          status: nodeType === 'merge' ? 'merge-consumed' : 'completed',
          attempt: 1,
          startedAt: '2026-04-26T00:00:00.000Z',
          lastEventAt: '2026-04-26T00:01:00.000Z',
          outputRef: 'artifact://branch-a',
          consumedByMerge: nodeType === 'merge',
          leafSessionRef: { nodeId: 'branch-a-node', sessionId: 'leaf-a', continuationRef: 'cont-a' },
        },
        [`${workflowId}:branch-b`]: {
          branchId: `${workflowId}:branch-b`,
          memberKey: 'branch-b',
          nodeId: 'branch-b-node',
          status: 'timed-out',
          attempt: 2,
          startedAt: '2026-04-26T00:00:00.000Z',
          lastEventAt: '2026-04-26T00:02:00.000Z',
          lastError: 'leaf timed out',
          consumedByMerge: false,
          leafSessionRef: { nodeId: 'branch-b-node', sessionId: 'leaf-b' },
        },
        [`${workflowId}:branch-c`]: {
          branchId: `${workflowId}:branch-c`,
          memberKey: 'branch-c',
          nodeId: 'branch-c-node',
          status: 'running',
          attempt: 1,
          startedAt: '2026-04-26T00:00:00.000Z',
          consumedByMerge: false,
        },
      },
      merge: {
        status: mergeStatus,
        consumedBranches: nodeType === 'merge' ? [`${workflowId}:branch-a`] : [],
        envelope: nodeType === 'merge' ? {
          workflowId,
          mergeNodeId: 'merge-1',
          orchestrationMode: 'parallel',
          status: 'blocked',
          sourceBranches: [{ branchId: `${workflowId}:branch-a`, nodeId: 'branch-a-node', status: 'completed', outputRef: 'artifact://branch-a' }],
          consumedBranches: [`${workflowId}:branch-a`],
          checkpointRef: 'checkpoint://workflow-feat018/merge-1/checkpoint-merge',
          evidenceRefs: ['artifact://branch-a'],
          body: { kind: 'parallel', candidates: [], findings: [], decision: { outcome: 'blocked', rationale: 'budget blocked merge', evidenceRefs: [] } },
        } : undefined,
      },
      workflow: {
        workflowId,
        executionMode: 'team',
        orchestrationMode: 'parallel',
        workflowTemplateId: 'parallel-research',
        leafSessionRefs: [{ nodeId: 'branch-a-node', sessionId: 'leaf-a' }],
        nodes: [{ id: 'dispatch-1', type: 'team' }, { id: 'merge-1', type: 'merge' }],
        createdAt: '2026-04-26T00:00:00.000Z',
      },
    },
    leafSessionRefs: [{ nodeId: 'branch-a-node', sessionId: 'leaf-a' }, { nodeId: 'branch-b-node', sessionId: 'leaf-b' }],
    createdAt: nodeType === 'merge' ? '2026-04-26T00:03:00.000Z' : '2026-04-26T00:00:00.000Z',
  };
}
