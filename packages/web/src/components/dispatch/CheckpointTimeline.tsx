import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckpointDebugDrawer } from '@/components/dispatch/CheckpointDebugDrawer';
import type { WorkflowCheckpointDebug, WorkflowDetail } from '@/stores/workflows';

export function CheckpointTimeline({ workflow }: { workflow: WorkflowDetail }) {
  const [selected, setSelected] = useState<WorkflowCheckpointDebug | null>(workflow.latestCheckpoint ?? workflow.checkpointTimeline[0] ?? null);
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {workflow.checkpointTimeline.map((checkpoint) => (
          <li key={checkpoint.checkpointId} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
            <div>
              <p className="font-mono">{checkpoint.checkpointId}</p>
              <p className="text-xs text-muted-foreground">{checkpoint.nodeId} · {checkpoint.nodeType ?? 'unknown'} · {checkpoint.createdAt}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelected(checkpoint)}>查看 JSON</Button>
          </li>
        ))}
      </ol>
      <CheckpointDebugDrawer checkpoint={selected} workflow={workflow} open={Boolean(selected)} onClose={() => setSelected(null)} />
    </div>
  );
}
