import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CheckpointStore,
  ScenarioRouter,
  type WorkflowCheckpointState,
} from '../src/scenario-router.js';

function createIdFactory(ids: string[]) {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    if (!value) {
      throw new Error('ran out of deterministic ids');
    }
    return value;
  };
}

function createCheckpointState(input: {
  workflowId: string;
  nodeId?: string;
  continuationRef?: string;
  providerResponseId?: string;
  rawContextRefs?: Array<{ kind: 'input' | 'artifact' | 'session-event'; ref: string }>;
  createdAt?: string;
}): WorkflowCheckpointState {
  return {
    workflowId: input.workflowId,
    nodeId: input.nodeId ?? 'leaf-1',
    nodeType: 'agent',
    sceneDescriptor: {
      taskType: 'quick',
      complexity: 'simple',
      collaborationNeed: 'single-agent',
      timeSensitivity: 'realtime',
      validationNeed: 'none',
      tags: ['quick', 'simple'],
    },
    routingDecision: {
      executionMode: 'single-agent',
      workflowTemplateId: 'single-fast',
      matchedRuleId: 'quick-simple-single',
      providerSelectionHints: {
        preferredTags: ['quick', 'simple'],
        estimatedComplexity: 'simple',
        requiresLargeContext: false,
      },
    },
    rawContextRefs: input.rawContextRefs ?? [{ kind: 'input', ref: 'channel://messages/1' }],
    branchState: { completedBranches: [] },
    leafSessionRefs: [
      {
        nodeId: input.nodeId ?? 'leaf-1',
        sessionId: 'leaf-session-1',
        continuationRef: input.continuationRef,
        providerResponseId: input.providerResponseId,
      },
    ],
    createdAt: input.createdAt ?? '2026-04-22T08:40:00.000Z',
  };
}

