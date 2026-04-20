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
import { createSdkFeishuTransport, type FeishuTransport } from './client.js';
import { resolveFeishuConfig, type FeishuChannelConfig } from './config.js';

interface FeishuState {
  transport: 'websocket';
  sessionScope: 'per-chat' | 'per-user';
  lastConnectedAt?: string;
  lastEventAt?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
}

export interface FeishuChannelOptions {
  root: string;
  logger: ChannelLogger;
  config?: Record<string, unknown>;
  createSessionId?: () => string;
  transportFactory?: (config: Required<FeishuChannelConfig>, logger: ChannelLogger) => FeishuTransport;
}

export class FeishuChannel implements ManagedChannel {
  readonly id = 'feishu';

  private readonly root: string;
  private readonly logger: ChannelLogger;
  private readonly createSessionId: () => string;
  private readonly transportFactory: NonNullable<FeishuChannelOptions['transportFactory']>;
  private readonly baseConfig: Record<string, unknown>;
  private readonly stateFile: string;
  private readonly store: ChannelSessionStore;
  private transport: FeishuTransport | null = null;
  private resolvedConfig: Required<FeishuChannelConfig>;

  constructor(options: FeishuChannelOptions) {
    this.root = options.root;
    this.logger = options.logger;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.transportFactory = options.transportFactory ?? ((config, logger) => createSdkFeishuTransport({
      appId: config.appId,
      appSecret: config.appSecret,
      logger,
    }));
    this.baseConfig = options.config ?? {};
    const dir = join(this.root, 'channels', this.id);
    this.stateFile = join(dir, 'state.json');
    this.store = new ChannelSessionStore(join(dir, 'sessions.sqlite'), this.logger);
    this.resolvedConfig = resolveFeishuConfig(this.baseConfig);
  }

