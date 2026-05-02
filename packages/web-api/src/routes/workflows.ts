import { Hono } from 'hono';
import { HaroError, services } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createWorkflowsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/', (c) => {
    const result = services.workflows.listWorkflows(ctx(), {
      ...(c.req.query('limit') ? { limit: Number.parseInt(c.req.query('limit')!, 10) } : {}),
    });
    return c.json({ success: true, data: result });
  });

  route.get('/:id/checkpoints', (c) => {
    const workflowId = c.req.param('id');
    const checkpointId = c.req.query('checkpointId');
    try {
      if (checkpointId) {
        const detail = services.workflows.getWorkflowCheckpoint(ctx(), workflowId, checkpointId);
        return c.json({ success: true, data: detail });
      }
      const data = services.workflows.listWorkflowCheckpoints(ctx(), workflowId);
      return c.json({ success: true, data });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'WORKFLOW_CHECKPOINT_NOT_FOUND') {
        return c.json({ success: false, message: error.message }, 404);
      }
      throw error;
    }
  });

  route.get('/:id', (c) => {
    try {
      const detail = services.workflows.getWorkflow(ctx(), c.req.param('id'));
      return c.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'WORKFLOW_NOT_FOUND') {
        return c.json({ success: false, message: error.message }, 404);
      }
      throw error;
    }
  });

  return route;
}
