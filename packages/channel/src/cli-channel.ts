import { createInterface, type Interface } from 'node:readline/promises';
import type {
  ChannelCapabilities,
  ChannelContext,
  InboundMessage,
  MessageChannel,
  OutboundMessage,
} from './protocol.js';

export interface CliChannelOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  now?: () => Date;
  prompt?: string;
  userId?: string;
  startRepl?: boolean;
  terminal?: boolean;
  sessionIdFactory?: () => string;
  renderBanner?: (input: { provider: string; model: string }) => Promise<void>;
  onLocalCommand?: (line: string, channel: CliChannel) => Promise<boolean>;
}

export class CliChannel implements MessageChannel {
  readonly id = 'cli';

  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly error: NodeJS.WritableStream;
  private readonly now: () => Date;
  private readonly prompt: string;
  private readonly userId: string;
  private readonly startRepl: boolean;
  private readonly terminal: boolean;
  private readonly sessionIdFactory: () => string;
  private readonly onLocalCommand?: (line: string, channel: CliChannel) => Promise<boolean>;
  private readonly renderBanner?: (input: { provider: string; model: string }) => Promise<void>;

  private ctx: ChannelContext | null = null;
  private rl: Interface | null = null;
  private stopped = false;
  private conversationId: string;

  constructor(options: CliChannelOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.error = options.error ?? process.stderr;
    this.now = options.now ?? (() => new Date());
    this.prompt = options.prompt ?? '> ';
    this.userId = options.userId ?? 'cli-user';
    this.startRepl = options.startRepl ?? true;
    this.terminal =
      options.terminal ?? Boolean((this.output as NodeJS.WritableStream & { isTTY?: boolean }).isTTY);
    this.sessionIdFactory = options.sessionIdFactory ?? defaultConversationId;
    this.onLocalCommand = options.onLocalCommand;
    this.renderBanner = options.renderBanner;
    this.conversationId = this.sessionIdFactory();
  }

  capabilities(): ChannelCapabilities {
    return {
      streaming: false,
      richText: false,
      attachments: false,
      threading: true,
      requiresWebhook: false,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.ctx = ctx;
    this.stopped = false;
    if (!this.startRepl) return;

    this.rl = createInterface({
      input: this.input,
      output: this.output,
      terminal: this.terminal,
    });
    this.rl.on('SIGINT', () => {
      void this.stop();
    });

    try {
      this.output.write(this.prompt);
      for await (const line of this.rl) {
        if (this.stopped) break;
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          this.output.write(this.prompt);
          continue;
        }
        if (trimmed.startsWith('/') && this.onLocalCommand) {
          const consumed = await this.onLocalCommand(trimmed, this);
          if (consumed) {
            this.output.write(this.prompt);
            continue;
          }
        }
        await this.submitText(trimmed);
        if (!this.stopped) this.output.write(this.prompt);
      }
    } finally {
      this.rl?.close();
      this.rl = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.rl?.close();
    this.rl = null;
  }

  async send(_sessionId: string, msg: OutboundMessage): Promise<void> {
    const text = formatOutbound(msg);
    if (text.length === 0) return;
    if (msg.delta) {
      this.output.write(text);
      return;
    }
    this.output.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  async submitText(content: string, meta: Record<string, unknown> = {}): Promise<void> {
    if (!this.ctx) {
      throw new Error('CliChannel.start() must be called before submitText()');
    }
    await this.ctx.onInbound({
      sessionId: this.conversationId,
      userId: this.userId,
      channelId: this.id,
      type: 'text',
      content,
      timestamp: this.now().toISOString(),
      meta,
    } satisfies InboundMessage);
  }

  resetConversation(): void {
    this.conversationId = this.sessionIdFactory();
  }

  async showBanner(input: { provider: string; model: string }): Promise<void> {
    if (this.renderBanner) {
      await this.renderBanner(input);
      return;
    }
    const title = [
      'Haro v0.1.0 — 自进化多 Agent 平台',
      `当前 Provider: ${input.provider} (${input.model})`,
      '输入 /help 查看可用命令',
    ].join('\n');

    if (this.terminal) {
      try {
        const { intro } = await import('@clack/prompts');
        intro(title);
        return;
      } catch {
        // Fall back to plain output in non-interactive / mocked environments.
      }
    }
    this.output.write(`${title}\n`);
  }

  writeLine(text: string): void {
    this.output.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  writeError(text: string): void {
    this.error.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

function defaultConversationId(): string {
  return `cli-${Math.random().toString(16).slice(2)}`;
}

function formatOutbound(msg: OutboundMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return JSON.stringify(msg.content, null, 2);
}
