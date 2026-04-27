import { Hono, type Context } from 'hono';
import { availablePermissions, availableRoles, readWebAuth } from '../auth.js';
import {
  bootstrapOwner,
  loginWithPassword,
  readAuthStatus,
  revokeSession,
  WebAuthError,
} from '../auth-store.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export function createAuthRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/status', (c) => c.json({ success: true, data: toStatusResponse(runtime) }));

  route.post('/bootstrap', async (c) => {
    const body = await readJsonObject(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const result = bootstrapOwner(runtime, {
        username: body.value.username,
        displayName: body.value.displayName,
        password: body.value.password,
      });
      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      return handleAuthError(c, error);
    }
  });

  route.post('/login', async (c) => {
    const body = await readJsonObject(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const result = loginWithPassword(runtime, {
        username: body.value.username,
        password: body.value.password,
      });
      return c.json({ success: true, data: result });
    } catch (error) {
      return handleAuthError(c, error);
    }
  });

  route.get('/me', (c) => {
    const auth = readWebAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({
      success: true,
      data: {
        kind: auth.kind,
        authenticated: auth.authenticated,
        role: auth.role,
        user: auth.kind === 'session' ? auth.user : null,
        permissions: availablePermissions(auth.role),
      },
    });
  });

  route.post('/logout', (c) => {
    const auth = readWebAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    revokeSession(runtime, auth);
    return c.json({ success: true, data: { loggedOut: true } });
  });

  return route;
}

function toStatusResponse(runtime: WebRuntime) {
  const status = readAuthStatus(runtime);
  return {
    ...status,
    roles: availableRoles(),
  };
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

function handleAuthError(c: Context<ApiKeyAuthEnv>, error: unknown) {
  if (error instanceof WebAuthError) return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}
