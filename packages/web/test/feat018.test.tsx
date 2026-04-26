import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckpointDebugDrawer } from '@/components/dispatch/CheckpointDebugDrawer';
import { WorkflowGraph } from '@/components/dispatch/WorkflowGraph';
import { DispatchPageView } from '@/pages/DispatchPage';
import { useWorkflowStore, type WorkflowDetail } from '@/stores/workflows';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function resetWorkflowStore() {
  useWorkflowStore.setState({
    items: [],
    total: 0,
    selectedWorkflowId: null,
    detail: null,
    loading: false,
    error: null,
  });
}

describe('FEAT-018 orchestration debugger web UI', () => {
  beforeEach(() => resetWorkflowStore());

  afterEach(() => {
    vi.unstubAllGlobals();
    resetWorkflowStore();
  });

  it('workflow store reads list/detail contracts without write operations', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/workflows')) return jsonResponse({ success: true, data: { items: [workflowSummary], total: 1 } });
      if (url.endsWith('/api/v1/workflows/workflow-feat018')) return jsonResponse({ success: true, data: workflowDetail });
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await useWorkflowStore.getState().loadWorkflows();
    await useWorkflowStore.getState().selectWorkflow('workflow-feat018');

    expect(useWorkflowStore.getState().items[0].workflowId).toBe('workflow-feat018');
    expect(useWorkflowStore.getState().detail?.branchLedger[1].lastError).toBe('leaf timed out');
    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/workflows/workflow-feat018',
    ]);
  });

  it('renders fork-and-merge graph as parallel branches, not a chain', () => {
    const html = renderToString(<WorkflowGraph workflow={workflowDetail} />);

    expect(html).toContain('data-layout="fork-and-merge"');
    expect(html).toContain('Fork');
    expect(html).toContain('Merge');
    expect(html).toContain('branch-a');
    expect(html).toContain('branch-b');
    expect(html).toContain('branch-c');
    expect(html).toContain('不展示 branch-to-branch chain');
  });

  it('blocked workflow highlights human intervention and does not show write action buttons', () => {
    useWorkflowStore.setState({ items: [workflowSummary], total: 1, selectedWorkflowId: 'workflow-feat018', detail: workflowDetail });

    const html = renderToString(
      <DispatchPageView
        items={[workflowSummary]}
        total={1}
        detail={workflowDetail}
        loading={false}
        error={null}
        loadWorkflows={async () => undefined}
        selectWorkflow={async () => undefined}
      />,
    );

    expect(html).toContain('需要人类介入');
    expect(html).toContain('阻断原因：');
    expect(html).toContain('budget');
    expect(html).toContain('Branch Ledger');
    expect(html).not.toMatch(/<button[^>]*>approve<\/button>/i);
    expect(html).not.toMatch(/<button[^>]*>continue<\/button>/i);
    expect(html).not.toMatch(/<button[^>]*>stop<\/button>/i);
    expect(html).not.toMatch(/<button[^>]*>retry<\/button>/i);
    expect(html).not.toMatch(/<button[^>]*>skip<\/button>/i);
  });

  it('debug drawer shows complete structured checkpoint JSON sections', () => {
    const html = renderToString(
      <CheckpointDebugDrawer
        checkpoint={workflowDetail.latestCheckpoint ?? null}
        workflow={workflowDetail}
        open
      />,
    );

    expect(html).toContain('rawContextRefs');
    expect(html).toContain('sceneDescriptor / routingDecision');
    expect(html).toContain('branchState.branches');
    expect(html).toContain('branchState.merge');
    expect(html).toContain('leafSessionRefs');
    expect(html).toContain('budgetState / permissionState');
    expect(html).toContain('complete checkpoint JSON');
    expect(html).toContain('workflow-feat018:branch-b');
    expect(html).toContain('leaf timed out');
  });
});

const workflowSummary = {
  workflowId: 'workflow-feat018',
  executionMode: 'team',
  orchestrationMode: 'parallel',
  templateId: 'parallel-research',
  status: 'blocked' as const,
  createdAt: '2026-04-26T00:00:00.000Z',
  updatedAt: '2026-04-26T00:03:00.000Z',
  currentNodeId: 'merge-1',
  latestCheckpointRef: 'checkpoint-merge',
  blockedReason: 'budget' as const,
  budgetState: { budgetId: 'budget:workflow-feat018', usedTokens: 110, limitTokens: 100, state: 'exceeded' },
  permissionState: { requiredClass: 'external-service', state: 'needs-approval' as const },
};

const workflowDetail: WorkflowDetail = {
  ...workflowSummary,
  latestCheckpoint: {
    checkpointId: 'checkpoint-merge',
    workflowId: 'workflow-feat018',
    nodeId: 'merge-1',
    nodeType: 'merge',
    createdAt: '2026-04-26T00:03:00.000Z',
    state: {
      workflowId: 'workflow-feat018',
      nodeId: 'merge-1',
      nodeType: 'merge',
      rawContextRefs: [{ kind: 'input', ref: 'channel://cli/sessions/1' }],
      sceneDescriptor: { taskType: 'research', complexity: 'complex' },
      routingDecision: { executionMode: 'team', orchestrationMode: 'parallel', workflowTemplateId: 'parallel-research' },
      branchState: {
        branches: {
          'workflow-feat018:branch-a': { memberKey: 'branch-a', status: 'merge-consumed' },
          'workflow-feat018:branch-b': { memberKey: 'branch-b', status: 'timed-out', lastError: 'leaf timed out' },
        },
        merge: { status: 'blocked', consumedBranches: ['workflow-feat018:branch-a'] },
      },
      leafSessionRefs: [{ nodeId: 'branch-b-node', sessionId: 'leaf-b' }],
    },
  },
  branchLedger: [
    { branchId: 'workflow-feat018:branch-a', memberKey: 'branch-a', status: 'merge-consumed', attempt: 1, outputRef: 'artifact://branch-a', consumedByMerge: true, leafSessionRef: { sessionId: 'leaf-a' } },
    { branchId: 'workflow-feat018:branch-b', memberKey: 'branch-b', status: 'timed-out', attempt: 2, lastError: 'leaf timed out', consumedByMerge: false, leafSessionRef: { sessionId: 'leaf-b' } },
    { branchId: 'workflow-feat018:branch-c', memberKey: 'branch-c', status: 'running', attempt: 1, consumedByMerge: false },
  ],
  stalledBranches: [
    { branchId: 'workflow-feat018:branch-b', memberKey: 'branch-b', status: 'timed-out', attempt: 2, lastError: 'leaf timed out', consumedByMerge: false, leafSessionRef: { sessionId: 'leaf-b' } },
  ],
  mergeEnvelope: { status: 'blocked', consumedBranches: ['workflow-feat018:branch-a'] },
  leafSessionRefs: [{ nodeId: 'branch-b-node', sessionId: 'leaf-b' }],
  rawContextRefs: [{ kind: 'input', ref: 'channel://cli/sessions/1' }],
  branchState: { merge: { status: 'blocked' } },
  checkpointTimeline: [],
  permissionBudget: { budgetExceeded: true },
};
workflowDetail.checkpointTimeline = [workflowDetail.latestCheckpoint!];
