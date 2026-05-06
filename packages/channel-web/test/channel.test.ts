import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelLogger, InboundMessage } from '@haro/channel';
import { WebChannel, type WebChannelStreamEvent } from '../src/index.js';

const noopLogger: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('WebChannel [FEAT-031]', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function makeChannel(): { channel: WebChannel; root: string } {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-channel-'));
    dirs.push(root);
    const channel = new WebChannel({
      root,
      logger: noopLogger,
      createSessionId: makeCounter('s'),
      createMessageId: makeCounter('m'),
      createFileId: makeCounter('f'),
    });
    return { channel, root };
  }

  it('declares Web Channel capabilities required by FEAT-031 R1', () => {
    const { channel } = makeChannel();
    const caps = channel.capabilities();
    expect(caps.streaming).toBe(true);
    expect(caps.attachments).toBe(true);
    expect(caps.threading).toBe(false);
    expect(caps.requiresWebhook).toBe(false);
    expect(caps.extended?.history).toBe(true);
    expect(caps.extended?.group).toBe(false);
  });

  it('refuses inbound submissions before start()', async () => {
    const { channel } = makeChannel();
    await expect(
      channel.submitInbound({ sessionId: 's-1', userId: 'u-1', content: 'hi' }),
    ).rejects.toThrow(/not started/);
  });

  it('persists inbound messages and dispatches to onInbound [AC1]', async () => {
    const { channel } = makeChannel();
    const inbound: InboundMessage[] = [];
    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async (msg) => {
        inbound.push(msg);
      },
    });
    const session = channel.createSession({ ownerUserId: 'u-1' });
    const result = await channel.submitInbound({
      sessionId: session.sessionId,
      userId: 'u-1',
      content: 'hello',
    });
    expect(result.message.role).toBe('user');
    expect(result.message.content).toBe('hello');
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.sessionId).toBe(session.sessionId);
    expect(inbound[0]!.channelId).toBe('web');
    expect(inbound[0]!.type).toBe('text');

    const history = channel.listMessages(session.sessionId);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.id).toBe(result.message.id);
  });

  it('records outbound messages and broadcasts stream events to subscribers', async () => {
    const { channel } = makeChannel();
    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async () => {},
    });
    const session = channel.createSession();
    const events: WebChannelStreamEvent[] = [];
    channel.onStream((_sessionId, event) => events.push(event));
    await channel.send(session.sessionId, { type: 'text', content: 'reply' });
    expect(events.some((event) => event.kind === 'agent')).toBe(true);
    const history = channel.listMessages(session.sessionId);
    expect(history.items[0]!.role).toBe('assistant');
  });

  it('saves attachments inside session-scoped storage [R5]', async () => {
    const { channel, root } = makeChannel();
    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async () => {},
    });
    const session = channel.createSession({ ownerUserId: 'u-1' });
    const data = Buffer.from('payload');
    const result = channel.saveAttachment({
      sessionId: session.sessionId,
      filename: 'note.txt',
      mimeType: 'text/plain',
      data,
      uploadedBy: 'u-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.storagePath.startsWith(join(root, 'channels', 'web', 'files'))).toBe(true);
      expect(readFileSync(result.file.storagePath, 'utf8')).toBe('payload');
      const usage = channel.uploadLimits();
      expect(usage.imageMaxBytes).toBeGreaterThan(0);
    }
  });

  it('rejects path traversal in attachment filename [AC5]', async () => {
    const { channel } = makeChannel();
    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async () => {},
    });
    const session = channel.createSession();
    const result = channel.saveAttachment({
      sessionId: session.sessionId,
      filename: '../../etc/passwd',
      mimeType: 'text/plain',
      data: Buffer.from('x'),
      uploadedBy: 'u-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden_path_segment');
    }
  });

  it('marks the channel as stopped after stop() [R10 prerequisite]', async () => {
    const { channel } = makeChannel();
    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async () => {},
    });
    expect(channel.isStarted()).toBe(true);
    await channel.stop();
    expect(channel.isStarted()).toBe(false);
  });

  it('survives a stop()/start() cycle on the same instance [Codex review §E/§G]', async () => {
    const { channel } = makeChannel();
    const events: WebChannelStreamEvent[] = [];
    const inbound: string[] = [];
    channel.onStream((_id, event) => events.push(event));

    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async (msg) => {
        inbound.push(typeof msg.content === 'string' ? msg.content : '');
      },
    });
    const session = channel.createSession();
    await channel.submitInbound({ sessionId: session.sessionId, userId: 'u-1', content: 'first' });

    await channel.stop();
    expect(channel.isStarted()).toBe(false);
    // History must still be readable while disabled (AC3 read-only mode).
    expect(channel.listMessages(session.sessionId).items).toHaveLength(1);

    await channel.start({
      config: { enabled: true },
      logger: noopLogger,
      onInbound: async (msg) => {
        inbound.push(typeof msg.content === 'string' ? msg.content : '');
      },
    });
    await channel.submitInbound({ sessionId: session.sessionId, userId: 'u-1', content: 'second' });
    expect(inbound).toEqual(['first', 'second']);
    // Stream subscriber registered before the cycle is still receiving.
    const messageEvents = events.filter((event) => event.kind === 'message');
    expect(messageEvents.length).toBeGreaterThanOrEqual(2);
  });
});

function makeCounter(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
