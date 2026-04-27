import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createWebLogger } from './logger.js';
import { authenticateWebSession, readAuthStatus, WEB_USER_ROLES } from './auth-store.js';
import type { ApiKeyAuthEnv, WebAuthContext, WebLogger, WebOperationClass, WebUserRole } from './types.js';
import type { WebRuntime } from './runtime.js';

export const UNAUTHENTICATED_DASHBOARD_WARNING =
  'Dashboard running in unauthenticated mode — set HARO_WEB_API_KEY to enable auth';

const ROLE_LEVEL: Record<WebUserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
};

const MINIMUM_ROLE_BY_OPERATION: Record<WebOperationClass, WebUserRole> = {
  'read-only': 'viewer',
  'local-write': 'operator',
  'config-write': 'admin',
  'token-reset': 'admin',
  'user-disable': 'admin',
  'owner-transfer': 'owner',
  'bootstrap-reset': 'owner',
};

let fallbackLogger: WebLogger | undefined;
const warnedLoggers = new WeakSet<WebLogger>();

function getFallbackLogger(): WebLogger {
  fallbackLogger ??= createWebLogger('cli.web.auth');
  return fallbackLogger;
}

function getRequestLogger(c: Context<ApiKeyAuthEnv>): WebLogger {
  return c.get('logger') ?? getFallbackLogger();
}

function warnUnauthenticatedMode(logger: WebLogger): void {
  if (warnedLoggers.has(logger)) return;
  logger.warn(UNAUTHENTICATED_DASHBOARD_WARNING);
  warnedLoggers.add(logger);
}

export function warnIfApiKeyAuthDisabled(logger: WebLogger): void {
  if (!process.env.HARO_WEB_API_KEY) {
    warnUnauthenticatedMode(logger);
  }
}

export function canPerform(role: WebUserRole, operationClass: WebOperationClass): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[MINIMUM_ROLE_BY_OPERATION[operationClass]];
}

export function readWebAuth(c: Context<ApiKeyAuthEnv>): WebAuthContext | undefined {
  return c.get('auth');
}

export function requireWebPermission(operationClass: WebOperationClass) {
  return createMiddleware<ApiKeyAuthEnv>(async (c, next) => {
    const auth = readWebAuth(c);
    if (!auth || !canPerform(auth.role, operationClass)) {
      return c.json({ error: 'Forbidden', operationClass, minimumRole: MINIMUM_ROLE_BY_OPERATION[operationClass] }, 403);
    }
    return next();
  });
}

export function createDashboardAuth(runtime: WebRuntime) {
  return createMiddleware<ApiKeyAuthEnv>(async (c, next) => {
    const configuredApiKey = process.env.HARO_WEB_API_KEY;
    const requestApiKey = c.req.header('x-api-key');
    const sessionToken = readSessionToken(c);

    if (configuredApiKey && requestApiKey === configuredApiKey) {
      c.set('auth', { kind: 'legacy-api-key', authenticated: true, role: 'owner' });
      return next();
    }

    if (sessionToken) {
      const auth = authenticateWebSession(runtime, sessionToken);
      if (auth) {
        c.set('auth', auth);
        return next();
      }
    }

    if (isPublicRequest(c.req.path, Boolean(configuredApiKey))) {
      if (!configuredApiKey) warnIfApiKeyAuthDisabled(getRequestLogger(c));
      return next();
    }

    if (!configuredApiKey) {
      const status = readAuthStatus(runtime);
      if (status.userCount === 0) {
        warnIfApiKeyAuthDisabled(getRequestLogger(c));
        c.set('auth', { kind: 'anonymous-legacy', authenticated: false, role: 'owner' });
        return next();
      }
    }

    return c.json({ error: 'Unauthorized' }, 401);
  });
}

export function availableRoles(): readonly WebUserRole[] {
  return WEB_USER_ROLES;
}

export function availablePermissions(role: WebUserRole): Record<WebOperationClass, boolean> {
  return {
    'read-only': canPerform(role, 'read-only'),
    'local-write': canPerform(role, 'local-write'),
    'config-write': canPerform(role, 'config-write'),
    'token-reset': canPerform(role, 'token-reset'),
    'user-disable': canPerform(role, 'user-disable'),
    'owner-transfer': canPerform(role, 'owner-transfer'),
    'bootstrap-reset': canPerform(role, 'bootstrap-reset'),
  };
}

function readSessionToken(c: Context<ApiKeyAuthEnv>): string | undefined {
  const authorization = c.req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const headerToken = c.req.header('x-haro-session-token')?.trim();
  return headerToken || undefined;
}

function isPublicRequest(path: string, legacyApiKeyEnabled: boolean): boolean {
  if (path === '/api/health') return true;
  if (path === '/api/v1/auth/status') return true;
  if (path === '/api/v1/auth/bootstrap') return true;
  if (path === '/api/v1/auth/login') return true;
  if (!path.startsWith('/api/') && !legacyApiKeyEnabled) return true;
  return false;
}
