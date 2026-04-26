import { Hono } from 'hono';
import { CheckpointStore } from '@haro/core';
import type { WorkflowCheckpoint } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createWorkflowsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/:id/checkpoints', (c) => {
    const store = openStore(runtime);
    try {
      const checkpoints = store.loadAll(c.req.param('id'));
      return c.json({
        success: true,
        data: {
          workflowId: c.req.param('id'),
          items: checkpoints.map(toCheckpointMetadata),
          count: checkpoints.length,
        },
      });
    } finally {
      store.close();
    }
  });

  return route;
}

function openStore(runtime: WebRuntime): CheckpointStore {
  return new CheckpointStore({
    root: runtime.root,
    dbFile: runtime.dbFile,
  });
}

function toCheckpointMetadata(checkpoint: WorkflowCheckpoint) {
  return {
    checkpointId: checkpoint.id,
    workflowId: checkpoint.workflowId,
    nodeId: checkpoint.nodeId,
    status: readCheckpointStatus(checkpoint),
    createdAt: checkpoint.createdAt,
  };
}

function readCheckpointStatus(checkpoint: WorkflowCheckpoint): string | null {
  const branchState = checkpoint.state.branchState;
  if (typeof branchState.status === 'string') return branchState.status;
  if (typeof branchState.teamStatus === 'string') return branchState.teamStatus;
  return null;
}
