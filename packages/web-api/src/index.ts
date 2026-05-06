import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { AgentRegistry, DEFAULT_AGENT_ID, cron as coreCron } from '@haro/core';
import { createDashboardAuth, warnIfApiKeyAuthDisabled } from './auth.js';
import { createWebLogger } from './logger.js';
import type { ApiKeyAuthEnv, WebApp, WebLogger } from './types.js';
import { createAgentsRoute } from './routes/agents.js';
import { createAuthRoute } from './routes/auth.js';
import { createChannelsRoute } from './routes/channels.js';
import { createConfigRoute } from './routes/config.js';
import { createCronRoute } from './routes/cron.js';
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

export { startWebServer, type WebServerHandle } from './server.js';
export type { WebRuntime, DiagnosticsRunner, DiagnosticsRunInput } from './runtime.js';
export type { WebApp, WebLogger, WebServerOptions, ApiKeyAuthEnv } from './types.js';

const VITE_DEV_ORIGIN = 'http://localhost:5173';
const ALLOWED_CORS_HEADERS = ['content-type', 'authorization', 'x-api-key', 'x-haro-session-token'];

export interface CreateWebAppOptions {
  logger?: WebLogger;
  staticRoot?: string;
  runtime?: Omit<WebRuntime, 'logger' | 'startedAt'> & Partial<Pick<WebRuntime, 'logger' | 'startedAt'>>;
  /**
   * Force-disable the in-process cron tick host (FEAT-033 R12). Defaults to
   * true when the runtime carries a runner + dbFile so a deployed web server
   * picks up jobs without an external `haro cron daemon`. Tests opt out by
   * passing `false`; HTTP route smoke tests don't need ticking.
   */
  enableCronTicker?: boolean;
}

interface CronTickerEntry {
  host: coreCron.CronTickHost;
  storage: coreCron.CronStorage;
}

const websocketManagers = new WeakMap<WebApp, WebSocketManager>();
const cronTickers = new WeakMap<WebApp, CronTickerEntry>();

export function getWebSocketManager(app: WebApp): WebSocketManager | undefined {
  return websocketManagers.get(app);
}

export function getCronTicker(app: WebApp): CronTickerEntry | undefined {
  return cronTickers.get(app);
}

export function resolveWebDistRoot(cwd = process.cwd()): string {
  // After build: __dirname is packages/web-api/dist/, packages/web/dist/ sits
  // two levels up. (Pre-FEAT-038 the file lived at packages/cli/src/web/ and
  // walked three levels; the new location only needs two.)
  const absoluteWebDistRoot = resolve(__dirname, '..', '..', 'web', 'dist');
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
    ...(options.runtime?.runDiagnostics ? { runDiagnostics: options.runtime.runDiagnostics } : {}),
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
      credentials: true,
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
  app.route('/api/v1/cron', createCronRoute(runtime));

  // FEAT-033 R12: in-process cron tick host. Auto-enabled when the runtime
  // exposes both a database file and an agent runner (or factory) — tests
  // that mock just `runtime.root` skip this, since they exercise routes
  // directly and shouldn't kick off a real timer.
  const enableCron =
    options.enableCronTicker ??
    Boolean(runtime.dbFile && (runtime.runner || runtime.createRunner));
  if (enableCron && runtime.dbFile) {
    const agentRunner = runtime.runner ?? runtime.createRunner?.();
    if (agentRunner) {
      const storage = new coreCron.CronStorage({
        dbFile: runtime.dbFile,
        ...(runtime.root ? { root: runtime.root } : {}),
      });
      const host = coreCron.createCronTickHost({
        storage,
        agentRunner,
        defaultAgentId: DEFAULT_AGENT_ID,
        logger: {
          debug: (...args) => logger.debug?.(args[0]),
          info: (...args) => logger.info?.(args[0]),
          warn: (...args) => logger.warn?.(args[0]),
          error: (...args) => logger.error?.(args[0]),
        },
        onTick: (outcome) => {
          if (outcome.skipped === 'lease-held') return;
          if (outcome.ranCount > 0) {
            logger.info?.({ ran: outcome.ranCount }, 'web-api cron tick dispatched jobs');
          }
        },
      });
      cronTickers.set(app, { host, storage });
    }
  }

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
