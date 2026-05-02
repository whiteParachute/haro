import { Hono } from 'hono';
import { PermissionBudgetStore } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createGuardRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/workflows', (c) => {
    const store = openStore(runtime);
    try {
      const limit = clampNumber(c.req.query('limit'), 1, 100, 20);
      return c.json({
        success: true,
        data: {
          items: store.listWorkflowPermissionBudgetSummaries(limit),
          limit,
        },
      });
    } finally {
      store.close();
    }
  });

  route.get('/workflows/:workflowId', (c) => {
    const store = openStore(runtime);
    try {
      return c.json({
        success: true,
        data: store.readWorkflowPermissionBudgetSummary(c.req.param('workflowId')),
      });
    } finally {
      store.close();
    }
  });

  return route;
}

function openStore(runtime: WebRuntime): PermissionBudgetStore {
  return new PermissionBudgetStore({
    root: runtime.root,
    dbFile: runtime.dbFile,
  });
}

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
