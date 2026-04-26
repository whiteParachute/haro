import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckpointDebugDrawer } from '@/components/dispatch/CheckpointDebugDrawer';
import type { WorkflowCheckpointMetadata, WorkflowDebugDetail } from '@/types';

export function CheckpointTimeline({ workflow }: { workflow: WorkflowDebugDetail }) {
  const [selected, setSelected] = useState<WorkflowCheckpointMetadata | null>(workflow.checkpoints[0] ?? null);
  if (workflow.checkpoints.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">暂无 checkpoint。</p>;
  }
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {workflow.checkpoints.map((checkpoint) => (
          <li key={checkpoint.checkpointId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            <div>
              <p className="font-mono">{checkpoint.checkpointId}</p>
              <p className="text-xs text-muted-foreground">{checkpoint.nodeId} · {checkpoint.nodeType ?? 'unknown'} · {checkpoint.createdAt}</p>
              {checkpoint.parseError ? <p className="mt-1 text-xs text-destructive">{checkpoint.parseError}</p> : null}
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelected(checkpoint)}>查看详情</Button>
          </li>
        ))}
      </ol>
      <CheckpointDebugDrawer checkpoint={selected} workflow={workflow} open={Boolean(selected)} onClose={() => setSelected(null)} />
    </div>
  );
}
