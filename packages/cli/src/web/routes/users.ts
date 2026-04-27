import { Hono, type Context } from 'hono';
import { readWebAuth, requireWebPermission } from '../auth.js';
import {
  createUser,
  listAuditEvents,
  listUsers,
  resetUserPassword,
  updateUser,
  WebAuthError,
} from '../auth-store.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createUsersRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', requireWebPermission('read-only'), (c) => {
    const users = listUsers(runtime);
    return c.json({ success: true, data: { items: users, total: users.length } });
  });

  route.get('/audit-events', requireWebPermission('read-only'), (c) => {
    const limit = readLimit(c.req.query('limit'));
    const targetId = c.req.query('targetId');
    const items = listAuditEvents(runtime, { limit, ...(targetId ? { targetId } : {}) });
    return c.json({ success: true, data: { items, total: items.length, limit } });
  });

  route.post('/', requireWebPermission('config-write'), async (c) => {
    const auth = readWebAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    const body = await readJsonObject(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const user = createUser(runtime, {
        username: body.value.username,
        displayName: body.value.displayName,
        password: body.value.password,
        role: body.value.role,
        status: body.value.status,
      }, auth);
      return c.json({ success: true, data: user }, 201);
    } catch (error) {
      return handleAuthError(c, error);
    }
  });

  route.patch('/:id', requireWebPermission('config-write'), async (c) => {
    const auth = readWebAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    const body = await readJsonObject(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const user = updateUser(runtime, c.req.param('id'), {
        displayName: body.value.displayName,
        role: body.value.role,
        status: body.value.status,
      }, auth);
      return c.json({ success: true, data: user });
    } catch (error) {
      return handleAuthError(c, error);
    }
  });

  route.post('/:id/password', requireWebPermission('token-reset'), async (c) => {
    const auth = readWebAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    const body = await readJsonObject(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const user = resetUserPassword(runtime, c.req.param('id'), body.value.password, auth);
      return c.json({ success: true, data: user });
    } catch (error) {
      return handleAuthError(c, error);
    }
  });

  return route;
}

async function readJsonObject(read: () => Promise<unknown>): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  let value: unknown;
  try {
    value = await read();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function readLimit(value: string | undefined): number {
  if (!value) return 50;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, parsed));
}

function handleAuthError(c: Context<ApiKeyAuthEnv>, error: unknown) {
  if (error instanceof WebAuthError) return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}
