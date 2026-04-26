import type { BranchLedgerEntry } from '@/stores/workflows';

export function BranchLedgerTable({ branches }: { branches: BranchLedgerEntry[] }) {
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
          {branches.map((branch) => (
            <tr key={branch.branchId} className="border-t border-border align-top">
              <td className="p-3 font-mono">{branch.branchId}</td>
              <td>{branch.memberKey}</td>
              <td>{branch.status}</td>
              <td>{branch.attempt}</td>
              <td>{branch.lastEventAt ?? branch.startedAt ?? '—'}</td>
              <td><code>{formatRef(branch.leafSessionRef)}</code></td>
              <td><code>{branch.outputRef ?? '—'}</code></td>
              <td>{branch.consumedByMerge ? 'yes' : 'no'}</td>
              <td className="text-destructive">{branch.lastError ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatRef(value: unknown) {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
