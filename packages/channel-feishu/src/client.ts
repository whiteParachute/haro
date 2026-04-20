import * as lark from '@larksuiteoapi/node-sdk';
import type { ChannelLogger } from '@haro/channel';

export interface FeishuAttachmentMeta {
  kind: 'image' | 'file';
  file_id: string;
  file_unique_id: string;
  name?: string;
}

export interface FeishuInboundEvent {
  chatId: string;
  messageId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  text: string;
  attachments: readonly FeishuAttachmentMeta[];
  createTime: string;
  rawEvent: Record<string, unknown>;
}

export interface FeishuTransport {
  connect(onMessage: (event: FeishuInboundEvent) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(chatId: string, text: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; message: string; code?: string }>;
}

export interface FeishuTransportOptions {
  appId: string;
  appSecret: string;
  logger: ChannelLogger;
}

export function createSdkFeishuTransport(options: FeishuTransportOptions): FeishuTransport {
  return new SdkFeishuTransport(options);
}

class SdkFeishuTransport implements FeishuTransport {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly logger: ChannelLogger;
  private readonly client: lark.Client;
  private wsClient: lark.WSClient | null = null;

  constructor(options: FeishuTransportOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.logger = options.logger;
    this.client = new lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      appType: lark.AppType.SelfBuild,
    });
  }

  async connect(onMessage: (event: FeishuInboundEvent) => Promise<void>): Promise<void> {
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (payload) => {
        await onMessage(mapInboundEvent(payload as Record<string, unknown>));
      },
    });
    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.info,
      logger: {
        error: (...args: unknown[]) => this.logger.error({ args }, 'Feishu WS error'),
        warn: (...args: unknown[]) => this.logger.warn({ args }, 'Feishu WS warning'),
        info: (...args: unknown[]) => this.logger.info({ args }, 'Feishu WS info'),
        debug: (...args: unknown[]) => this.logger.debug({ args }, 'Feishu WS debug'),
        trace: (...args: unknown[]) => this.logger.debug({ args }, 'Feishu WS trace'),
      },
    });
    await this.wsClient.start({ eventDispatcher: dispatcher });
  }

  async disconnect(): Promise<void> {
    if (!this.wsClient) return;
    const candidate = this.wsClient as unknown as { close?: (input?: unknown) => void; stop?: () => void };
    if (typeof candidate.close === 'function') {
      candidate.close({ force: true });
    } else if (typeof candidate.stop === 'function') {
      candidate.stop();
    }
    this.wsClient = null;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; code?: string }> {
    try {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      });
      const payload = (await response.json()) as { code?: number; msg?: string; tenant_access_token?: string };
      if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
        return {
          ok: false,
          code: String(payload.code ?? response.status),
          message: payload.msg ?? `HTTP ${response.status}`,
        };
      }
      return { ok: true, message: 'tenant_access_token acquired' };
    } catch (error) {
      return {
        ok: false,
        code: 'network_error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function mapInboundEvent(rawEvent: Record<string, unknown>): FeishuInboundEvent {
  const message = (rawEvent.message ?? {}) as Record<string, unknown>;
  const sender = (rawEvent.sender ?? {}) as Record<string, unknown>;
  const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;
  const messageType = asString(message.message_type) ?? 'text';
  const parsedContent = parseContent(messageType, asString(message.content) ?? '{}');

  return {
    chatId: asString(message.chat_id) ?? '',
    messageId: asString(message.message_id) ?? '',
    chatType: asString(message.chat_type) === 'p2p' ? 'p2p' : 'group',
    senderOpenId: asString(senderId.open_id) ?? '',
    text: parsedContent.text,
    attachments: parsedContent.attachments,
    createTime: asString(message.create_time) ?? new Date().toISOString(),
    rawEvent,
  };
}

function parseContent(
  messageType: string,
  content: string,
): { text: string; attachments: readonly FeishuAttachmentMeta[] } {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  if (messageType === 'text') {
    return { text: asString(parsed.text) ?? '', attachments: [] };
  }

  if (messageType === 'post') {
    const post = ((parsed.post as Record<string, unknown> | undefined) ?? parsed) as Record<string, unknown>;
    const locale = pickFirstObject(post.zh_cn, post.en_us, post);
    const blocks = Array.isArray(locale.content) ? locale.content : [];
    const lines: string[] = [];
    const attachments: FeishuAttachmentMeta[] = [];

    if (typeof locale.title === 'string' && locale.title.trim().length > 0) {
      lines.push(locale.title.trim());
    }

    for (const block of blocks) {
      const segments = Array.isArray(block) ? block : [block];
      const parts: string[] = [];
      for (const segment of segments) {
        if (!segment || typeof segment !== 'object') continue;
        const record = segment as Record<string, unknown>;
        if (record.tag === 'img' && typeof record.image_key === 'string') {
          attachments.push({
            kind: 'image',
            file_id: record.image_key,
            file_unique_id: record.image_key,
          });
          parts.push('[图片]');
        } else if (typeof record.text === 'string') {
          parts.push(record.text);
        }
      }
      if (parts.length > 0) lines.push(parts.join(''));
    }

    return { text: lines.join('\n'), attachments };
  }

  if (messageType === 'image') {
    const imageKey = asString(parsed.image_key) ?? '';
    return {
      text: '[图片]',
      attachments: imageKey
        ? [{ kind: 'image', file_id: imageKey, file_unique_id: imageKey }]
        : [],
    };
  }

  if (messageType === 'file') {
    const fileKey = asString(parsed.file_key) ?? '';
    const name = asString(parsed.file_name);
    return {
      text: name ? `[文件: ${name}]` : '[文件]',
      attachments: fileKey
        ? [{ kind: 'file', file_id: fileKey, file_unique_id: fileKey, ...(name ? { name } : {}) }]
        : [],
    };
  }

  return { text: '', attachments: [] };
}

function pickFirstObject(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
