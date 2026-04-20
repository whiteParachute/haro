import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import {
  ChannelSessionStore,
  readJsonFile,
  writeJsonFile,
  type ChannelContext,
  type ChannelDoctorResult,
  type ChannelLogger,
  type ChannelSetupContext,
  type ChannelSetupResult,
  type ManagedChannel,
  type OutboundMessage,
} from '@haro/channel';
import { resolveTelegramConfig, type TelegramChannelConfig } from './config.js';
import { createGrammyTransport, type TelegramSessionRuntime, type TelegramTransport } from './transport.js';

interface TelegramState {
  transport: 'long-polling';
  sessionScope: 'per-chat' | 'per-user';
  allowedUpdates: string[];
  lastConnectedAt?: string;
  lastEventAt?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
}

interface RuntimeEntry {
  chatId: string;
  userId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  runtime?: TelegramSessionRuntime;
  streamActive: boolean;
}

export interface TelegramChannelOptions {
  root: string;
  logger: ChannelLogger;
  config?: Record<string, unknown>;
  createSessionId?: () => string;
  transportFactory?: (config: Required<TelegramChannelConfig>, logger: ChannelLogger) => TelegramTransport;
}

export class TelegramChannel implements ManagedChannel {
  readonly id = 'telegram';

  private readonly logger: ChannelLogger;
  private readonly createSessionId: () => string;
  private readonly baseConfig: Record<string, unknown>;
  private readonly stateFile: string;
  private readonly store: ChannelSessionStore;
  private readonly transportFactory: NonNullable<TelegramChannelOptions['transportFactory']>;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private transport: TelegramTransport | null = null;
  private resolvedConfig: Required<TelegramChannelConfig>;

  constructor(options: TelegramChannelOptions) {
    this.logger = options.logger;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.baseConfig = options.config ?? {};
    const dir = join(options.root, 'channels', this.id);
    this.stateFile = join(dir, 'state.json');
    this.store = new ChannelSessionStore(join(dir, 'sessions.sqlite'), this.logger);
    this.transportFactory = options.transportFactory ?? ((config, logger) => createGrammyTransport({
      token: config.botToken,
      allowedUpdates: config.allowedUpdates,
      logger,
    }));
    this.resolvedConfig = resolveTelegramConfig(this.baseConfig);
  }

