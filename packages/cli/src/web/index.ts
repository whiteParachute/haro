import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { AgentRegistry } from '@haro/core';
import { createDashboardAuth, warnIfApiKeyAuthDisabled } from './auth.js';
import { createWebLogger } from './logger.js';
import type { ApiKeyAuthEnv, WebApp, WebLogger } from './types.js';
import { createAgentsRoute } from './routes/agents.js';
import { createAuthRoute } from './routes/auth.js';
import { createChannelsRoute } from './routes/channels.js';
import { createConfigRoute } from './routes/config.js';
import { createDoctorRoute, createStatusRoute } from './routes/status.js';
import { createGatewayRoute } from './routes/gateway.js';
import { createGuardRoute } from './routes/guard.js';
import { createLogsRoute } from './routes/logs.js';
import { createMemoryRoute } from './routes/memory.js';
import { createProvidersRoute } from './routes/providers.js';
import { createSkillsRoute } from './routes/skills.js';
import { createWorkflowsRoute } from './routes/workflows.js';
import { createUsersRoute } from './routes/users.js';
import { createSessionsRoute } from './routes/sessions.js';
import type { WebRuntime } from './runtime.js';
import { WebSocketManager } from './websocket/manager.js';

const VITE_DEV_ORIGIN = 'http://localhost:5173';
const ALLOWED_CORS_HEADERS = ['content-type', 'authorization', 'x-api-key', 'x-haro-session-token'];

export interface CreateWebAppOptions {
  logger?: WebLogger;
  staticRoot?: string;
  runtime?: Omit<WebRuntime, 'logger' | 'startedAt'> & Partial<Pick<WebRuntime, 'logger' | 'startedAt'>>;
}

const websocketManagers = new WeakMap<WebApp, WebSocketManager>();

export function getWebSocketManager(app: WebApp): WebSocketManager | undefined {
  return websocketManagers.get(app);
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
  const runtime: WebRuntime = {
    agentRegistry: options.runtime?.agentRegistry ?? new AgentRegistry(),
    ...(options.runtime?.reloadAgentRegistry ? { reloadAgentRegistry: options.runtime.reloadAgentRegistry } : {}),
    ...(options.runtime?.runner ? { runner: options.runtime.runner } : {}),
    ...(options.runtime?.createRunner ? { createRunner: options.runtime.createRunner } : {}),
    ...(options.runtime?.root ? { root: options.runtime.root } : {}),
    ...(options.runtime?.projectRoot ? { projectRoot: options.runtime.projectRoot } : {}),
    ...(options.runtime?.dbFile ? { dbFile: options.runtime.dbFile } : {}),
    ...(options.runtime?.providerRegistry ? { providerRegistry: options.runtime.providerRegistry } : {}),
    ...(options.runtime?.channelRegistry ? { channelRegistry: options.runtime.channelRegistry } : {}),
    ...(options.runtime?.skillsManager ? { skillsManager: options.runtime.skillsManager } : {}),
    ...(options.runtime?.evolutionAssetRegistry !== undefined ? { evolutionAssetRegistry: options.runtime.evolutionAssetRegistry } : {}),
    ...(options.runtime?.skillAssetAuditSupported !== undefined ? { skillAssetAuditSupported: options.runtime.skillAssetAuditSupported } : {}),
    ...(options.runtime?.loaded ? { loaded: options.runtime.loaded } : {}),
    logger,
    startedAt: options.runtime?.startedAt ?? Date.now(),
  };
  const websocketManager = new WebSocketManager(runtime);
  websocketManagers.set(app, websocketManager);

  warnIfApiKeyAuthDisabled(logger);
  app.use('*', createRequestLogger(logger));
  app.use(
    '*',
    cors({
      origin: VITE_DEV_ORIGIN,
      allowHeaders: ALLOWED_CORS_HEADERS,
    }),
  );
  app.use('*', createDashboardAuth(runtime));
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
  app.route('/api/v1/auth', createAuthRoute(runtime));
  app.route('/api/v1/agents', createAgentsRoute(runtime, websocketManager));
  app.route('/api/v1/channels', createChannelsRoute(runtime));
  app.route('/api/v1/gateway', createGatewayRoute(runtime));
  app.route('/api/v1/guard', createGuardRoute(runtime));
  app.route('/api/v1/workflows', createWorkflowsRoute(runtime));
  app.route('/api/v1/logs', createLogsRoute(runtime));
  app.route('/api/v1/providers', createProvidersRoute(runtime));
  app.route('/api/v1/sessions', createSessionsRoute(runtime));
  app.route('/api/v1/memory', createMemoryRoute(runtime));
  app.route('/api/v1/skills', createSkillsRoute(runtime));
  app.route('/api/v1/users', createUsersRoute(runtime));
  app.route('/api/v1/status', createStatusRoute(runtime));
  app.route('/api/v1/doctor', createDoctorRoute(runtime));
  app.route('/api/v1/config', createConfigRoute(runtime));
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
