import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, type Context } from 'grammy';
import { stream, type StreamFlavor } from '@grammyjs/stream';
import type { ChannelLogger } from '@haro/channel';
import type { Update } from 'grammy/types';

export interface TelegramAttachmentMeta {
  kind: 'photo' | 'document' | 'video' | 'audio' | 'voice' | 'animation' | 'sticker';
  file_id: string;
  file_unique_id: string;
  name?: string;
}

export interface TelegramInboundEvent {
  chatId: string;
  userId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  messageId: number;
  text: string;
  attachments: readonly TelegramAttachmentMeta[];
  rawUpdate: Update;
  timestamp: string;
}

export interface TelegramSessionRuntime {
  sessionId: string;
  chatId: string;
  userId: string;
  chatType: TelegramInboundEvent['chatType'];
  replyContext?: StreamContext;
}

export interface TelegramTransport {
  connect(onMessage: (event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(runtime: TelegramSessionRuntime, text: string): Promise<void>;
  beginStream(runtime: TelegramSessionRuntime): Promise<void>;
  pushStreamChunk(runtime: TelegramSessionRuntime, chunk: string): Promise<void>;
  endStream(runtime: TelegramSessionRuntime): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; message: string; code?: string }>;
}

export interface TelegramTransportOptions {
  token: string;
  allowedUpdates: readonly string[];
  logger: ChannelLogger;
}

type StreamContext = StreamFlavor<Context>;

export function createGrammyTransport(options: TelegramTransportOptions): TelegramTransport {
  return new GrammyTelegramTransport(options);
}

class AsyncTextQueue implements AsyncIterable<string> {
  private readonly values: string[] = [];
  private readonly waiters: Array<(result: IteratorResult<string>) => void> = [];
  private done = false;

  push(value: string): void {
    if (this.done || value.length === 0) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        if (this.values.length > 0) {
          const value = this.values.shift()!;
          return { value, done: false };
        }
        if (this.done) {
          return { value: undefined, done: true };
        }
        return new Promise<IteratorResult<string>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

class GrammyTelegramTransport implements TelegramTransport {
  private readonly logger: ChannelLogger;
  private readonly bot: Bot<StreamContext>;
  private readonly allowedUpdates: readonly string[];
  private readonly runtimes = new Map<string, { runtime: TelegramSessionRuntime; queue?: AsyncTextQueue; streamPromise?: Promise<void> }>();
  private connected = false;
  private pollingPromise: Promise<void> | null = null;

  constructor(options: TelegramTransportOptions) {
    this.logger = options.logger;
    this.allowedUpdates = options.allowedUpdates;
    this.bot = new Bot<StreamContext>(options.token);
    this.bot.api.config.use(autoRetry());
    this.bot.use(stream());
    this.bot.catch((error) => {
      this.logger.error({ error: error.error instanceof Error ? error.error.message : String(error.error) }, 'Telegram polling error');
    });
  }

  async connect(onMessage: (event: TelegramInboundEvent, runtime: TelegramSessionRuntime) => Promise<void>): Promise<void> {
    if (this.connected) return;
    this.bot.on('message', async (ctx) => {
      const event = mapTelegramUpdate(ctx.update);
      if (!event) return;
      const runtime: TelegramSessionRuntime = {
        sessionId: '',
        chatId: event.chatId,
        userId: event.userId,
        chatType: event.chatType,
        replyContext: ctx,
      };
      await onMessage(event, runtime);
      this.runtimes.set(runtime.sessionId, { runtime });
    });
    await this.bot.init();
    this.pollingPromise = this.bot.start({ allowed_updates: this.allowedUpdates as never }).catch((error) => {
      this.logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Telegram polling loop failed');
    });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.bot.stop();
    for (const entry of this.runtimes.values()) {
      entry.queue?.close();
      await entry.streamPromise?.catch(() => undefined);
    }
    this.runtimes.clear();
    await this.pollingPromise?.catch(() => undefined);
    this.pollingPromise = null;
    this.connected = false;
  }

  async sendMessage(runtime: TelegramSessionRuntime, text: string): Promise<void> {
    await this.bot.api.sendMessage(Number(runtime.chatId), text);
  }

  async beginStream(runtime: TelegramSessionRuntime): Promise<void> {
    const existing = this.runtimes.get(runtime.sessionId);
    if (existing?.queue) return;
    if (!runtime.replyContext) {
      throw new Error('Telegram private streaming requires the original grammY context');
    }
    const queue = new AsyncTextQueue();
    const streamPromise = runtime.replyContext.replyWithStream(queue).then(() => undefined);
    this.runtimes.set(runtime.sessionId, { runtime, queue, streamPromise });
  }

  async pushStreamChunk(runtime: TelegramSessionRuntime, chunk: string): Promise<void> {
    const entry = this.runtimes.get(runtime.sessionId);
    if (!entry?.queue) {
      await this.beginStream(runtime);
      this.runtimes.get(runtime.sessionId)?.queue?.push(chunk);
      return;
    }
    entry.queue.push(chunk);
  }

  async endStream(runtime: TelegramSessionRuntime): Promise<void> {
    const entry = this.runtimes.get(runtime.sessionId);
    if (!entry?.queue) return;
    entry.queue.close();
    await entry.streamPromise?.catch((error) => {
      this.logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Telegram stream close failed');
    });
    this.runtimes.set(runtime.sessionId, { runtime: entry.runtime });
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> {
    try {
      await this.bot.api.getMe();
      return { ok: true, message: 'getMe succeeded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /401|unauthorized/i.test(message) ? '401' : 'telegram_error';
      return { ok: false, code, message };
    }
  }
}

export function mapTelegramUpdate(update: Update): TelegramInboundEvent | null {
  const message = update.message;
  if (!message || !message.chat || !message.from) return null;
  const text = message.text ?? message.caption ?? '';
  const attachments = extractTelegramAttachments(message);
  return {
    chatId: String(message.chat.id),
    userId: String(message.from.id),
    chatType: message.chat.type,
    messageId: message.message_id,
    text,
    attachments,
    rawUpdate: update,
    timestamp: new Date(message.date * 1000).toISOString(),
  };
}

export function extractTelegramAttachments(message: NonNullable<Update['message']>): TelegramAttachmentMeta[] {
  const attachments: TelegramAttachmentMeta[] = [];
  const push = (kind: TelegramAttachmentMeta['kind'], file: { file_id: string; file_unique_id: string }, name?: string) => {
    attachments.push({
      kind,
      file_id: file.file_id,
      file_unique_id: file.file_unique_id,
      ...(name ? { name } : {}),
    });
  };
  const largestPhoto = Array.isArray(message.photo) && message.photo.length > 0 ? message.photo[message.photo.length - 1] : undefined;
  if (largestPhoto) push('photo', largestPhoto);
  if (message.document) push('document', message.document, message.document.file_name);
  if (message.video) push('video', message.video, message.video.file_name);
  if (message.audio) push('audio', message.audio, message.audio.file_name);
  if (message.voice) push('voice', message.voice);
  if (message.animation) push('animation', message.animation, message.animation.file_name);
  if (message.sticker) push('sticker', message.sticker);
  return attachments;
}
