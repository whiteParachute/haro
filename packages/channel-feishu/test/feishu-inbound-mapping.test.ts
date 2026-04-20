import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelContext } from '@haro/channel';
import { FeishuChannel, type FeishuChannelOptions } from '../src/index.js';
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

describe('FeishuChannel inbound mapping [FEAT-008]', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('maps inbound raw events to Haro messages while keeping original text and attachments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feishu-'));
    roots.push(root);
    const fakeTransport = new FakeTransport();
    const received: Array<Awaited<ReturnType<ChannelContext['onInbound']>>> = [];
    const messages: Array<Parameters<ChannelContext['onInbound']>[0]> = [];
    const channel = createChannel(root, fakeTransport);

    await channel.start({
      config: { enabled: true, appId: 'cli_xxx', appSecret: 'secret', sessionScope: 'per-chat' },
      logger,
      onInbound: async (msg) => {
        messages.push(msg);
        received.push(undefined);
      },
    });

    await fakeTransport.emit({
      chatId: 'oc_123',
      messageId: 'om_123',
      chatType: 'group',
      senderOpenId: 'ou_123',
      text: '原文输入',
      attachments: [
        { kind: 'file', file_id: 'file_1', file_unique_id: 'file_1', name: 'doc.txt' },
      ],
      createTime: '1710000000',
      rawEvent: { event_id: 'evt-1' },
    });

    expect(received).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channelId: 'feishu',
      userId: 'ou_123',
      type: 'file',
      content: '原文输入',
    });
    expect(messages[0]?.meta?.attachments).toEqual([
      { kind: 'file', file_id: 'file_1', file_unique_id: 'file_1', name: 'doc.txt' },
    ]);
    expect(messages[0]?.meta?.raw).toEqual({ event_id: 'evt-1' });
  });
});

function createChannel(root: string, transport: FakeTransport): FeishuChannel {
  return new FeishuChannel({
    root,
    logger,
    transportFactory: () => transport,
  } satisfies FeishuChannelOptions);
}
