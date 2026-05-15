import { Hono } from 'hono';
import { requireWebPermission } from '../auth.js';
import type { WebRuntime } from '../runtime.js';
import type { ApiKeyAuthEnv } from '../types.js';

export function createDailyFrontierRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/status', requireWebPermission('read-only'), (c) => {
    const status = runtime.dailyFrontier?.getStatus() ?? {
      enabled: false,
      cron: '0 2 * * *',
      nextRunAt: null,
      running: false,
      sourceConfigPath: '',
      collectCommandConfigured: false,
      runDirectory: '',
    };
    return c.json({ success: true, data: status });
  });

  return route;
}
