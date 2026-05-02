import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AgentEvent, RunAgentResult } from '@haro/core';
import { authenticateWebSession, readAuthStatus } from '../auth-store.js';
import { WEB_SESSION_COOKIE_NAME } from '../auth.js';
import { getRunner, type WebRuntime } from '../runtime.js';
import type { WebLogger } from '../types.js';
import { streamAgentRun } from './streamer.js';
import type { ClientMessage, ServerMessage, SystemMetrics, WebSocketLike } from './types.js';

interface ClientState extends WebSocketLike {
  id: string;
  authenticated: boolean;
  channels: Set<string>;
  sessionIds: Set<string>;
  cancelledSessionIds: Set<string>;
  pending: Buffer;
  fragmentOpcode: number | null;
  fragmentChunks: Buffer[];
  fragmentLength: number;
  closed: boolean;
  cookieSessionToken?: string;
  sendMessage(message: ServerMessage): void;
}

const MAX_PENDING_BYTES = 16 * 1024 * 1024;

interface PendingChatSession {
  agentId: string;
  provider?: string;
  model?: string;
}

export class WebSocketManager {
  private readonly clients = new Set<ClientState>();
  private readonly sessionClients = new Map<string, Set<ClientState>>();
  private readonly pendingChatSessions = new Map<string, PendingChatSession>();
  private readonly activeRuns = new Set<string>();
  private readonly runtime: WebRuntime;
  private readonly logger: WebLogger;

  constructor(runtime: WebRuntime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
  }

  get activeSessionCount(): number {
    return this.activeRuns.size;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (request.url?.split('?')[0] !== '/ws') return;
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    if (head.length > 0) socket.unshift(head);

    const client = this.createClient(socket, readCookie(request.headers.cookie, WEB_SESSION_COOKIE_NAME));
    this.clients.add(client);
    socket.on('data', (chunk) => this.handleData(client, chunk));
    socket.on('close', () => this.removeClient(client));
    socket.on('end', () => this.removeClient(client));
    socket.on('error', () => this.removeClient(client));
  }

  publishEvent(sessionId: string, event: AgentEvent): void {
    this.broadcastToSession(sessionId, { type: 'event.stream', sessionId, event });
  }

  publishResult(sessionId: string, result: RunAgentResult): void {
    this.broadcastToSession(sessionId, { type: 'event.result', sessionId, result });
  }

  publishError(sessionId: string, error: string): void {
    this.broadcastToSession(sessionId, { type: 'event.error', sessionId, error });
  }

  publishSessionUpdate(sessionId: string, status: string): void {
    const message: ServerMessage = { type: 'session.update', sessionId, status };
    this.broadcastToSession(sessionId, message);
    for (const client of this.clients) {
      if (client.cancelledSessionIds.has(sessionId)) continue;
      if (client.authenticated && client.channels.has('sessions')) client.sendMessage(message);
    }
  }

  systemMetrics(): SystemMetrics {
    return {
      activeSessions: this.activeRuns.size,
      dbConnections: 0,
      gatewayConnected: false,
      uptimeSeconds: Math.floor((Date.now() - this.runtime.startedAt) / 1000),
    };
  }

  private createClient(socket: Duplex, cookieSessionToken?: string): ClientState {
    const client: ClientState = {
      id: randomBytes(8).toString('hex'),
      authenticated: false,
      channels: new Set(),
      sessionIds: new Set(),
      cancelledSessionIds: new Set(),
      pending: Buffer.alloc(0),
      fragmentOpcode: null,
      fragmentChunks: [],
      fragmentLength: 0,
      closed: false,
      ...(cookieSessionToken ? { cookieSessionToken } : {}),
      send: (data) => {
        if (client.closed) return;
        socket.write(encodeFrame(data));
      },
      close: (code = 1000, reason = '') => {
        if (client.closed) return;
        client.closed = true;
        socket.write(encodeFrame(Buffer.concat([writeCloseCode(code), Buffer.from(reason)]), 0x8));
        socket.end();
      },
      sendMessage: (message) => {
        if (client.closed) return;
        socket.write(encodeFrame(JSON.stringify(message)));
      },
    };
    return client;
  }