describe('ScenarioRouter [FEAT-013]', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('AC1 routes quick + simple scenes to single-fast', () => {
    const router = new ScenarioRouter({
      createId: createIdFactory(['workflow-1', 'leaf-1']),
    });

    const plan = router.plan('请快速总结当前任务状态');

    expect(plan.scene).toMatchObject({
      taskType: 'quick',
      complexity: 'simple',
      collaborationNeed: 'single-agent',
    });
    expect(plan.decision).toMatchObject({
      executionMode: 'single-agent',
      workflowTemplateId: 'single-fast',
      matchedRuleId: 'quick-simple-single',
    });
    expect(plan.workflow.leafSessionRefs).toHaveLength(1);
  });

  it('AC2 routes analysis + complex scenes to hub-spoke and never pipeline', () => {
    const router = new ScenarioRouter();
    const scene = router.classify('请分析这个复杂系统故障，跨文件定位根因并拆分信息维度');
    const decision = router.route(scene);

    expect(scene).toMatchObject({
      taskType: 'analysis',
      complexity: 'complex',
      collaborationNeed: 'team',
    });
    expect(decision).toMatchObject({
      executionMode: 'team',
      orchestrationMode: 'hub-spoke',
      workflowTemplateId: 'hub-spoke-analysis',
    });
    expect(decision.orchestrationMode).not.toBe('pipeline');
  });

  it('AC4 keeps single-agent workflows at 1 workflowId -> 1 leaf sessionId', () => {
    const router = new ScenarioRouter({
      createId: createIdFactory(['workflow-1', 'leaf-session-1']),
    });

    const workflow = router.createWorkflow(
      {
        executionMode: 'single-agent',
        workflowTemplateId: 'single-fast',
      },
      { channelSessionId: 'channel-session-1' },
    );

    expect(workflow.workflowId).toBe('workflow-1');
    expect(workflow.channelSessionId).toBe('channel-session-1');
    expect(workflow.leafSessionRefs).toEqual([
      {
        nodeId: 'leaf-1',
        sessionId: 'leaf-session-1',
      },
    ]);
    expect(new Set(workflow.leafSessionRefs.map((ref) => ref.sessionId)).size).toBe(1);
    expect(workflow.leafSessionRefs[0]?.sessionId).not.toBe(workflow.workflowId);
  });

  it('AC5 persists workflow checkpoints with the required JSON state fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-scenario-router-'));
    tempRoots.push(root);
    const store = new CheckpointStore({
      root,
      createId: createIdFactory(['checkpoint-1']),
    });

    const saved = store.save({
      state: createCheckpointState({
        workflowId: 'workflow-1',
      }),
    });

    const db = new Database(join(root, 'haro.db'), { readonly: true });
    try {
      const row = db
        .prepare(
          'SELECT workflow_id, node_id, state, created_at FROM workflow_checkpoints WHERE id = ?',
        )
        .get('checkpoint-1') as
        | { workflow_id: string; node_id: string; state: string; created_at: string }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.workflow_id).toBe('workflow-1');
      expect(row?.node_id).toBe('leaf-1');
      expect(row?.created_at).toBe(saved.createdAt);
      const state = JSON.parse(row!.state) as Record<string, unknown>;
      expect(state).toEqual(
        expect.objectContaining({
          workflowId: 'workflow-1',
          nodeId: 'leaf-1',
          sceneDescriptor: expect.any(Object),
          routingDecision: expect.any(Object),
          rawContextRefs: expect.any(Array),
          branchState: expect.any(Object),
          leafSessionRefs: expect.any(Array),
          createdAt: saved.createdAt,
        }),
      );
    } finally {
      db.close();
      store.close();
    }
  });

  it('AC6 stores rawContextRefs as references instead of inline payload blobs', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-scenario-router-refs-'));
    tempRoots.push(root);
    const store = new CheckpointStore({
      root,
      createId: createIdFactory(['checkpoint-refs-1']),
    });

    store.save({
      state: createCheckpointState({
        workflowId: 'workflow-refs-1',
        rawContextRefs: [
          {
            kind: 'input',
            ref: 'channel://messages/2',
            payload: 'full raw text should not be embedded',
          } as unknown as { kind: 'input' | 'artifact' | 'session-event'; ref: string },
        ],
      }),
    });

    const saved = store.loadLatest('workflow-refs-1');
    expect(saved?.state.rawContextRefs).toEqual([{ kind: 'input', ref: 'channel://messages/2' }]);
    expect(saved?.state.rawContextRefs[0]).not.toHaveProperty('payload');
    store.close();
  });

  it('AC7 restores using continuationRef, then providerResponseId, then node-level restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-scenario-router-resume-'));
    tempRoots.push(root);
    const store = new CheckpointStore({
      root,
      createId: createIdFactory([
        'checkpoint-continuation',
        'checkpoint-response',
        'checkpoint-restart',
      ]),
    });

    store.save({
      state: createCheckpointState({
        workflowId: 'workflow-continuation',
        continuationRef: 'cont-1',
        providerResponseId: 'resp-ignored',
      }),
    });
    store.save({
      state: createCheckpointState({
        workflowId: 'workflow-response',
        continuationRef: undefined,
        providerResponseId: 'resp-2',
      }),
    });
    store.save({
      state: createCheckpointState({
        workflowId: 'workflow-restart',
        continuationRef: undefined,
        providerResponseId: undefined,
      }),
    });

    expect(store.resolveResume('workflow-continuation')).toMatchObject({
      strategy: 'continuation-ref',
      continuationRef: 'cont-1',
      sessionId: 'leaf-session-1',
    });
    expect(store.resolveResume('workflow-continuation')).not.toHaveProperty('providerResponseId');
    expect(store.resolveResume('workflow-response')).toMatchObject({
      strategy: 'provider-response-id',
      providerResponseId: 'resp-2',
      sessionId: 'leaf-session-1',
    });
    expect(store.resolveResume('workflow-response')).not.toHaveProperty('continuationRef');
    expect(store.resolveResume('workflow-restart')).toMatchObject({
      strategy: 'node-restart',
      nodeId: 'leaf-1',
      sessionId: 'leaf-session-1',
    });
    store.close();
  });

  it('AC8 keeps workflowId distinct from channel sessionId', () => {
    const router = new ScenarioRouter({
      createId: createIdFactory(['channel-session-1', 'workflow-2', 'leaf-session-2']),
    });

    const workflow = router.createWorkflow(
      {
        executionMode: 'single-agent',
        workflowTemplateId: 'single-fast',
      },
      { channelSessionId: 'channel-session-1' },
    );

    expect(workflow.channelSessionId).toBe('channel-session-1');
    expect(workflow.workflowId).toBe('workflow-2');
    expect(workflow.workflowId).not.toBe(workflow.channelSessionId);
    expect(workflow.leafSessionRefs[0]?.sessionId).toBe('leaf-session-2');
    expect(workflow.leafSessionRefs[0]?.sessionId).not.toBe(workflow.channelSessionId);
  });
});
