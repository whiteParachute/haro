import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkflow, listWorkflows } from '../src/api/client';
import { BranchLedgerTable } from '../src/components/dispatch/BranchLedgerTable';
import { CheckpointDebugDrawer } from '../src/components/dispatch/CheckpointDebugDrawer';
import { WorkflowGraph } from '../src/components/dispatch/WorkflowGraph';
import { DispatchPageView } from '../src/pages/DispatchPage';
import { isBranchStalled, useWorkflowsStore } from '../src/stores/workflows';
import type { WorkflowDebugDetail } from '../src/types';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('FEAT-018 Dispatch orchestration debugger UI', () => {
  beforeEach(() => {
    useWorkflowsStore.setState({ items: [], selectedWorkflowId: null, detail: null, loading: false, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls only the workflow REST contract for list and detail helpers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/workflows?limit=10')) return jsonResponse({ success: true, data: { items: [summaryFixture], limit: 10 } });
      if (url.endsWith('/api/v1/workflows/workflow-debug')) return jsonResponse({ success: true, data: detailFixture });
      return jsonResponse({ error: 'unexpected' }, { status: 404 });
    }));

    await listWorkflows({ limit: 10 });
    await getWorkflow('workflow-debug');

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/workflows?limit=10',
      '/api/v1/workflows/workflow-debug',
    ]);
  });

  it('renders a usable backend debugger page, not a landing placeholder or write-control surface', () => {
    const html = renderToString(
      <DispatchPageView
        items={[summaryFixture]}
        selectedWorkflowId="workflow-debug"
        detail={detailFixture}
        loading={false}
        error={null}
        loadWorkflows={async () => undefined}
        selectWorkflow={async () => undefined}
      />,
    );

    expect(html).toContain('Orchestration Debugger');
    expect(html).toContain('Branch Ledger');
    expect(html).toContain('Checkpoint Timeline');
    expect(html).toContain('需要人类介入');
    expect(html).toContain('workflow-debug');
    expect(html).not.toContain('hero');
    expect(html).not.toContain('approve');
    expect(html).not.toContain('continue');
    expect(html).not.toContain('stop 写操作按钮');
  });

  it('renders fork-and-merge graph and highlights stalled branches', () => {
    const graphHtml = renderToString(<WorkflowGraph workflow={detailFixture} />);
    const tableHtml = renderToString(<BranchLedgerTable branches={detailFixture.branchLedger} />);

    expect(graphHtml).toContain('data-layout="fork-and-merge"');
    expect(graphHtml).toContain('Fork');
    expect(graphHtml).toContain('Merge');
    expect(graphHtml).toContain('data-stalled="true"');
    expect(graphHtml).toContain('tool timed out');
    expect(tableHtml).toContain('data-stalled="true"');
    expect(isBranchStalled(detailFixture.branchLedger[0]!)).toBe(true);
  });

  it('debug drawer separates raw refs, branch ledger, merge envelope, and guard summary', () => {
    const html = renderToString(
      <CheckpointDebugDrawer
        checkpoint={detailFixture.checkpoints[0]!}
        workflow={detailFixture}
        open
      />,
    );

    expect(html).toContain('rawContextRefs');
    expect(html).toContain('branch ledger');
    expect(html).toContain('merge envelope');
    expect(html).toContain('leafSessionRefs');
    expect(html).toContain('budget / permission summary');
    expect(html).toContain('checkpoint metadata');
  });
});

const summaryFixture = {
  workflowId: 'workflow-debug',
  status: 'needs-human-intervention' as const,
  executionMode: 'team',
  orchestrationMode: 'parallel',
  templateId: 'parallel-research',
  workflowTemplateId: 'parallel-research',
  currentNodeId: 'parallel-branch-1',
  latestCheckpointRef: 'checkpoint-stalled',
  createdAt: '2026-04-26T06:00:00.000Z',
  updatedAt: '2026-04-26T06:05:00.000Z',
  blockedReason: 'budget' as const,
  budgetState: { budgetId: 'budget:workflow-debug', usedTokens: 12, limitTokens: 20, state: 'near-limit' as const },
  permissionState: { requiredClass: 'network', state: 'needs-approval' as const },
  stalledBranches: [],
};

const detailFixture: WorkflowDebugDetail = {
  ...summaryFixture,
  stalledBranches: [
    {
      branchId: 'branch-a',
      memberKey: 'local-code-source',
      status: 'failed',
      attempt: 2,
      nodeId: 'parallel-branch-1',
      startedAt: '2026-04-26T06:00:00.000Z',
      lastEventAt: '2026-04-26T06:05:00.000Z',
      lastError: 'tool timed out',
      leafSessionRef: { nodeId: 'parallel-branch-1', sessionId: 'leaf-session-a', continuationRef: 'cont-a' },
      outputRef: 'workflow://workflow-debug/branches/branch-a/output',
      consumedByMerge: false,
      branchRole: 'candidate',
    },
  ],
  branchLedger: [
    {
      branchId: 'branch-a',
      memberKey: 'local-code-source',
      status: 'failed',
      attempt: 2,
      nodeId: 'parallel-branch-1',
      startedAt: '2026-04-26T06:00:00.000Z',
      lastEventAt: '2026-04-26T06:05:00.000Z',
      lastError: 'tool timed out',
      leafSessionRef: { nodeId: 'parallel-branch-1', sessionId: 'leaf-session-a', continuationRef: 'cont-a' },
      outputRef: 'workflow://workflow-debug/branches/branch-a/output',
      consumedByMerge: false,
      branchRole: 'candidate',
    },
    {
      branchId: 'branch-b',
      memberKey: 'docs-source',
      status: 'completed',
      attempt: 1,
      leafSessionRef: { nodeId: 'parallel-branch-2', sessionId: 'leaf-session-b' },
      outputRef: 'workflow://workflow-debug/branches/branch-b/output',
      consumedByMerge: true,
    },
  ],
  mergeEnvelope: {
    workflowId: 'workflow-debug',
    mergeNodeId: 'merge-1',
    orchestrationMode: 'parallel',
    status: 'blocked',
    consumedBranches: ['branch-b'],
  },
  mergeState: { status: 'blocked', consumedBranches: ['branch-b'] },
  leafSessionRefs: [
    { nodeId: 'parallel-branch-1', sessionId: 'leaf-session-a', continuationRef: 'cont-a' },
    { nodeId: 'parallel-branch-2', sessionId: 'leaf-session-b' },
  ],
  rawContextRefs: [
    { kind: 'input', ref: 'workflow://workflow-debug/input' },
    { kind: 'artifact', ref: 'artifact://workflow-debug/source' },
  ],
  recentCheckpointRef: 'checkpoint-stalled',
  checkpoints: [
    { checkpointId: 'checkpoint-stalled', nodeId: 'parallel-branch-1', nodeType: 'agent', createdAt: '2026-04-26T06:05:00.000Z' },
  ],
  budgetPermissionSummary: {
    budget: summaryFixture.budgetState,
    permissions: { needsApproval: 1, denied: 0 },
  },
};
