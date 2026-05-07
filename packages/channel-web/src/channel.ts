import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  readJsonFile,
  writeJsonFile,
  type ChannelCapabilities,
  type ChannelContext,
  type ChannelDoctorResult,
  type ChannelLogger,
  type ChannelSetupContext,
  type ChannelSetupResult,
  type InboundMessage,
  type ManagedChannel,
  type OutboundMessage,
} from '@haro/channel';
import {
  WebChannelStore,
  type WebFileRecord,
  type WebMessageAttachmentRef,
  type WebMessageInput,
  type WebMessageRecord,
  type WebSessionRecord,
} from './persistence/messages.js';
import {
  deleteSessionUploadDir,
  deleteUploadFile,
  saveUploadFile,
} from './persistence/files.js';
import {
  outboundToStreamEvent,
  type WebChannelStreamEvent,
} from './stream.js';
import {
  resolveLimits,
  validateUpload,
  type UploadValidationConfig,
  type UploadValidationError,
} from './upload.js';

/**
 * Web Channel — browser-as-IM adapter (FEAT-031).
 *
 * Unlike Feishu/Telegram, the Web Channel does not own a transport: the
 * Dashboard talks to web-api routes over HTTP/WS, and web-api delegates
 * inbound user messages here via `submitInbound()`. The channel persists
 * history, validates uploads, and pushes outbound deltas back to the
 * Dashboard via the stream subscriber registered by the host.
 */

export const WEB_CHANNEL_ID = 'web';

interface WebChannelState {
  enabled: boolean;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastError?: string;
}

export interface WebChannelOptions {
  root: string;
  logger: ChannelLogger;
  config?: Record<string, unknown>;
  /** Override session ID generator (used in tests for determinism). */
  createSessionId?: () => string;
  /** Override message ID generator (used in tests for determinism). */
  createMessageId?: () => string;
  /** Override file ID generator (used in tests for determinism). */
  createFileId?: () => string;
}

export interface SubmitInboundInput {
  sessionId: string;
  userId: string;
  content: string;
  attachments?: readonly WebMessageAttachmentRef[];
  metadata?: Record<string, unknown>;
}

export interface SubmitInboundResult {
  message: WebMessageRecord;
}

export interface RecordOutboundInput {
  sessionId: string;
  message: OutboundMessage;
  agentId?: string;
}

export interface RecordOutboundResult {
  message: WebMessageRecord;
}

export interface SaveAttachmentInput {
  sessionId: string;
  filename: string;
  mimeType?: string;
  data: Buffer;
  uploadedBy: string;
  config?: UploadValidationConfig;
}

export type SaveAttachmentResult =
  | { ok: true; file: WebFileRecord }
  | { ok: false; error: UploadValidationError };

export type StreamSubscriber = (sessionId: string, event: WebChannelStreamEvent) => void;

export class WebChannel implements ManagedChannel {
  readonly id = WEB_CHANNEL_ID;

  private readonly logger: ChannelLogger;
  private readonly stateFile: string;
  private readonly storageRoot: string;
  private readonly store: WebChannelStore;
  private readonly createSessionId: () => string;
  private readonly createMessageId: () => string;
  private readonly createFileId: () => string;
  private readonly baseConfig: Record<string, unknown>;
  private readonly subscribers = new Set<StreamSubscriber>();
  private inboundHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private started = false;
  private uploadConfig: UploadValidationConfig;

  constructor(options: WebChannelOptions) {
    this.logger = options.logger;
    this.baseConfig = options.config ?? {};
    const dir = join(options.root, 'channels', this.id);
    this.stateFile = join(dir, 'state.json');
    this.storageRoot = join(dir, 'files');
    this.store = new WebChannelStore(join(dir, 'sessions.sqlite'), this.logger);
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.createMessageId = options.createMessageId ?? randomUUID;
    this.createFileId = options.createFileId ?? randomUUID;
    this.uploadConfig = readUploadConfig(this.baseConfig);
  }

