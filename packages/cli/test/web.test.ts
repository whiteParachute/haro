import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
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
});