  private handleData(client: ClientState, chunk: Buffer): void {
    if (client.closed) return;
    if (client.pending.length + chunk.length > MAX_PENDING_BYTES) {
      this.logger.warn?.({ clientId: client.id, pendingBytes: client.pending.length, chunkBytes: chunk.length }, 'websocket pending buffer overflow');
      client.close(1009, 'message too big');
      return;
    }
    client.pending = client.pending.length === 0 ? chunk : Buffer.concat([client.pending, chunk]);

    while (client.pending.length > 0) {
      const frame = decodeFrame(client.pending);
      if (!frame) return;
      client.pending = client.pending.subarray(frame.consumed);

      if (frame.opcode === 0x8) {
        client.close();
        return;
      }
      if (frame.opcode === 0x9 || frame.opcode === 0xa) {
        // ping/pong — keepalive frames, no application handling
        continue;
      }

      if (frame.opcode === 0x0) {
        if (client.fragmentOpcode === null) {
          client.sendMessage({ type: 'event.error', sessionId: 'protocol', error: 'Unexpected continuation frame' });
          client.close(1002, 'continuation without start');
          return;
        }
        if (client.fragmentLength + frame.data.length > MAX_PENDING_BYTES) {
          client.close(1009, 'message too big');
          return;
        }
        client.fragmentChunks.push(frame.data);
        client.fragmentLength += frame.data.length;
        if (frame.fin) {
          const opcode = client.fragmentOpcode;
          const data = Buffer.concat(client.fragmentChunks, client.fragmentLength);
          client.fragmentOpcode = null;
          client.fragmentChunks = [];
          client.fragmentLength = 0;
          this.dispatchMessage(client, opcode, data);
        }
        continue;
      }

      if (frame.opcode !== 0x1 && frame.opcode !== 0x2) {
        client.sendMessage({ type: 'event.error', sessionId: 'protocol', error: `Unsupported opcode 0x${frame.opcode.toString(16)}` });
        client.close(1003, 'unsupported opcode');
        return;
      }

      if (!frame.fin) {
        if (client.fragmentOpcode !== null) {
          client.sendMessage({ type: 'event.error', sessionId: 'protocol', error: 'Nested data frame during fragmented message' });
          client.close(1002, 'nested fragmented message');
          return;
        }
        client.fragmentOpcode = frame.opcode;
        client.fragmentChunks.push(frame.data);
        client.fragmentLength = frame.data.length;
        continue;
      }

      this.dispatchMessage(client, frame.opcode, frame.data);
    }
  }

