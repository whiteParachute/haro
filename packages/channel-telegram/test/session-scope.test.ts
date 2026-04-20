import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TelegramChannel } from '../src/index.js';
import type { TelegramInboundEvent, TelegramSessionRuntime, TelegramTransport } from '../src/transport.js';

class FakeTransport implements TelegramTransport {
  private onMessage: ((event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>) | null = null;
  async connect(onMessage: (event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>): Promise<void> { this.onMessage = onMessage; }
  async disconnect(): Promise<void> { this.onMessage = null; }
  async sendMessage(): Promise<void> { return undefined; }
  async beginStream(): Promise<void> { return undefined; }
  async pushStreamChunk(): Promise<void> { return undefined; }
  async endStream(): Promise<void> { return undefined; }
  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> { return { ok: true, message: 'ok' }; }
  async emit(event: TelegramInboundEvent): Promise<void> {
    await this.onMessage?.(event, { sessionId: '', chatId: event.chatId, userId: event.userId, chatType: event.chatType });
  }
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

describe('TelegramChannel session scope [FEAT-009]', () => {
  const roots: string[] = [];
  afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

  it('maps per-chat and per-user correctly', async () => {
    const rootA = mkdtempSync(join(tmpdir(), 'haro-telegram-chat-'));
    roots.push(rootA);
    const transportA = new FakeTransport();
    const sessionsA: string[] = [];
    const channelA = new TelegramChannel({ root: rootA, logger, transportFactory: () => transportA });
    await channelA.start({ config: { enabled: true, botToken: '123:abc', sessionScope: 'per-chat' }, logger, onInbound: async (msg) => { sessionsA.push(msg.sessionId); } });
    await transportA.emit(baseEvent({ chatId: '100', userId: '1', chatType: 'group' }));
    await transportA.emit(baseEvent({ chatId: '100', userId: '2', chatType: 'group' }));
    await transportA.emit(baseEvent({ chatId: '200', userId: '1', chatType: 'group' }));
    expect(sessionsA[0]).toBe(sessionsA[1]);
    expect(sessionsA[2]).not.toBe(sessionsA[0]);

    const rootB = mkdtempSync(join(tmpdir(), 'haro-telegram-user-'));
    roots.push(rootB);
    const transportB = new FakeTransport();
    const sessionsB: string[] = [];
    const channelB = new TelegramChannel({ root: rootB, logger, transportFactory: () => transportB });
    await channelB.start({ config: { enabled: true, botToken: '123:abc', sessionScope: 'per-user' }, logger, onInbound: async (msg) => { sessionsB.push(msg.sessionId); } });
    await transportB.emit(baseEvent({ chatId: '100', userId: '1', chatType: 'group' }));
    await transportB.emit(baseEvent({ chatId: '200', userId: '1', chatType: 'group' }));
    expect(sessionsB[0]).toBe(sessionsB[1]);
  });
});

function baseEvent(overrides: Partial<TelegramInboundEvent>): TelegramInboundEvent {
  return {
    chatId: '10',
    userId: '1',
    chatType: 'private',
    messageId: 1,
    text: 'hello',
    attachments: [],
    rawUpdate: { update_id: 1 } as never,
    timestamp: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}
