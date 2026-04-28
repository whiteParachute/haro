import { Hono, type Context } from 'hono';
import { readWebAuth, requireWebPermission } from '../auth.js';
import {
  createUser,
  listAuditEvents,
  listUsers,
  resetUserPassword,
  updateUser,
  WebAuthError,
  type WebUserWithAudit,
} from '../auth-store.js';
import { buildPageInfo, parsePageQuery } from '../lib/pagination.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const USER_SORTS = ['createdAt', 'updatedAt', 'lastLoginAt', 'username', 'displayName', 'role', 'status'] as const;
type UserSortKey = typeof USER_SORTS[number];

export function createUsersRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', requireWebPermission('read-only'), (c) => {
    const page = parsePageQuery(c, {
      allowedSort: USER_SORTS,
      defaultSort: 'createdAt',
      defaultOrder: 'asc',
    });
    const users = sortUsers(filterUsers(listUsers(runtime), page.q), page.sort, page.order);
    const total = users.length;
    return c.json({
      success: true,
      data: {
        items: users.slice(page.offset, page.offset + page.pageSize),
        pageInfo: buildPageInfo({ page: page.page, pageSize: page.pageSize, total }),
        total,
        limit: page.pageSize,
        offset: page.offset,
      },
    });
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

function filterUsers(items: readonly WebUserWithAudit[], q: string): WebUserWithAudit[] {
  if (!q) return [...items];
  const needle = q.toLowerCase();
  return items.filter((item) => [
    item.id,
    item.username,
    item.displayName,
    item.role,
    item.status,
  ].some((value) => value.toLowerCase().includes(needle)));
}

function sortUsers(items: readonly WebUserWithAudit[], sort: UserSortKey, order: 'asc' | 'desc'): WebUserWithAudit[] {
  return [...items].sort((left, right) => {
    const direction = order === 'asc' ? 1 : -1;
    const primary = compareUser(left, right, sort) * direction;
    if (primary !== 0) return primary;
    return left.id.localeCompare(right.id) * direction;
  });
}

function compareUser(left: WebUserWithAudit, right: WebUserWithAudit, sort: UserSortKey): number {
  switch (sort) {
    case 'createdAt':
      return left.createdAt.localeCompare(right.createdAt);
    case 'updatedAt':
      return left.updatedAt.localeCompare(right.updatedAt);
    case 'lastLoginAt':
      return compareNullableString(left.lastLoginAt, right.lastLoginAt);
    case 'username':
      return left.username.localeCompare(right.username);
    case 'displayName':
      return left.displayName.localeCompare(right.displayName);
    case 'role':
      return left.role.localeCompare(right.role);
    case 'status':
      return left.status.localeCompare(right.status);
  }
}

function compareNullableString(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
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
