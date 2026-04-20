import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TelegramChannel } from '../src/index.js';
import type { TelegramInboundEvent, TelegramSessionRuntime, TelegramTransport } from '../src/transport.js';

class FakeTransport implements TelegramTransport {
  private onMessage: ((event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>) | null = null;
  async connect(onMessage: (event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>): Promise<void> {
    this.onMessage = onMessage;
  }
  async disconnect(): Promise<void> { this.onMessage = null; }
  async sendMessage(): Promise<void> { return undefined; }
  async beginStream(): Promise<void> { return undefined; }
  async pushStreamChunk(): Promise<void> { return undefined; }
  async endStream(): Promise<void> { return undefined; }
  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> { return { ok: true, message: 'ok' }; }
  async emit(event: TelegramInboundEvent, runtime?: Partial<TelegramSessionRuntime>): Promise<void> {
    await this.onMessage?.(event, {
      sessionId: '',
      chatId: event.chatId,
      userId: event.userId,
      chatType: event.chatType,
      ...runtime,
    });
  }
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

describe('TelegramChannel inbound mapping [FEAT-009]', () => {
  const roots: string[] = [];
  afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

  it('keeps raw text and stable attachment ids in meta.attachments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-telegram-inbound-'));
    roots.push(root);
    const transport = new FakeTransport();
    const messages: Array<Record<string, unknown>> = [];
    const channel = new TelegramChannel({ root, logger, transportFactory: () => transport });
    await channel.start({
      config: { enabled: true, botToken: '123:abc', sessionScope: 'per-chat' },
      logger,
      onInbound: async (msg) => { messages.push(msg as unknown as Record<string, unknown>); },
    });
    await transport.emit({
      chatId: '42',
      userId: '7',
      chatType: 'private',
      messageId: 1,
      text: 'hello telegram',
      attachments: [{ kind: 'document', file_id: 'file-1', file_unique_id: 'uniq-1', name: 'a.txt' }],
      rawUpdate: { update_id: 1 } as never,
      timestamp: '2026-04-20T00:00:00.000Z',
    });
    expect(messages[0]).toMatchObject({ channelId: 'telegram', content: 'hello telegram', type: 'file' });
    expect((messages[0]?.meta as { attachments?: unknown[] }).attachments).toEqual([
      { kind: 'document', file_id: 'file-1', file_unique_id: 'uniq-1', name: 'a.txt' },
    ]);
  });
});
