import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BranchLedgerTable } from '@/components/dispatch/BranchLedgerTable';
import { CheckpointTimeline } from '@/components/dispatch/CheckpointTimeline';
import { WorkflowGraph } from '@/components/dispatch/WorkflowGraph';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useWorkflowStore } from '@/stores/workflows';

export function DispatchPage() {
  const { items, total, selectedWorkflowId, detail, loading, error, loadWorkflows, selectWorkflow } = useWorkflowStore();

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!detail && items[0] && selectedWorkflowId !== items[0].workflowId) {
      void selectWorkflow(items[0].workflowId);
    }
  }, [detail, items, selectWorkflow, selectedWorkflowId]);

  return (
    <DispatchPageView
      items={items}
      total={total}
      detail={detail}
      loading={loading}
      error={error}
      loadWorkflows={loadWorkflows}
      selectWorkflow={selectWorkflow}
    />
  );
}

export function DispatchPageView({
  items,
  total,
  detail,
  loading,
  error,
  loadWorkflows,
  selectWorkflow,
}: {
  items: ReturnType<typeof useWorkflowStore.getState>['items'];
  total: number;
  detail: ReturnType<typeof useWorkflowStore.getState>['detail'];
  loading: boolean;
  error: string | null;
  loadWorkflows: () => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Orchestration Debugger</CardTitle>
          <CardDescription>只读查看 Team workflow 的 fork-and-merge 拓扑、checkpoint、branch ledger 与预算/权限阻断原因。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" onClick={() => void loadWorkflows()}>刷新</Button>
          <span className="text-muted-foreground">total {total}</span>
          {loading ? <span className="text-muted-foreground">加载中…</span> : null}
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Workflows</CardTitle>
            <CardDescription>summary read model</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.length === 0 ? <p className="text-sm text-muted-foreground">暂无 workflow checkpoint 数据。</p> : null}
            {items.map((workflow) => (
              <button
                key={workflow.workflowId}
                type="button"
                onClick={() => void selectWorkflow(workflow.workflowId)}
                className="w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{workflow.workflowId}</span>
                  <span>{workflow.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{workflow.executionMode} / {workflow.orchestrationMode ?? 'n/a'} / {workflow.templateId}</p>
                {workflow.blockedReason ? <HumanIntervention reason={workflow.blockedReason} compact /> : null}
              </button>
            ))}
          </CardContent>
        </Card>

        {detail ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{detail.workflowId}</CardTitle>
                <CardDescription>{detail.executionMode} / {detail.orchestrationMode ?? 'n/a'} / {detail.templateId}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {detail.blockedReason ? <HumanIntervention reason={detail.blockedReason} /> : null}
                <WorkflowGraph workflow={detail} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Branch Ledger</CardTitle>
                <CardDescription>stalled branch、leafSessionRef、outputRef、lastError 与 merge consumption 状态。</CardDescription>
              </CardHeader>
              <CardContent>
                <BranchLedgerTable branches={detail.branchLedger} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Merge Envelope</CardTitle>
                <CardDescription>只读 merge 输出与 consumedBranches。</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify(detail.mergeEnvelope ?? null, null, 2)}</pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Checkpoint Timeline</CardTitle>
                <CardDescription>点击 checkpoint 打开只读 debug drawer，展示完整结构化 JSON。</CardDescription>
              </CardHeader>
              <CardContent>
                <CheckpointTimeline workflow={detail} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">请选择一个 workflow。</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function HumanIntervention({ reason, compact = false }: { reason: string; compact?: boolean }) {
  return (
    <div className={compact ? 'mt-2 flex items-center gap-1 text-xs text-amber-700' : 'flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">需要人类介入</p>
        <p>阻断原因：{reason}。本页面仅提供详情入口，不提供 approve / continue / stop 写操作。</p>
      </div>
    </div>
  );
}
