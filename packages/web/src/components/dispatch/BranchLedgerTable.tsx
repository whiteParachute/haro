import { cn } from '@/lib/utils';
import { isBranchStalled } from '@/stores/workflows';
import type { WorkflowBranchReadModel } from '@/types';

export function BranchLedgerTable({ branches }: { branches: WorkflowBranchReadModel[] }) {
  if (branches.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">暂无 branch ledger。</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="p-3">branchId</th>
            <th>memberKey</th>
            <th>status</th>
            <th>attempt</th>
            <th>lastEventAt</th>
            <th>leafSessionRef</th>
            <th>outputRef</th>
            <th>consumed</th>
            <th>lastError</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => {
            const stalled = isBranchStalled(branch);
            return (
              <tr
                key={branch.branchId}
                className={cn('border-t border-border align-top', stalled ? 'bg-amber-50 text-amber-950' : undefined)}
                data-stalled={stalled ? 'true' : 'false'}
              >
                <td className="p-3 font-mono">{branch.branchId}</td>
                <td>{branch.memberKey}</td>
                <td>{branch.status}</td>
                <td>{branch.attempt}</td>
                <td>{branch.lastEventAt ?? branch.startedAt ?? '—'}</td>
                <td><code>{branch.leafSessionRef?.sessionId ?? '—'}</code></td>
                <td><code>{branch.outputRef ?? '—'}</code></td>
                <td>{branch.consumedByMerge ? 'yes' : 'no'}</td>
                <td className={stalled ? 'font-medium text-amber-800' : 'text-muted-foreground'}>{branch.lastError ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
