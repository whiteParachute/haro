import { Button } from '@/components/ui/Button';
import type { WorkflowCheckpointDebug, WorkflowDetail } from '@/stores/workflows';

interface CheckpointDebugDrawerProps {
  checkpoint: WorkflowCheckpointDebug | null;
  workflow?: WorkflowDetail | null;
  open: boolean;
  onClose?: () => void;
}

export function CheckpointDebugDrawer({ checkpoint, workflow, open, onClose }: CheckpointDebugDrawerProps) {
  if (!open || !checkpoint) return null;
  const state = checkpoint.state;
  const branchState = asRecord(state.branchState);
  return (
    <aside className="rounded-xl border border-border bg-card p-4 shadow-lg" aria-label="Checkpoint debug drawer">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Debug drawer</p>
          <h3 className="mt-1 font-mono text-sm font-semibold">{checkpoint.checkpointId}</h3>
        </div>
        {onClose ? <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button> : null}
      </div>
      <DebugSection title="rawContextRefs" value={state.rawContextRefs} />
      <DebugSection title="sceneDescriptor / routingDecision" value={{ sceneDescriptor: state.sceneDescriptor, routingDecision: state.routingDecision }} />
      <DebugSection title="branchState.branches" value={asRecord(branchState.branches)} />
      <DebugSection title="branchState.merge" value={asRecord(branchState.merge)} />
      <DebugSection title="leafSessionRefs" value={state.leafSessionRefs} />
      <DebugSection title="budgetState / permissionState" value={{ budgetState: workflow?.budgetState, permissionState: workflow?.permissionState, permissionBudget: workflow?.permissionBudget }} />
      <DebugSection title="complete checkpoint JSON" value={checkpoint} />
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