  capabilities() {
    return {
      streaming: false,
      richText: false,
      attachments: true,
      threading: false,
      requiresWebhook: false,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.runDoctor(this.resolvedConfig);
    return result.ok;
  }

  async doctor(ctx: ChannelSetupContext): Promise<ChannelDoctorResult> {
    const config = resolveFeishuConfig({ ...this.baseConfig, ...ctx.config });
    return this.runDoctor(config);
  }

  async setup(ctx: ChannelSetupContext): Promise<ChannelSetupResult> {
    const initial = resolveFeishuConfig({ ...this.baseConfig, ...ctx.config });
    const rl = createInterface({ input: ctx.stdin, output: ctx.stdout, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    try {
      const appId =
        (await readPromptLine(lines, ctx.stdout, `Feishu App ID [${initial.appId || ''}]: `)).trim() ||
        initial.appId;
      const appSecret =
        (await readPromptLine(lines, ctx.stdout, `Feishu App Secret [${initial.appSecret ? '***' : ''}]: `)).trim() ||
        initial.appSecret;
      const sessionScopeInput =
        (await readPromptLine(lines, ctx.stdout, `Session scope (per-chat/per-user) [${initial.sessionScope}]: `)).trim() ||
        initial.sessionScope;
      const nextConfig = {
        enabled: true,
        appId,
        appSecret,
        transport: 'websocket',
        sessionScope: sessionScopeInput === 'per-user' ? 'per-user' : 'per-chat',
      } as const;
      return {
        ok: true,
        config: nextConfig,
        message: `Feishu channel configured with ${nextConfig.sessionScope} session scope.`,
      };
    } finally {
      rl.close();
    }
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.resolvedConfig = resolveFeishuConfig({ ...this.baseConfig, ...ctx.config });
    if (!this.resolvedConfig.enabled) return;
    if (!this.resolvedConfig.appId || !this.resolvedConfig.appSecret) {
      throw new Error('Feishu channel requires appId and appSecret');
    }
    this.transport = this.transportFactory(this.resolvedConfig, this.logger);
    await this.transport.connect(async (event) => {
      const scopeKey =
        this.resolvedConfig.sessionScope === 'per-user'
          ? `user:${event.senderOpenId}`
          : `chat:${event.chatId}`;
      const sessionId = this.store.resolve({
        scopeKey,
        createSessionId: this.createSessionId,
        userId: event.senderOpenId,
        chatId: event.chatId,
      });
      await this.persistState({
        transport: 'websocket',
        sessionScope: this.resolvedConfig.sessionScope,
        lastConnectedAt: this.readState().lastConnectedAt ?? new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
      });
      await ctx.onInbound({
        sessionId,
        userId: event.senderOpenId,
        channelId: this.id,
        type: inferInboundType(event.text, event.attachments),
        content: event.text,
        timestamp: normalizeTimestamp(event.createTime),
        meta: {
          chatId: event.chatId,
          chatType: event.chatType,
          messageId: event.messageId,
          attachments: event.attachments,
          raw: event.rawEvent,
          transport: 'websocket',
          sessionScope: this.resolvedConfig.sessionScope,
        },
      });
    });
    await this.persistState({
      transport: 'websocket',
      sessionScope: this.resolvedConfig.sessionScope,
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
      throw new Error('Feishu channel is not started');
    }
    const target = this.store.findBySessionId(sessionId);
    if (!target?.chatId) {
      throw new Error(`No Feishu chat mapping found for session '${sessionId}'`);
    }
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
    await this.transport.sendMessage(target.chatId, text);
  }

  private async runDoctor(config: Required<FeishuChannelConfig>): Promise<ChannelDoctorResult> {
    if (!config.appId || !config.appSecret) {
      return {
        ok: false,
        code: 'missing_credentials',
        message: 'Feishu channel is missing appId/appSecret',
      };
    }
    const transport = this.transportFactory(config, this.logger);
    const health = await transport.healthCheck();
    await transport.disconnect();
    const nextState: FeishuState = {
      transport: 'websocket',
      sessionScope: config.sessionScope,
      lastConnectedAt: this.readState().lastConnectedAt,
      lastEventAt: this.readState().lastEventAt,
      lastHealthCheckAt: new Date().toISOString(),
      ...(health.ok ? {} : { lastError: health.message }),
    };
    await this.persistState(nextState);
    return {
      ok: health.ok,
      code: health.code,
      message: health.message,
      details: {
        transport: 'websocket',
        sessionScope: config.sessionScope,
      },
    };
  }

  private readState(): FeishuState {
    return readJsonFile<FeishuState>(this.stateFile, {
      transport: 'websocket',
      sessionScope: this.resolvedConfig.sessionScope,
    });
  }

  private async persistState(next: FeishuState): Promise<void> {
    const safe: FeishuState = {
      transport: 'websocket',
      sessionScope: next.sessionScope,
      ...(next.lastConnectedAt ? { lastConnectedAt: next.lastConnectedAt } : {}),
      ...(next.lastEventAt ? { lastEventAt: next.lastEventAt } : {}),
      ...(next.lastHealthCheckAt ? { lastHealthCheckAt: next.lastHealthCheckAt } : {}),
      ...(next.lastError ? { lastError: next.lastError } : {}),
    };
    writeJsonFile(this.stateFile, safe);
  }
}

function normalizeTimestamp(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric < 1e12 ? numeric * 1000 : numeric;
    return new Date(millis).toISOString();
  }
  return new Date().toISOString();
}

function inferInboundType(
  text: string,
  attachments: readonly { kind: 'image' | 'file' }[],
): 'text' | 'file' | 'image' | 'event' {
  if (attachments.some((item) => item.kind === 'image')) return 'image';
  if (attachments.some((item) => item.kind === 'file')) return 'file';
  return text.length > 0 ? 'text' : 'event';
}

function defaultSessionId(): string {
  return `feishu-${Math.random().toString(16).slice(2)}`;
}

async function readPromptLine(
  iterator: AsyncIterableIterator<string>,
  stdout: NodeJS.WritableStream,
  prompt: string,
): Promise<string> {
  stdout.write(prompt);
  const next = await iterator.next();
  return next.done ? '' : next.value;
}
