import { Button } from '@/components/ui/Button';
import type { WorkflowCheckpointMetadata, WorkflowDebugDetail } from '@/types';

export function CheckpointDebugDrawer({
  checkpoint,
  workflow,
  open,
  onClose,
}: {
  checkpoint: WorkflowCheckpointMetadata | null;
  workflow: WorkflowDebugDetail;
  open: boolean;
  onClose?: () => void;
}) {
  if (!open || !checkpoint) return null;
  return (
    <aside className="rounded-xl border border-border bg-card p-4 shadow-lg" aria-label="Checkpoint debug drawer">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Debug drawer</p>
          <h3 className="mt-1 font-mono text-sm font-semibold">{checkpoint.checkpointId}</h3>
        </div>
        {onClose ? <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button> : null}
      </div>
      <DebugSection title="rawContextRefs" value={workflow.rawContextRefs} />
      <DebugSection title="branch ledger" value={workflow.branchLedger} />
      <DebugSection title="merge envelope" value={workflow.mergeEnvelope ?? workflow.mergeState} />
      <DebugSection title="leafSessionRefs" value={workflow.leafSessionRefs} />
      <DebugSection title="budget / permission summary" value={{ budgetState: workflow.budgetState, permissionState: workflow.permissionState, budgetPermissionSummary: workflow.budgetPermissionSummary }} />
      <DebugSection title="checkpoint metadata" value={checkpoint} />
    </aside>
  );
}

function DebugSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mt-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify(value ?? null, null, 2)}</pre>
    </section>
  );
}
