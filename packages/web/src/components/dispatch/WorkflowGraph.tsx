import type { BranchLedgerEntry, WorkflowDetail } from '@/stores/workflows';
import { cn } from '@/lib/utils';

interface WorkflowGraphProps {
  workflow: WorkflowDetail;
}

export function WorkflowGraph({ workflow }: WorkflowGraphProps) {
  const branches = workflow.branchLedger.length > 0 ? workflow.branchLedger : workflow.stalledBranches;
  return (
    <section aria-label="Fork-and-merge workflow graph" data-layout="fork-and-merge" className="space-y-4">
      <div className="flex items-center justify-between gap-4 text-center text-sm">
        <GraphNode title="Fork" subtitle={workflow.currentNodeId} tone="running" />
        <div className="h-px flex-1 bg-border" />
        <div className="grid min-w-0 flex-[2] gap-3 md:grid-cols-3">
          {branches.map((branch) => <BranchNode key={branch.branchId} branch={branch} />)}
        </div>
        <div className="h-px flex-1 bg-border" />
        <GraphNode title="Merge" subtitle={mergeStatus(workflow)} tone={workflow.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Fork-and-merge layout：branch 并行展开，merge 在所有 branch 下游汇聚；不展示 branch-to-branch chain。
      </p>
    </section>
  );
}

function BranchNode({ branch }: { branch: BranchLedgerEntry }) {
  return (
    <div
      title={branch.lastError ?? (branch.leafSessionRef ? JSON.stringify(branch.leafSessionRef) : branch.status)}
      className={cn(
        'rounded-lg border p-3 text-left shadow-sm',
        statusClass(branch.consumedByMerge ? 'merge-consumed' : branch.status),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs">{branch.memberKey}</p>
        <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] uppercase tracking-wide">{branch.status}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">attempt {branch.attempt}</p>
      {branch.lastError ? <p className="mt-2 text-xs text-destructive">{branch.lastError}</p> : null}
      {branch.consumedByMerge ? <p className="mt-2 text-xs text-emerald-700">merge-consumed</p> : null}
    </div>
  );
}

function GraphNode({ title, subtitle, tone }: { title: string; subtitle?: string; tone: string }) {
  return (
    <div className={cn('min-w-24 rounded-lg border p-3 shadow-sm', statusClass(tone))}>
      <p className="font-semibold">{title}</p>
      {subtitle ? <p className="mt-1 font-mono text-xs text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

function mergeStatus(workflow: WorkflowDetail) {
  if (workflow.mergeEnvelope && typeof workflow.mergeEnvelope === 'object' && 'status' in workflow.mergeEnvelope) {
    return String((workflow.mergeEnvelope as { status?: unknown }).status ?? workflow.status);
  }
  return workflow.status;
}

function statusClass(status: string) {
  switch (status) {
    case 'completed':
    case 'merged':
    case 'merge-consumed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-950';
    case 'running':
    case 'dispatched':
    case 'merge-ready':
      return 'border-sky-300 bg-sky-50 text-sky-950';
    case 'failed':
    case 'timed-out':
    case 'blocked':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    default:
      return 'border-border bg-card';
  }
}
