import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeishuChannel } from '../src/index.js';
import type { FeishuTransport } from '../src/client.js';

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class HealthyTransport implements FeishuTransport {
  async connect(): Promise<void> {
    return undefined;
  }
  async disconnect(): Promise<void> {
    return undefined;
  }
  async sendMessage(): Promise<void> {
    return undefined;
  }
  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> {
    return { ok: true, message: 'ok' };
  }
}

describe('FeishuChannel state redaction [FEAT-008]', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('never persists appSecret or transient access tokens into state.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feishu-state-'));
    roots.push(root);
    const channel = new FeishuChannel({
      root,
      logger,
      config: { enabled: true, appId: 'cli_xxx', appSecret: 'super-secret' },
      transportFactory: () => new HealthyTransport(),
    });

    await channel.doctor?.({
      root,
      config: { enabled: true, appId: 'cli_xxx', appSecret: 'super-secret' },
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      logger,
    });

    const state = readFileSync(join(root, 'channels', 'feishu', 'state.json'), 'utf8');
    expect(state).not.toContain('super-secret');
    expect(state).not.toContain('tenant_access_token');
    expect(JSON.parse(state)).toMatchObject({ transport: 'websocket', sessionScope: 'per-chat' });
  });
});
