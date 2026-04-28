import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore, PermissionBudgetStore, type WorkflowCheckpointState } from '@haro/core';
import { createWebApp } from '../src/web/index.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createCheckpointState(input: {
  workflowId: string;
  nodeId: string;
  createdAt: string;
  teamStatus?: string;
  branchStatus?: string;
  lastError?: string;
  mergeStatus?: string;
}): WorkflowCheckpointState {
  return {
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    nodeType: input.nodeId === 'merge-1' ? 'merge' : 'team',
    sceneDescriptor: {
      taskType: 'code',
      complexity: 'complex',
      collaborationNeed: 'team',
      timeSensitivity: 'realtime',
      validationNeed: 'standard',
      tags: ['feat-018'],
    },
    routingDecision: {
      executionMode: 'team',
      orchestrationMode: 'parallel',
      workflowTemplateId: 'parallel-research',
    },
    budget: {
      budgetId: `budget:${input.workflowId}`,
      estimatedBranches: 2,
      estimatedTokens: 2000,
    },
    rawContextRefs: [
      { kind: 'input', ref: `workflow://${input.workflowId}/input` },
      { kind: 'artifact', ref: `artifact://${input.workflowId}/source` },
    ],
    branchState: {
      teamStatus: input.teamStatus ?? 'running',
      activeNodeId: input.nodeId,
      branches: {
        'branch-a': {
          workflowId: input.workflowId,
          branchId: 'branch-a',
          nodeId: 'parallel-branch-1',
          memberKey: 'local-code-source',
          instructions: 'Inspect local code',
          mode: 'parallel',
          status: input.branchStatus ?? 'running',
          attempt: 2,
          startedAt: '2026-04-26T06:00:00.000Z',
          finishedAt: input.branchStatus === 'failed' ? input.createdAt : undefined,
          lastError: input.lastError,
          leafSessionRef: {
            nodeId: 'parallel-branch-1',
            sessionId: 'leaf-session-a',
            continuationRef: 'cont-a',
          },
          outputRef: 'workflow://workflow-debug/branches/branch-a/output',
          consumedByMerge: false,
          branchRole: 'candidate',
        },
        'branch-b': {
          workflowId: input.workflowId,
          branchId: 'branch-b',
          nodeId: 'parallel-branch-2',
          memberKey: 'docs-source',
          instructions: 'Inspect docs',
          mode: 'parallel',
          status: 'completed',
          attempt: 1,
          startedAt: '2026-04-26T06:00:10.000Z',
          finishedAt: '2026-04-26T06:01:00.000Z',
          leafSessionRef: {
            nodeId: 'parallel-branch-2',
            sessionId: 'leaf-session-b',
          },
          outputRef: 'workflow://workflow-debug/branches/branch-b/output',
          consumedByMerge: input.mergeStatus === 'completed',
          branchRole: 'candidate',
        },
      },
      merge: {
        status: input.mergeStatus ?? 'pending',
        consumedBranches: input.mergeStatus === 'completed' ? ['branch-a', 'branch-b'] : [],
        envelope:
          input.mergeStatus === 'completed'
            ? {
                workflowId: input.workflowId,
                mergeNodeId: 'merge-1',
                orchestrationMode: 'parallel',
                status: 'completed',
                sourceBranches: [
                  { branchId: 'branch-a', nodeId: 'parallel-branch-1', status: 'completed' },
                  { branchId: 'branch-b', nodeId: 'parallel-branch-2', status: 'completed' },
                ],
                consumedBranches: ['branch-a', 'branch-b'],
                checkpointRef: `workflow://${input.workflowId}/checkpoint/merge`,
                evidenceRefs: ['artifact://merge-evidence'],
                body: {
                  kind: 'parallel',
                  candidates: [],
                  findings: [],
                  decision: {
                    mode: 'union',
                    selectedBranchIds: ['branch-a', 'branch-b'],
                    rationale: 'combine evidence',
                    evidenceRefs: ['artifact://merge-evidence'],
                  },
                },
              }
            : undefined,
      },
    },
    leafSessionRefs: [
      { nodeId: 'parallel-branch-1', sessionId: 'leaf-session-a', continuationRef: 'cont-a' },
      { nodeId: 'parallel-branch-2', sessionId: 'leaf-session-b' },
    ],
    createdAt: input.createdAt,
  };
}

