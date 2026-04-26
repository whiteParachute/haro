import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionBudgetStore } from '@haro/core';
import { createWebApp, resolveWebDistRoot } from '../src/web/index.js';
import { UNAUTHENTICATED_DASHBOARD_WARNING } from '../src/web/auth.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function firstBuiltAsset(): string {
  const assetsDir = resolve(__dirname, '..', '..', 'web', 'dist', 'assets');
  const asset = readdirSync(assetsDir).find((entry) => entry.endsWith('.js') || entry.endsWith('.css'));
  if (!asset) throw new Error('packages/web/dist/assets must contain a built asset');
  return `/assets/${asset}`;
}

describe('web dashboard Hono app [FEAT-015]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('createWebApp() initializes without throwing and resolves packages/web/dist', () => {
    const logger = createMockLogger();

    expect(() => createWebApp({ logger })).not.toThrow();
    expect(existsSync(resolveWebDistRoot())).toBe(true);
  });

  it('serves built dashboard HTML and assets from packages/web/dist', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const htmlResponse = await app.request('/');
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<div id="root"></div>');

    const assetResponse = await app.request(firstBuiltAsset());
    expect(assetResponse.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(UNAUTHENTICATED_DASHBOARD_WARNING);
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        statusCode: 200,
      }),
    );
  });

  it('applies middleware order: request log, CORS, auth, then static serving', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const response = await app.request('/', {
      headers: {
        origin: 'http://localhost:5173',
      },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/',
        statusCode: 401,
      }),
    );
  });

  it('exposes a foundation health endpoint for Vite /api proxy checks', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const response = await app.request('/api/health', {
      headers: {
        origin: 'http://localhost:5173',
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(body).toEqual({
      success: true,
      data: {
        service: 'haro-web',
        status: 'ok',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/health',
        statusCode: 200,
      }),
    );
  });

  it('FEAT-023 exposes a read-only permission/budget summary API', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-guard-'));
    tempRoots.push(root);
    const store = new PermissionBudgetStore({ root, createId: () => 'ledger-web-1' });
    store.ensureWorkflowBudget({
      workflowId: 'workflow-web-guard',
      budgetId: 'budget:workflow-web-guard',
      limitTokens: 100,
      softLimitRatio: 0.8,
    });
    store.recordTokenUsage({
      workflowId: 'workflow-web-guard',
      budgetId: 'budget:workflow-web-guard',
      branchId: 'branch-web',
      agentId: 'agent-web',
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 10,
      outputTokens: 5,
    });
    store.close();
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { root },
    });

    const response = await app.request('/api/v1/guard/workflows/workflow-web-guard');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        workflowId: 'workflow-web-guard',
        budget: {
          budgetId: 'budget:workflow-web-guard',
          state: 'ok',
          usedTotalTokens: 15,
        },
        ledger: {
          totalTokens: 15,
        },
      },
    });
  });

  it('allows matching x-api-key when HARO_WEB_API_KEY is configured', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const response = await app.request('/', {
      headers: {
        'x-api-key': 'secret',
      },
    });

    expect(response.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid x-api-key when HARO_WEB_API_KEY is configured', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const missingKeyResponse = await app.request('/');
    const invalidKeyResponse = await app.request('/', {
      headers: {
        'x-api-key': 'wrong-secret',
      },
    });

    expect(missingKeyResponse.status).toBe(401);
    expect(await missingKeyResponse.json()).toEqual({ error: 'Unauthorized' });
    expect(invalidKeyResponse.status).toBe(401);
    expect(await invalidKeyResponse.json()).toEqual({ error: 'Unauthorized' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back BrowserRouter deep links to the dashboard HTML', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    for (const path of ['/chat', '/sessions', '/status']) {
      const response = await app.request(path);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('<div id="root"></div>');
    }
  });

  it('does not fallback /api routes or missing static assets to index.html', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const logger = createMockLogger();
    const app = createWebApp({ logger });

    const healthResponse = await app.request('/api/health');
    const missingApiResponse = await app.request('/api/missing');
    const missingAssetResponse = await app.request('/assets/missing-dashboard.js');

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get('content-type')).toContain('application/json');
    expect(missingApiResponse.status).toBe(404);
    expect(missingAssetResponse.status).toBe(404);
  });
});
