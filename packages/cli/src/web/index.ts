import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { apiKeyAuth, warnIfApiKeyAuthDisabled } from './auth.js';
import { createWebLogger } from './logger.js';
import type { ApiKeyAuthEnv, WebApp, WebLogger } from './types.js';

const VITE_DEV_ORIGIN = 'http://localhost:5173';
const ALLOWED_CORS_HEADERS = ['content-type', 'authorization', 'x-api-key'];

export interface CreateWebAppOptions {
  logger?: WebLogger;
  staticRoot?: string;
}

export function resolveWebDistRoot(cwd = process.cwd()): string {
  const absoluteWebDistRoot = resolve(__dirname, '../../..', 'web', 'dist');
  const relativeRoot = relative(cwd, absoluteWebDistRoot);
  return relativeRoot.length > 0 ? relativeRoot : '.';
}

function createRequestLogger(logger: WebLogger): MiddlewareHandler<ApiKeyAuthEnv> {
  return async (c, next) => {
    c.set('logger', logger);
    const start = Date.now();
    await next();
    logger.info({
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      durationMs: Date.now() - start,
    });
  };
}

function shouldServeSpaFallback(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  if (path === '/api' || path.startsWith('/api/')) return false;
  if (path.startsWith('/assets/')) return false;
  return extname(path) === '';
}

export function createWebApp(options: CreateWebAppOptions = {}): WebApp {
  const logger = options.logger ?? createWebLogger('cli.web');
  const staticRoot = options.staticRoot ?? resolveWebDistRoot();
  const app = new Hono<ApiKeyAuthEnv>();

  warnIfApiKeyAuthDisabled(logger);
  app.use('*', createRequestLogger(logger));
  app.use(
    '*',
    cors({
      origin: VITE_DEV_ORIGIN,
      allowHeaders: ALLOWED_CORS_HEADERS,
    }),
  );
  app.use('*', apiKeyAuth);
  app.use('*', compress());
  app.get('/api/health', (c) =>
    c.json({
      success: true,
      data: {
        service: 'haro-web',
        status: 'ok',
      },
    }),
  );
  app.use('/*', serveStatic({ root: staticRoot }));
  app.get('*', async (c, next) => {
    if (!shouldServeSpaFallback(c.req.method, c.req.path)) {
      return next();
    }

    const indexHtml = await readFile(resolve(staticRoot, 'index.html'), 'utf8');
    return c.html(indexHtml);
  });

  return app;
}