  capabilities() {
    return {
      streaming: true,
      richText: true,
      attachments: true,
      threading: false,
      requiresWebhook: false,
      extended: {
        privateStreamingOnly: true,
      },
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.runDoctor(this.resolvedConfig);
    return result.ok;
  }

  async doctor(ctx: ChannelSetupContext): Promise<ChannelDoctorResult> {
    const config = resolveTelegramConfig({ ...this.baseConfig, ...ctx.config });
    return this.runDoctor(config);
  }

  async setup(ctx: ChannelSetupContext): Promise<ChannelSetupResult> {
    const initial = resolveTelegramConfig({ ...this.baseConfig, ...ctx.config });
    const rl = createInterface({ input: ctx.stdin, output: ctx.stdout, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    try {
      const botToken = (await readPromptLine(lines, ctx.stdout, `Telegram Bot Token [${initial.botToken ? '***' : ''}]: `)).trim() || initial.botToken;
      const sessionScopeInput = (await readPromptLine(lines, ctx.stdout, `Session scope (per-chat/per-user) [${initial.sessionScope}]: `)).trim() || initial.sessionScope;
      const nextConfig = {
        enabled: true,
        botToken,
        transport: 'long-polling',
        allowedUpdates: ['message'],
        sessionScope: sessionScopeInput === 'per-user' ? 'per-user' : 'per-chat',
      } as const;
      return {
        ok: true,
        config: nextConfig,
        message: `Telegram channel configured with ${nextConfig.sessionScope} session scope.`,
      };
    } finally {
      rl.close();
    }
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.resolvedConfig = resolveTelegramConfig({ ...this.baseConfig, ...ctx.config });
    if (!this.resolvedConfig.enabled) return;
    if (!this.resolvedConfig.botToken) {
      throw new Error('Telegram channel requires botToken');
    }
    this.transport = this.transportFactory(this.resolvedConfig, this.logger);
    await this.transport.connect(async (event, runtime) => {
      const scopeKey = this.resolvedConfig.sessionScope === 'per-user' ? `user:${event.userId}` : `chat:${event.chatId}`;
      const sessionId = this.store.resolve({
        scopeKey,
        createSessionId: this.createSessionId,
        userId: event.userId,
        chatId: event.chatId,
      });
      runtime.sessionId = sessionId;
      this.runtimes.set(sessionId, {
        chatId: event.chatId,
        userId: event.userId,
        chatType: event.chatType,
        runtime,
        streamActive: false,
      });
      await this.persistState({
        transport: 'long-polling',
        sessionScope: this.resolvedConfig.sessionScope,
        allowedUpdates: this.resolvedConfig.allowedUpdates,
        lastConnectedAt: this.readState().lastConnectedAt ?? new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
      });
      await ctx.onInbound({
        sessionId,
        userId: event.userId,
        channelId: this.id,
        type: inferInboundType(event.attachments),
        content: event.text,
        timestamp: event.timestamp,
        meta: {
          chatId: event.chatId,
          chatType: event.chatType,
          messageId: event.messageId,
          attachments: event.attachments,
          raw: event.rawUpdate,
          transport: 'long-polling',
          sessionScope: this.resolvedConfig.sessionScope,
        },
      });
    });
    await this.persistState({
      transport: 'long-polling',
      sessionScope: this.resolvedConfig.sessionScope,
      allowedUpdates: this.resolvedConfig.allowedUpdates,
      lastConnectedAt: new Date().toISOString(),
      lastEventAt: this.readState().lastEventAt,
    });
  }

  async stop(): Promise<void> {
    await this.transport?.disconnect();
    this.transport = null;
    this.store.close();
  }

  async send(sessionId: string, msg: OutboundMessage): Promise<void> {
    if (!this.transport) {
      throw new Error('Telegram channel is not started');
    }
    const target = this.runtimes.get(sessionId) ?? this.restoreRuntime(sessionId);
    if (!target) {
      throw new Error(`No Telegram chat mapping found for session '${sessionId}'`);
    }
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
    const isPrivate = target.chatType === 'private';
    if (msg.delta) {
      if (!isPrivate) return;
      if (!target.runtime) return;
      await this.transport.pushStreamChunk(target.runtime, text);
      target.streamActive = true;
      return;
    }
    if (isPrivate && target.streamActive && target.runtime) {
      await this.transport.endStream(target.runtime);
      target.streamActive = false;
      return;
    }
    await this.transport.sendMessage(target.runtime ?? {
      sessionId,
      chatId: target.chatId,
      userId: target.userId,
      chatType: target.chatType,
    }, text);
  }

  private async runDoctor(config: Required<TelegramChannelConfig>): Promise<ChannelDoctorResult> {
    if (!config.botToken) {
      return {
        ok: false,
        code: 'missing_credentials',
        message: 'Telegram channel is missing botToken',
      };
    }
    const transport = this.transportFactory(config, this.logger);
    const health = await transport.healthCheck();
    await transport.disconnect();
    await this.persistState({
      transport: 'long-polling',
      sessionScope: config.sessionScope,
      allowedUpdates: config.allowedUpdates,
      lastConnectedAt: this.readState().lastConnectedAt,
      lastEventAt: this.readState().lastEventAt,
      lastHealthCheckAt: new Date().toISOString(),
      ...(health.ok ? {} : { lastError: health.message }),
    });
    return {
      ok: health.ok,
      code: health.code,
      message: health.message,
      details: {
        transport: 'long-polling',
        sessionScope: config.sessionScope,
        allowedUpdates: config.allowedUpdates,
      },
    };
  }

  private readState(): TelegramState {
    return readJsonFile<TelegramState>(this.stateFile, {
      transport: 'long-polling',
      sessionScope: this.resolvedConfig.sessionScope,
      allowedUpdates: this.resolvedConfig.allowedUpdates,
    });
  }

  private async persistState(next: TelegramState): Promise<void> {
    writeJsonFile(this.stateFile, {
      transport: 'long-polling',
      sessionScope: next.sessionScope,
      allowedUpdates: next.allowedUpdates,
      ...(next.lastConnectedAt ? { lastConnectedAt: next.lastConnectedAt } : {}),
      ...(next.lastEventAt ? { lastEventAt: next.lastEventAt } : {}),
      ...(next.lastHealthCheckAt ? { lastHealthCheckAt: next.lastHealthCheckAt } : {}),
      ...(next.lastError ? { lastError: next.lastError } : {}),
    } satisfies TelegramState);
  }

  private restoreRuntime(sessionId: string): RuntimeEntry | undefined {
    const record = this.store.findBySessionId(sessionId);
    if (!record?.chatId || !record.userId) return undefined;
    const restored: RuntimeEntry = {
      chatId: record.chatId,
      userId: record.userId,
      chatType: 'private',
      streamActive: false,
    };
    this.runtimes.set(sessionId, restored);
    return restored;
  }
}

function inferInboundType(attachments: readonly unknown[]): 'text' | 'file' | 'image' {
  const typed = attachments as Array<{ kind?: string }>;
  if (typed.some((item) => item.kind === 'photo')) return 'image';
  if (typed.length > 0) return 'file';
  return 'text';
}

function defaultSessionId(): string {
  return `telegram-${Math.random().toString(16).slice(2)}`;
}

async function readPromptLine(iterator: AsyncIterableIterator<string>, stdout: NodeJS.WritableStream, prompt: string): Promise<string> {
  stdout.write(prompt);
  const next = await iterator.next();
  return next.done ? '' : next.value;
}
