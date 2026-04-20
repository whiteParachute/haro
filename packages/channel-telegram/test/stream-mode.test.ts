import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TelegramChannel } from '../src/index.js';
import type { TelegramInboundEvent, TelegramSessionRuntime, TelegramTransport } from '../src/transport.js';

class FakeTransport implements TelegramTransport {
  private onMessage: ((event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>) | null = null;
  readonly messages: Array<{ chatId: string; text: string }> = [];
  readonly streamChunks: string[] = [];
  streamBegins = 0;
  streamEnds = 0;
  async connect(onMessage: (event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>): Promise<void> { this.onMessage = onMessage; }
  async disconnect(): Promise<void> { this.onMessage = null; }
  async sendMessage(runtime: TelegramSessionRuntime, text: string): Promise<void> { this.messages.push({ chatId: runtime.chatId, text }); }
  async beginStream(): Promise<void> { this.streamBegins += 1; }
  async pushStreamChunk(_runtime: TelegramSessionRuntime, chunk: string): Promise<void> { this.streamChunks.push(chunk); }
  async endStream(): Promise<void> { this.streamEnds += 1; }
  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> { return { ok: true, message: 'ok' }; }
  async emit(event: TelegramInboundEvent): Promise<void> {
    await this.onMessage?.(event, { sessionId: '', chatId: event.chatId, userId: event.userId, chatType: event.chatType, replyContext: {} as never });
  }
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

describe('TelegramChannel stream mode [FEAT-009]', () => {
  const roots: string[] = [];
  afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

  it('streams only in private chats and degrades group chats to final result', async () => {
    const rootPrivate = mkdtempSync(join(tmpdir(), 'haro-telegram-stream-private-'));
    roots.push(rootPrivate);
    const transportPrivate = new FakeTransport();
    const privateChannel = new TelegramChannel({ root: rootPrivate, logger, transportFactory: () => transportPrivate });
    let privateSession = '';
    await privateChannel.start({ config: { enabled: true, botToken: '123:abc', sessionScope: 'per-chat' }, logger, onInbound: async (msg) => { privateSession = msg.sessionId; } });
    await transportPrivate.emit({ chatId: '10', userId: '1', chatType: 'private', messageId: 1, text: 'hello', attachments: [], rawUpdate: { update_id: 1 } as never, timestamp: '2026-04-20T00:00:00.000Z' });
    await privateChannel.send(privateSession, { type: 'text', content: 'Hel', delta: true });
    await privateChannel.send(privateSession, { type: 'text', content: 'lo', delta: true });
    await privateChannel.send(privateSession, { type: 'text', content: 'Hello', delta: false });
    expect(transportPrivate.streamChunks).toEqual(['Hel', 'lo']);
    expect(transportPrivate.streamEnds).toBe(1);
    expect(transportPrivate.messages).toEqual([]);

    const rootGroup = mkdtempSync(join(tmpdir(), 'haro-telegram-stream-group-'));
    roots.push(rootGroup);
    const transportGroup = new FakeTransport();
    const groupChannel = new TelegramChannel({ root: rootGroup, logger, transportFactory: () => transportGroup });
    let groupSession = '';
    await groupChannel.start({ config: { enabled: true, botToken: '123:abc', sessionScope: 'per-chat' }, logger, onInbound: async (msg) => { groupSession = msg.sessionId; } });
    await transportGroup.emit({ chatId: '20', userId: '1', chatType: 'group', messageId: 1, text: '@bot hi', attachments: [], rawUpdate: { update_id: 1 } as never, timestamp: '2026-04-20T00:00:00.000Z' });
    await groupChannel.send(groupSession, { type: 'text', content: 'Hel', delta: true });
    await groupChannel.send(groupSession, { type: 'text', content: 'Hello', delta: false });
    expect(transportGroup.streamChunks).toEqual([]);
    expect(transportGroup.messages).toEqual([{ chatId: '20', text: 'Hello' }]);
  });
});
