import { Hono } from 'hono';
import { HaroError, services } from '@haro/core';
import { canPerform, readWebAuth } from '../auth.js';
import { readPageQuery, readStringFilter } from '../lib/route-query.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createSessionsRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/', (c) => {
    const result = services.sessions.listSessions(ctx(), {
      ...(readStringFilter(c, 'status') ? { status: readStringFilter(c, 'status')! } : {}),
      ...(readStringFilter(c, 'agentId') ? { agentId: readStringFilter(c, 'agentId')! } : {}),
      ...(readStringFilter(c, 'createdFrom') ? { createdFrom: readStringFilter(c, 'createdFrom')! } : {}),
      ...(readStringFilter(c, 'createdTo') ? { createdTo: readStringFilter(c, 'createdTo')! } : {}),
      ...readPageQuery(c),
    });
    return c.json({ success: true, data: result });
  });

  route.get('/:id', (c) => {
    const detail = services.sessions.tryGetSession(ctx(), c.req.param('id'));
    if (!detail) return c.json({ error: 'Session not found' }, 404);
    return c.json({ success: true, data: detail });
  });

  route.get('/:id/events', (c) => {
    try {
      const result = services.sessions.listSessionEvents(ctx(), c.req.param('id'), {
        ...(c.req.query('limit') ? { limit: Number.parseInt(c.req.query('limit')!, 10) } : {}),
        ...(c.req.query('offset') ? { offset: Number.parseInt(c.req.query('offset')!, 10) } : {}),
      });
      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'SESSION_NOT_FOUND') {
        return c.json({ error: 'Session not found' }, 404);
      }
      throw error;
    }
  });

  route.delete('/:id', (c) => {
    const sessionId = c.req.param('id');
    const auth = readWebAuth(c);
    if (!auth || !canPerform(auth.role, 'local-write')) {
      // RBAC denial — caller never reached the DB, audit on a separate
      // connection is acceptable (no tx to roll back).
      services.sessions.writeSessionAuditOnFreshConnection(ctx(), {
        eventType: 'web.session.delete',
        sessionId,
        outcome: 'denied',
        reason: `requires operator role or higher; current role is ${auth?.role ?? 'anonymous'}`,
      });
      return c.json({ error: 'Forbidden', operationClass: 'local-write', minimumRole: 'operator' }, 403);
    }
    try {
      const result = services.sessions.deleteSession(ctx(), sessionId, { auditEventType: 'web.session.delete' });
      if (result.outcome === 'not-found') return c.json({ error: 'Session not found' }, 404);
      return c.json({ success: true, data: { deleted: true, sessionId } });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'SESSION_DELETE_FAILED') {
        services.sessions.writeSessionAuditOnFreshConnection(ctx(), {
          eventType: 'web.session.delete',
          sessionId,
          outcome: 'failure',
          reason: error.message,
        });
        return c.json({ error: 'Session delete failed', code: 'SESSION_DELETE_FAILED' }, 500);
      }
      throw error;
    }
  });

  return route;
}