  private dispatchMessage(client: ClientState, opcode: number, data: Buffer): void {
    if (opcode !== 0x1) return; // only text frames carry our protocol
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      client.sendMessage({ type: 'authenticated', ok: false });
      return;
    }
    void this.handleMessage(client, parsed);
  }

  private async handleMessage(client: ClientState, raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message.ok) {
      client.sendMessage({ type: 'event.error', sessionId: 'protocol', error: message.error });
      return;
    }

    if (message.value.type === 'authenticate') {
      client.authenticated = this.authenticateClient(message.value.token ?? client.cookieSessionToken);
      client.sendMessage({ type: 'authenticated', ok: client.authenticated });
      if (client.authenticated) client.sendMessage({ type: 'system.status', metrics: this.systemMetrics() });
      return;
    }

    if (!client.authenticated) {
      client.sendMessage({ type: 'authenticated', ok: false });
      return;
    }

    switch (message.value.type) {
      case 'subscribe':
        client.channels.add(message.value.channel);
        if (message.value.sessionId) this.subscribeSession(client, message.value.sessionId);
        if (message.value.channel === 'system') {
          client.sendMessage({ type: 'system.status', metrics: this.systemMetrics() });
        }
        return;
      case 'chat.start':
        await this.handleChatStart(client, message.value);
        return;
      case 'chat.message':
        await this.handleChatMessage(client, message.value.sessionId, message.value.content);
        return;
      case 'chat.cancel':
        this.handleChatCancel(client, message.value.sessionId);
        return;
    }
  }

  private async handleChatStart(
    client: ClientState,
    message: Extract<ClientMessage, { type: 'chat.start' }>,
  ): Promise<void> {
    if (!this.runtime.agentRegistry.tryGet(message.agentId)) {
      client.sendMessage({ type: 'event.error', sessionId: 'protocol', error: 'Agent not found' });
      return;
    }
    const sessionId = randomUUID();
    this.pendingChatSessions.set(sessionId, {
      agentId: message.agentId,
      ...(message.provider ? { provider: message.provider } : {}),
      ...(message.model ? { model: message.model } : {}),
    });
    this.subscribeSession(client, sessionId);
    this.publishSessionUpdate(sessionId, 'pending');
    if (message.content) {
      await this.handleChatMessage(client, sessionId, message.content);
    }
  }

  private async handleChatMessage(client: ClientState, sessionId: string, content: string): Promise<void> {
    const pending = this.pendingChatSessions.get(sessionId);
    if (!pending) {
      client.sendMessage({ type: 'event.error', sessionId, error: 'Unknown or already completed chat session' });
      return;
    }
    this.pendingChatSessions.delete(sessionId);
    this.activeRuns.add(sessionId);
    this.publishSessionUpdate(sessionId, 'running');
    try {
      const result = await streamAgentRun({
        runner: getRunner(this.runtime, () => sessionId),
        manager: this,
        logger: this.logger,
        input: {
          task: content,
          agentId: pending.agentId,
          ...(pending.provider ? { provider: pending.provider } : {}),
          ...(pending.model ? { model: pending.model } : {}),
          continueLatestSession: false,
        },
      });
      this.logger.info?.({ sessionId: result.sessionId }, 'websocket chat run completed');
    } catch (error) {
      this.publishError(sessionId, error instanceof Error ? error.message : String(error));
      this.publishSessionUpdate(sessionId, 'failed');
    } finally {
      this.activeRuns.delete(sessionId);
    }
  }

  private handleChatCancel(client: ClientState, sessionId: string): void {
    if (this.pendingChatSessions.delete(sessionId)) {
      client.cancelledSessionIds.add(sessionId);
      client.sendMessage({ type: 'session.update', sessionId, status: 'cancelled' });
      return;
    }
    client.cancelledSessionIds.add(sessionId);
    client.sendMessage({ type: 'session.update', sessionId, status: 'cancelled' });
  }

  private subscribeSession(client: ClientState, sessionId: string): void {
    client.sessionIds.add(sessionId);
    let clients = this.sessionClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      this.sessionClients.set(sessionId, clients);
    }
    clients.add(client);
    this.logger.info?.({ sessionId, clientCount: clients.size }, 'websocket client subscribed');
  }

  private broadcastToSession(sessionId: string, message: ServerMessage): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients) return;
    for (const client of clients) {
      if (client.cancelledSessionIds.has(sessionId)) continue;
      if (client.authenticated) client.sendMessage(message);
    }
    this.logger.info?.({ eventType: message.type, sessionId, clientCount: clients.size }, 'websocket message broadcast');
  }

  private removeClient(client: ClientState): void {
    if (!this.clients.delete(client)) return;
    for (const sessionId of client.sessionIds) {
      const clients = this.sessionClients.get(sessionId);
      clients?.delete(client);
      if (clients?.size === 0) this.sessionClients.delete(sessionId);
    }
  }

  private authenticateClient(token?: string): boolean {
    const expected = process.env.HARO_WEB_API_KEY;
    if (token && expected && token === expected) return true;
    if (token && authenticateWebSession(this.runtime, token)) return true;
    if (!expected) {
      try {
        return readAuthStatus(this.runtime).userCount === 0;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function parseClientMessage(raw: unknown): { ok: true; value: ClientMessage } | { ok: false; error: string } {
  if (!isRecord(raw) || typeof raw.type !== 'string') return { ok: false, error: 'Invalid client message' };
  switch (raw.type) {
    case 'authenticate':
      return typeof raw.token === 'string' || raw.token === undefined
        ? { ok: true, value: { type: 'authenticate', ...(raw.token ? { token: raw.token } : {}) } }
        : { ok: false, error: 'Invalid authenticate token' };
    case 'chat.start':
      if (typeof raw.agentId !== 'string' || raw.agentId.length === 0) return { ok: false, error: 'Invalid agentId' };
      return {
        ok: true,
        value: {
          type: 'chat.start',
          agentId: raw.agentId,
          ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
          ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
          ...(typeof raw.content === 'string' ? { content: raw.content } : {}),
        },
      };
    case 'chat.message':
      return typeof raw.sessionId === 'string' && typeof raw.content === 'string'
        ? { ok: true, value: { type: 'chat.message', sessionId: raw.sessionId, content: raw.content } }
        : { ok: false, error: 'Invalid chat.message' };
    case 'chat.cancel':
      return typeof raw.sessionId === 'string'
        ? { ok: true, value: { type: 'chat.cancel', sessionId: raw.sessionId } }
        : { ok: false, error: 'Invalid chat.cancel' };
    case 'subscribe':
      if (raw.channel !== 'system' && raw.channel !== 'sessions' && raw.channel !== 'gateway') {
        return { ok: false, error: 'Invalid subscribe channel' };
      }
      return {
        ok: true,
        value: {
          type: 'subscribe',
          channel: raw.channel,
          ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
        },
      };
    default:
      return { ok: false, error: `Unsupported message type '${raw.type}'` };
  }
}

function encodeFrame(data: string | Buffer, opcode = 0x1): Buffer {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const length = payload.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

interface DecodedFrame {
  fin: boolean;
  opcode: number;
  data: Buffer;
  consumed: number;
}

export function decodeFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) return null;
  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const data = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < data.length; index += 1) data[index] = data[index]! ^ mask[index % 4]!;
  }
  return { fin, opcode, data, consumed: offset + length };
}

function writeCloseCode(code: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(code, 0);
  return buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
