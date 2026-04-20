export interface ChannelLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface ChannelCapabilities {
  streaming: boolean;
  richText: boolean;
  attachments: boolean;
  threading: boolean;
  requiresWebhook: boolean;
  extended?: Record<string, unknown>;
}

export interface InboundMessage {
  sessionId: string;
  userId: string;
  channelId: string;
  type: 'text' | 'file' | 'image' | 'command' | 'event';
  content: unknown;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface OutboundMessage {
  type: 'text' | 'markdown' | 'card' | 'file' | 'image';
  content: unknown;
  delta?: boolean;
  replyTo?: string;
}

export interface ChannelContext {
  config: Record<string, unknown>;
  onInbound(msg: InboundMessage): Promise<void>;
  logger: ChannelLogger;
}

export interface MessageChannel {
  readonly id: string;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  send(sessionId: string, msg: OutboundMessage): Promise<void>;
  capabilities(): ChannelCapabilities;
  healthCheck(): Promise<boolean>;
}

export interface ChannelDoctorResult {
  ok: boolean;
  code?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ChannelSetupResult {
  ok: boolean;
  config: Record<string, unknown>;
  message: string;
}

export interface ChannelSetupContext {
  root: string;
  config: Record<string, unknown>;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  logger: ChannelLogger;
}

export interface ManagedChannel extends MessageChannel {
  doctor?(ctx: ChannelSetupContext): Promise<ChannelDoctorResult>;
  setup?(ctx: ChannelSetupContext): Promise<ChannelSetupResult>;
}

export interface ChannelRegistration {
  channel: ManagedChannel;
  enabled?: boolean;
  removable?: boolean;
  source?: 'builtin' | 'package';
  displayName?: string;
}

export interface ChannelRegistryEntry {
  id: string;
  channel: ManagedChannel;
  enabled: boolean;
  removable: boolean;
  source: 'builtin' | 'package';
  displayName: string;
}
