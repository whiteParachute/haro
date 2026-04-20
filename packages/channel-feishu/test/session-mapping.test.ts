import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeishuChannel } from '../src/index.js';
import type { FeishuInboundEvent, FeishuTransport } from '../src/client.js';

class FakeTransport implements FeishuTransport {
  private onMessage: ((event: FeishuInboundEvent) => Promise<void>) | null = null;
  readonly sent: Array<{ chatId: string; text: string }> = [];

  async connect(onMessage: (event: FeishuInboundEvent) => Promise<void>): Promise<void> {
    this.onMessage = onMessage;
  }
  async disconnect(): Promise<void> {
    this.onMessage = null;
  }
  async sendMessage(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> {
    return { ok: true, message: 'ok' };
  }
  async emit(event: FeishuInboundEvent): Promise<void> {
    await this.onMessage?.(event);
  }
}

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('FeishuChannel session mapping [FEAT-008]', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('supports per-chat and per-user session scopes', async () => {
    const perChatRoot = mkdtempSync(join(tmpdir(), 'haro-feishu-chat-'));
    roots.push(perChatRoot);
    const perChatTransport = new FakeTransport();
    const perChatSessions: string[] = [];
    const perChat = new FeishuChannel({ root: perChatRoot, logger, transportFactory: () => perChatTransport });
    await perChat.start({
      config: { enabled: true, appId: 'cli_x', appSecret: 'sec', sessionScope: 'per-chat' },
      logger,
      onInbound: async (msg) => {
        perChatSessions.push(msg.sessionId);
      },
    });
    await perChatTransport.emit(baseEvent({ chatId: 'chat-1', senderOpenId: 'user-1' }));
    await perChatTransport.emit(baseEvent({ chatId: 'chat-1', senderOpenId: 'user-2' }));
    await perChatTransport.emit(baseEvent({ chatId: 'chat-2', senderOpenId: 'user-1' }));
    expect(perChatSessions[0]).toBe(perChatSessions[1]);
    expect(perChatSessions[2]).not.toBe(perChatSessions[0]);

    const perUserRoot = mkdtempSync(join(tmpdir(), 'haro-feishu-user-'));
    roots.push(perUserRoot);
    const perUserTransport = new FakeTransport();
    const perUserSessions: string[] = [];
    const perUser = new FeishuChannel({ root: perUserRoot, logger, transportFactory: () => perUserTransport });
    await perUser.start({
      config: { enabled: true, appId: 'cli_x', appSecret: 'sec', sessionScope: 'per-user' },
      logger,
      onInbound: async (msg) => {
        perUserSessions.push(msg.sessionId);
      },
    });
    await perUserTransport.emit(baseEvent({ chatId: 'chat-1', senderOpenId: 'user-1' }));
    await perUserTransport.emit(baseEvent({ chatId: 'chat-2', senderOpenId: 'user-1' }));
    expect(perUserSessions[0]).toBe(perUserSessions[1]);
  });
});

function baseEvent(overrides: Partial<FeishuInboundEvent>): FeishuInboundEvent {
  return {
    chatId: 'chat-default',
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    chatType: 'group',
    senderOpenId: 'user-default',
    text: 'hello',
    attachments: [],
    createTime: '1710000000',
    rawEvent: { raw: true },
    ...overrides,
  };
}
