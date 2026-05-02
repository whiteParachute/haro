import { Hono } from 'hono';
import { services } from '@haro/core';
import { readPageQuery, readStringFilter } from '../lib/route-query.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createLogsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/session-events', (c) => {
    const result = services.logs.listSessionEventLogs(ctx(), {
      ...(readStringFilter(c, 'sessionId') ? { sessionId: readStringFilter(c, 'sessionId')! } : {}),
      ...(readStringFilter(c, 'agentId') ? { agentId: readStringFilter(c, 'agentId')! } : {}),
      ...(readStringFilter(c, 'eventType') ? { eventType: readStringFilter(c, 'eventType')! } : {}),
      ...(readStringFilter(c, 'from') ? { from: readStringFilter(c, 'from')! } : {}),
      ...(readStringFilter(c, 'to') ? { to: readStringFilter(c, 'to')! } : {}),
      ...readPageQuery(c),
    });
    return c.json({ success: true, data: result });
  });

  route.get('/provider-fallbacks', (c) => {
    const result = services.logs.listProviderFallbacks(ctx(), {
      ...(readStringFilter(c, 'sessionId') ? { sessionId: readStringFilter(c, 'sessionId')! } : {}),
      ...(readStringFilter(c, 'from') ? { from: readStringFilter(c, 'from')! } : {}),
      ...(readStringFilter(c, 'to') ? { to: readStringFilter(c, 'to')! } : {}),
      ...readPageQuery(c),
    });
    return c.json({ success: true, data: result });
  });

  return route;
}