  capabilities(): ChannelCapabilities {
    return {
      streaming: true,
      richText: true,
      attachments: true,
      threading: false,
      requiresWebhook: false,
      extended: { history: true, group: false },
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async doctor(_ctx: ChannelSetupContext): Promise<ChannelDoctorResult> {
    return {
      ok: true,
      message: 'Web channel ready',
      details: {
        storageRoot: this.storageRoot,
        sessions: this.store.listSessions().length,
      },
    };
  }

  async setup(ctx: ChannelSetupContext): Promise<ChannelSetupResult> {
    const config: Record<string, unknown> = { ...this.baseConfig, ...ctx.config, enabled: true };
    return {
      ok: true,
      config,
      message: 'Web channel enabled — Dashboard chat is live',
    };
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.uploadConfig = readUploadConfig({ ...this.baseConfig, ...ctx.config });
    this.inboundHandler = ctx.onInbound;
    this.started = true;
    this.persistState({ enabled: true });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.inboundHandler = null;
    // Keep the SQLite handle and stream subscribers so a subsequent
    // `enable web` → `start()` on the same channel instance works without
    // re-creating the channel (Codex review §E/§G). The handle is closed
    // for good only when the host calls `dispose()` or destroys the
    // ChannelRegistry — same lifetime contract as Feishu's session store.
    this.persistState({ enabled: false });
  }

  /**
   * Release retained resources. Call this only when the host is throwing
   * away the channel instance entirely (process exit, registry teardown).
   * Routine `stop()` deliberately keeps the SQLite store open so that
   * `enable → disable → enable` flips work in-process.
   */
  dispose(): void {
    this.subscribers.clear();
    this.store.close();
  }

  /**
   * Outbound message from agent → user. Persists into history and broadcasts
   * a stream event so the Dashboard can render the delta in real time.
   */
  async send(sessionId: string, msg: OutboundMessage): Promise<void> {
    const record = this.recordOutbound({ sessionId, message: msg });
    const event = outboundToStreamEvent(sessionId, msg, record.message.id);
    this.broadcast(sessionId, event);
  }

  // --- Web-channel-specific surface (called by web-api routes) -------------

  isStarted(): boolean {
    return this.started;
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  uploadLimits(): ReturnType<typeof resolveLimits> {
    return resolveLimits(this.uploadConfig);
  }

  createSession(input: { ownerUserId?: string; title?: string } = {}): WebSessionRecord {
    const sessionId = this.createSessionId();
    return this.store.upsertSession({
      sessionId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
    });
  }

  listSessions(filter: { ownerUserId?: string } = {}): WebSessionRecord[] {
    return this.store.listSessions(filter);
  }

  getSession(sessionId: string): WebSessionRecord | undefined {
    return this.store.getSession(sessionId);
  }

  deleteSession(sessionId: string): { deleted: boolean } {
    const result = this.store.deleteSession(sessionId);
    if (result.deleted) {
      deleteSessionUploadDir({ storageRoot: this.storageRoot, sessionId });
    }
    return { deleted: result.deleted };
  }

  listMessages(
    sessionId: string,
    options: { before?: number; beforeId?: string; limit?: number } = {},
  ): { items: WebMessageRecord[]; nextCursor: number | null; nextCursorId: string | null } {
    return this.store.listMessages(sessionId, options);
  }

  /**
   * Inbound user message. Persists, then dispatches to the channel's onInbound
   * handler so the runtime can route it to an agent (R4 — equivalent to
   * Feishu/Telegram inbound dispatch).
   */
  async submitInbound(input: SubmitInboundInput): Promise<SubmitInboundResult> {
    if (!this.started || !this.inboundHandler) {
      throw new Error('Web channel is not started');
    }
    this.store.upsertSession({ sessionId: input.sessionId, ownerUserId: input.userId });
    const messageId = this.createMessageId();
    const createdAt = Date.now();
    const persisted = this.store.appendMessage({
      id: messageId,
      sessionId: input.sessionId,
      role: 'user',
      content: input.content,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt,
    });
    this.persistState({ enabled: true, lastInboundAt: new Date(createdAt).toISOString() });
    this.broadcast(input.sessionId, { kind: 'message', message: persisted });
    const inbound: InboundMessage = {
      sessionId: input.sessionId,
      userId: input.userId,
      channelId: this.id,
      type: this.inferInboundType(input.content, input.attachments),
      content: input.content,
      timestamp: new Date(createdAt).toISOString(),
      meta: {
        messageId,
        attachments: input.attachments ?? [],
        ...(input.metadata ?? {}),
      },
    };
    await this.inboundHandler(inbound);
    return { message: persisted };
  }

  recordOutbound(input: RecordOutboundInput): RecordOutboundResult {
    const messageId = this.createMessageId();
    const createdAt = Date.now();
    const persisted = this.store.appendMessage(buildOutboundMessageInput({
      id: messageId,
      createdAt,
      sessionId: input.sessionId,
      message: input.message,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    }));
    this.persistState({ enabled: this.started, lastOutboundAt: new Date(createdAt).toISOString() });
    return { message: persisted };
  }

  saveAttachment(input: SaveAttachmentInput): SaveAttachmentResult {
    const usage = this.store.sessionUsageBytes(input.sessionId);
    const validation = validateUpload({
      filename: input.filename,
      size: input.data.length,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      sessionUsageBytes: usage,
      config: input.config ?? this.uploadConfig,
    });
    if (!validation.ok) return { ok: false, error: validation.error };

    const fileId = this.createFileId();
    const { storagePath } = saveUploadFile({
      storageRoot: this.storageRoot,
      sessionId: input.sessionId,
      fileId,
      filename: validation.value.filename,
      data: input.data,
    });

    try {
      const record = this.store.recordFile({
        id: fileId,
        sessionId: input.sessionId,
        filename: validation.value.filename,
        size: validation.value.size,
        mimeType: validation.value.mimeType,
        storagePath,
        uploadedBy: input.uploadedBy,
      });
      return { ok: true, file: record };
    } catch (error) {
      // Roll back the on-disk write if the DB insert fails — keeps the
      // attachment ledger consistent with the storage directory.
      deleteUploadFile(storagePath);
      throw error;
    }
  }

  getFile(fileId: string): WebFileRecord | undefined {
    return this.store.getFile(fileId);
  }

  /**
   * Subscribe to stream events for *all* sessions. Subscriber should filter
   * by sessionId on its side (the host typically multiplexes events to
   * connected clients keyed by their subscribed session).
   */
  onStream(subscriber: StreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /**
   * FEAT-034 — broadcast a structured `StreamEvent` to subscribers wrapped in
   * the `kind: 'stream'` envelope. Used by the runtime/executor to forward
   * thinking / tool / hook / usage signals alongside the legacy `agent`
   * deltas. The event is broadcast as-is; subscribers (web-api → WebSocket)
   * filter by sessionId.
   */
  publishStreamEvent(sessionId: string, event: WebChannelStreamEvent): void {
    this.broadcast(sessionId, event);
  }

  // --- internals -----------------------------------------------------------

  private broadcast(sessionId: string, event: WebChannelStreamEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(sessionId, event);
      } catch (error) {
        this.logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'WebChannel stream subscriber threw — continuing',
        );
      }
    }
  }

  private inferInboundType(content: string, attachments?: readonly WebMessageAttachmentRef[]): InboundMessage['type'] {
    if (attachments && attachments.length > 0) {
      const first = attachments[0]!;
      const mime = (first.mimeType ?? '').toLowerCase();
      if (mime.startsWith('image/')) return 'image';
      return 'file';
    }
    return content.length > 0 ? 'text' : 'event';
  }

  private persistState(patch: Partial<WebChannelState>): void {
    const current = readJsonFile<WebChannelState>(this.stateFile, { enabled: false });
    const next: WebChannelState = { ...current, ...patch };
    writeJsonFile(this.stateFile, next);
  }
}

function defaultSessionId(): string {
  return `web-${randomUUID()}`;
}

function readUploadConfig(config: Record<string, unknown>): UploadValidationConfig {
  const raw = (config?.upload as Record<string, unknown> | undefined) ?? {};
  return {
    ...(typeof raw.imageMaxBytes === 'number' ? { imageMaxBytes: raw.imageMaxBytes } : {}),
    ...(typeof raw.documentMaxBytes === 'number' ? { documentMaxBytes: raw.documentMaxBytes } : {}),
    ...(typeof raw.perSessionQuotaBytes === 'number'
      ? { perSessionQuotaBytes: raw.perSessionQuotaBytes }
      : {}),
  };
}

function buildOutboundMessageInput(input: {
  id: string;
  createdAt: number;
  sessionId: string;
  message: OutboundMessage;
  agentId?: string;
}): WebMessageInput {
  const role: WebMessageInput['role'] = 'assistant';
  const content =
    typeof input.message.content === 'string'
      ? input.message.content
      : input.message.content;
  return {
    id: input.id,
    sessionId: input.sessionId,
    role,
    content,
    metadata: {
      kind: input.message.type,
      ...(input.message.delta ? { delta: true } : {}),
      ...(input.message.replyTo ? { replyTo: input.message.replyTo } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    },
    createdAt: input.createdAt,
  };
}