describe('web dashboard orchestration debugger API [FEAT-018]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('lists workflow summaries from existing checkpoints and guard read models', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat018-list-'));
    tempRoots.push(root);
    const checkpointStore = new CheckpointStore({ root });
    checkpointStore.save({
      id: 'checkpoint-fork',
      workflowId: 'workflow-debug',
      nodeId: 'dispatch-1',
      createdAt: '2026-04-26T06:00:00.000Z',
      state: createCheckpointState({
        workflowId: 'workflow-debug',
        nodeId: 'dispatch-1',
        createdAt: '2026-04-26T06:00:00.000Z',
      }),
    });
    checkpointStore.save({
      id: 'checkpoint-stalled',
      workflowId: 'workflow-debug',
      nodeId: 'parallel-branch-1',
      createdAt: '2026-04-26T06:05:00.000Z',
      state: createCheckpointState({
        workflowId: 'workflow-debug',
        nodeId: 'parallel-branch-1',
        createdAt: '2026-04-26T06:05:00.000Z',
        teamStatus: 'needs-human-intervention',
        branchStatus: 'failed',
        lastError: 'tool timed out',
      }),
    });
    checkpointStore.close();

    let nextBudgetId = 0;
    const budgetStore = new PermissionBudgetStore({ root, createId: () => `budget-test-id-${nextBudgetId++}` });
    budgetStore.ensureWorkflowBudget({
      workflowId: 'workflow-debug',
      budgetId: 'budget:workflow-debug',
      limitTokens: 20,
      softLimitRatio: 0.5,
    });
    budgetStore.recordTokenUsage({
      workflowId: 'workflow-debug',
      budgetId: 'budget:workflow-debug',
      branchId: 'branch-a',
      agentId: 'agent-a',
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 8,
      outputTokens: 4,
    });
    budgetStore.recordAudit({
      workflowId: 'workflow-debug',
      branchId: 'branch-a',
      agentId: 'agent-a',
      eventType: 'permission-decision',
      operationClass: 'network',
      policy: 'needs-approval',
      outcome: 'blocked',
      reason: 'external fetch requires approval',
    });
    budgetStore.close();

    const app = createWebApp({ logger: createMockLogger(), staticRoot: root, runtime: { root } });
    const response = await app.request('/api/v1/workflows');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        items: [
          {
            workflowId: 'workflow-debug',
            executionMode: 'team',
            orchestrationMode: 'parallel',
            templateId: 'parallel-research',
            currentNodeId: 'parallel-branch-1',
            latestCheckpointRef: 'checkpoint-stalled',
            status: 'needs-human-intervention',
            blockedReason: 'budget',
            budgetState: {
              budgetId: 'budget:workflow-debug',
              usedTokens: 12,
              limitTokens: 20,
              state: 'near-limit',
            },
            permissionState: {
              requiredClass: 'network',
              state: 'needs-approval',
            },
          },
        ],
      },
    });
    expect(body.data.items[0].stalledBranches).toEqual([
      expect.objectContaining({
        branchId: 'branch-a',
        memberKey: 'local-code-source',
        status: 'failed',
        attempt: 2,
        lastError: 'tool timed out',
        consumedByMerge: false,
      }),
    ]);
  });

  it('returns workflow detail with branch ledger, merge envelope, refs, and checkpoint metadata', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat018-detail-'));
    tempRoots.push(root);
    const checkpointStore = new CheckpointStore({ root });
    checkpointStore.save({
      id: 'checkpoint-merge',
      workflowId: 'workflow-merged',
      nodeId: 'merge-1',
      createdAt: '2026-04-26T06:10:00.000Z',
      state: createCheckpointState({
        workflowId: 'workflow-merged',
        nodeId: 'merge-1',
        createdAt: '2026-04-26T06:10:00.000Z',
        teamStatus: 'merged',
        branchStatus: 'completed',
        mergeStatus: 'completed',
      }),
    });
    checkpointStore.close();

    const app = createWebApp({ logger: createMockLogger(), staticRoot: root, runtime: { root } });
    const response = await app.request('/api/v1/workflows/workflow-merged');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        workflowId: 'workflow-merged',
        status: 'merged',
        currentNodeId: 'merge-1',
        recentCheckpointRef: 'checkpoint-merge',
        branchLedger: [
          expect.objectContaining({
            branchId: 'branch-a',
            leafSessionRef: expect.objectContaining({ sessionId: 'leaf-session-a' }),
          }),
          expect.objectContaining({
            branchId: 'branch-b',
            consumedByMerge: true,
          }),
        ],
        mergeEnvelope: expect.objectContaining({
          workflowId: 'workflow-merged',
          orchestrationMode: 'parallel',
          consumedBranches: ['branch-a', 'branch-b'],
        }),
        leafSessionRefs: [
          expect.objectContaining({ sessionId: 'leaf-session-a' }),
          expect.objectContaining({ sessionId: 'leaf-session-b' }),
        ],
        rawContextRefs: [
          { kind: 'input', ref: 'workflow://workflow-merged/input' },
          { kind: 'artifact', ref: 'artifact://workflow-merged/source' },
        ],
        checkpoints: [
          {
            checkpointId: 'checkpoint-merge',
            nodeId: 'merge-1',
            nodeType: 'merge',
            createdAt: '2026-04-26T06:10:00.000Z',
          },
        ],
      },
    });
  });

  it('keeps FEAT-024 owning memory/skills while FEAT-025 owns providers contracts', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat018-feat024-boundary-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), staticRoot: process.cwd(), runtime: { root } });

    await expect(app.request('/api/v1/memory/stats')).resolves.toMatchObject({ status: 200 });
    await expect(app.request('/api/v1/skills')).resolves.toMatchObject({ status: 200 });
    // FEAT-029 follow-up: /api/v1/providers exposes the registered provider list
    // (used by the chat page to populate provider/model dropdowns).
    await expect(app.request('/api/v1/providers')).resolves.toMatchObject({ status: 200 });
  });
});
