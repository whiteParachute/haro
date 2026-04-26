import { AlertTriangle, CheckCircle2, GitBranch, GitMerge, RadioTower } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isBranchStalled } from '@/stores/workflows';
import type { WorkflowBranchReadModel, WorkflowDebugDetail } from '@/types';

export function WorkflowGraph({ workflow }: { workflow: WorkflowDebugDetail }) {
  const branches = workflow.branchLedger.length > 0 ? workflow.branchLedger : workflow.stalledBranches;

  return (
    <section aria-label="Fork-and-merge workflow graph" data-layout="fork-and-merge" className="space-y-4">
      <div className="grid items-center gap-4 lg:grid-cols-[8rem_1fr_8rem]">
        <GraphNode title="Fork" subtitle={workflow.currentNodeId} icon="fork" tone="running" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => <BranchNode key={branch.branchId} branch={branch} />)}
        </div>
        <GraphNode title="Merge" subtitle={workflow.status} icon="merge" tone={workflow.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Fork-and-merge layout：branch 平行展开，merge 在所有 branch 下游汇聚；不展示 branch-to-branch chain。
      </p>
    </section>
  );
}

function BranchNode({ branch }: { branch: WorkflowBranchReadModel }) {
  const stalled = isBranchStalled(branch);
  return (
    <article
      title={branch.lastError ?? branch.leafSessionRef?.sessionId ?? branch.status}
      className={cn(
        'rounded-xl border p-3 shadow-sm transition-colors',
        stalled
          ? 'border-amber-400 bg-amber-50 text-amber-950 ring-2 ring-amber-200'
          : statusClass(branch.consumedByMerge ? 'merge-consumed' : branch.status),
      )}
      data-stalled={stalled ? 'true' : 'false'}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-semibold">{branch.memberKey}</p>
          <p className="mt-1 text-xs text-muted-foreground">{branch.branchId}</p>
        </div>
        {stalled ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 opacity-70" />}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-muted-foreground">status</dt><dd>{branch.status}</dd></div>
        <div><dt className="text-muted-foreground">attempt</dt><dd>{branch.attempt}</dd></div>
        <div className="col-span-2"><dt className="text-muted-foreground">leaf</dt><dd className="truncate font-mono">{branch.leafSessionRef?.sessionId ?? '—'}</dd></div>
      </dl>
      {branch.lastError ? <p className="mt-3 rounded-md bg-background/70 p-2 text-xs text-amber-800">{branch.lastError}</p> : null}
      {branch.consumedByMerge ? <p className="mt-2 text-xs text-emerald-700">merge-consumed</p> : null}
    </article>
  );
}

function GraphNode({ title, subtitle, icon, tone }: { title: string; subtitle?: string; icon: 'fork' | 'merge'; tone: string }) {
  const Icon = icon === 'fork' ? GitBranch : icon === 'merge' ? GitMerge : RadioTower;
  return (
    <div className={cn('rounded-xl border p-4 text-center shadow-sm', statusClass(tone))}>
      <Icon className="mx-auto h-5 w-5" />
      <p className="mt-2 font-semibold">{title}</p>
      {subtitle ? <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

function statusClass(status: string) {
  switch (status) {
    case 'completed':
    case 'merged':
    case 'merge-consumed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-950';
    case 'running':
    case 'merge-ready':
      return 'border-sky-300 bg-sky-50 text-sky-950';
    case 'failed':
    case 'timed-out':
    case 'blocked':
    case 'needs-human-intervention':
      return 'border-amber-400 bg-amber-50 text-amber-950';
    default:
      return 'border-border bg-card';
  }
}
