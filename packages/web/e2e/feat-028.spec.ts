import { expect, test, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const port = 3457;
const baseURL = `http://127.0.0.1:${port}`;
const screenshots = {
  bootstrap: '/tmp/haro-feat-028-01-bootstrap.png',
  loginError: '/tmp/haro-feat-028-02-login-error.png',
  loginSuccess: '/tmp/haro-feat-028-03-login-success.png',
  viewerReadonly: '/tmp/haro-feat-028-04-viewer-readonly.png',
  pagination: '/tmp/haro-feat-028-05-pagination.png',
  zh: '/tmp/haro-feat-028-06-zh-cn.png',
  en: '/tmp/haro-feat-028-07-en-us.png',
};

let haroHome: string;
let server: ChildProcess | undefined;
const owner = { username: 'owner', password: 'owner-password' };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  haroHome = mkdtempSync(join(tmpdir(), 'haro-feat-028-e2e-'));
  server = spawn('node', ['packages/cli/bin/haro.js', 'web', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: repoRoot,
    env: { ...process.env, HARO_HOME: haroHome, HARO_LOG_ROLLING: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk) => process.stdout.write(`[haro-web] ${chunk}`));
  server.stderr?.on('data', (chunk) => process.stderr.write(`[haro-web] ${chunk}`));
  await waitForHealth();
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (server && !server.killed) server.kill('SIGKILL');
  if (haroHome) rmSync(haroHome, { recursive: true, force: true });
});

test('owner-bootstrap', async ({ page }) => {
  await page.goto(baseURL);
  await expect(page).toHaveURL(/\/bootstrap$/);
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('显示名称').fill('Owner User');
  await page.getByLabel('密码', { exact: true }).fill(owner.password);
  await page.getByLabel('确认密码').fill(owner.password);
  await page.getByRole('button', { name: /创建 owner 并登录/ }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.screenshot({ path: screenshots.bootstrap, fullPage: true });
});

test('login-logout', async ({ page }) => {
  await ensureLoggedIn(page);
  await page.getByRole('button', { name: /登出/ }).click();
  await page.goto(baseURL);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill('wrong-password');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert')).toContainText('登录失败');
  await page.screenshot({ path: screenshots.loginError, fullPage: true });
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.screenshot({ path: screenshots.loginSuccess, fullPage: true });
});

test('viewer-readonly', async ({ browser, page }) => {
  await ensureLoggedIn(page);
  await createViewer(page);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await viewer.goto(`${baseURL}/login`);
    await viewer.getByLabel('用户名').fill('viewer');
    await viewer.getByLabel('密码').fill('viewer-password');
    await viewer.getByRole('button', { name: '登录' }).click();
    await expect(viewer).toHaveURL(/\/chat$/);
    await viewer.goto(`${baseURL}/sessions`);
    await expect(viewer.getByText('会话列表')).toBeVisible();
    await expect(viewer.getByRole('button', { name: '删除' })).toHaveCount(0);
    const status = await viewer.evaluate(async () => {
      const response = await fetch('/api/v1/sessions/no-such-session', { method: 'DELETE' });
      return response.status;
    });
    expect(status).toBe(403);
    await viewer.screenshot({ path: screenshots.viewerReadonly, fullPage: true });
  } finally {
    await viewerContext.close();
  }
});

test('pagination', async ({ page }) => {
  await ensureLoggedIn(page);
  seedSessions(30);
  await page.goto(`${baseURL}/sessions`);
  await expect(page.getByText('会话列表')).toBeVisible();
  await page.getByLabel('下一页').click();
  await expect(page).toHaveURL(/page=2/);
  await page.locator('select').first().selectOption('10');
  await expect(page).toHaveURL(/pageSize=10/);
  await page.getByRole('button', { name: /创建时间/ }).click();
  await expect(page).toHaveURL(/sort=createdAt/);
  await page.screenshot({ path: screenshots.pagination, fullPage: true });
});

test('zh-CN', async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto(`${baseURL}/sessions`);
  await expect(page.getByText('会话列表')).toBeVisible();
  await expect(page.getByPlaceholder('搜索关键字')).toBeVisible();
  await page.screenshot({ path: screenshots.zh, fullPage: true });

  await page.goto(`${baseURL}/settings`);
  await page.locator('select').first().selectOption('en-US');
  await expect(page.getByText('Language')).toBeVisible();
  await page.screenshot({ path: screenshots.en, fullPage: true });
});

test('legacy-api-key', async ({ browser }) => {
  const legacyHome = mkdtempSync(join(tmpdir(), 'haro-feat-028-legacy-'));
  const legacyPort = 3458;
  const legacy = spawn('node', ['packages/cli/bin/haro.js', 'web', '--port', String(legacyPort), '--host', '127.0.0.1'], {
    cwd: repoRoot,
    env: { ...process.env, HARO_HOME: legacyHome, HARO_WEB_API_KEY: 'secret', HARO_LOG_ROLLING: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForHealth(`http://127.0.0.1:${legacyPort}`);
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${legacyPort}` });
    const health = await context.request.get('/api/health', { headers: { 'x-api-key': 'secret' } });
    expect(health.status()).toBe(200);
    const agents = await context.request.get('/api/v1/agents');
    expect(agents.status()).toBe(401);
    await context.close();
  } finally {
    legacy.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!legacy.killed) legacy.kill('SIGKILL');
    rmSync(legacyHome, { recursive: true, force: true });
  }
});

async function ensureLoggedIn(page: Page) {
  await page.goto(`${baseURL}/chat`);
  const state = await waitForAuthSurface(page);
  if (state === 'login') {
    await page.getByLabel('用户名').fill(owner.username);
    await page.getByLabel('密码').fill(owner.password);
    await page.getByRole('button', { name: '登录' }).click();
  }
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('button', { name: /登出/ })).toBeVisible();
}

async function waitForAuthSurface(page: Page): Promise<'authenticated' | 'login'> {
  const logoutButton = page.getByRole('button', { name: /登出/ });
  const usernameInput = page.getByLabel('用户名');
  return Promise.race([
    logoutButton.waitFor({ state: 'visible' }).then(() => 'authenticated' as const),
    usernameInput.waitFor({ state: 'visible' }).then(() => 'login' as const),
  ]);
}

async function createViewer(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/v1/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', displayName: 'Viewer User', password: 'viewer-password', role: 'viewer' }),
    });
    return response.status;
  });
  expect([201, 409]).toContain(result);
}

async function waitForHealth(target = baseURL) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${target}/api/health`);
      if (response.ok) return;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${target}/api/health`);
}

function seedSessions(count: number) {
  const script = `
    const Database = require('./packages/core/node_modules/better-sqlite3');
    const db = new Database(${JSON.stringify(join(haroHome, 'haro.db'))});
    for (let i = 1; i <= ${count}; i += 1) {
      const id = 'e2e-session-' + String(i).padStart(2, '0');
      db.prepare('INSERT OR IGNORE INTO sessions (id, agent_id, provider, model, started_at, ended_at, context_ref, status) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
        .run(id, 'agent-e2e', 'codex', 'gpt-e2e', '2026-04-28T00:' + String(i).padStart(2, '0') + ':00.000Z', i % 2 === 0 ? 'completed' : 'running');
    }
    db.close();
  `;
  const result = spawnSync('node', ['-e', script], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'failed to seed sessions');
}
