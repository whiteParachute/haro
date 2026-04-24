import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createWebLogger } from './logger.js';
import type { ApiKeyAuthEnv, WebLogger } from './types.js';

export const UNAUTHENTICATED_DASHBOARD_WARNING =
  'Dashboard running in unauthenticated mode — set HARO_WEB_API_KEY to enable auth';

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

export const apiKeyAuth = createMiddleware<ApiKeyAuthEnv>(async (c, next) => {
  const configuredApiKey = process.env.HARO_WEB_API_KEY;
  const requestApiKey = c.req.header('x-api-key');

  if (configuredApiKey && requestApiKey !== configuredApiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!configuredApiKey) {
    warnIfApiKeyAuthDisabled(getRequestLogger(c));
  }

  return next();
});
