import { createReadStream, statSync } from 'node:fs';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { WEB_CHANNEL_ID, WebChannel, type WebMessageAttachmentRef } from '@haro/channel-web';
import { canPerform, readWebAuth, requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv, WebAuthContext } from '../types.js';
import type { WebRuntime } from '../runtime.js';

/**
 * FEAT-031 — `/api/v1/channels/web/*` routes that back the Dashboard chat as
 * a first-class IM channel. The actual persistence + validation lives in
 * `@haro/channel-web` so CLI / scripts / future MCP `send_message` can share
 * the same surface.
 */

type WebContext = Context<ApiKeyAuthEnv>;

export interface ChannelsWebRouteOptions {
  /**
   * Optional broadcaster invoked when the Web Channel emits stream events
   * (inbound user message persisted, outbound agent delta, …). The host —
   * typically `WebSocketManager` — wires this to its session subscribers so
   * the Dashboard receives real-time updates.
   */
  publishStreamEvent?: (sessionId: string, event: unknown) => void;
}

export function createChannelsWebRoute(
  runtime: WebRuntime,
  options: ChannelsWebRouteOptions = {},
): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  let streamUnsubscribe: (() => void) | null = null;
  let lastBoundChannel: WebChannel | null = null;

  /**
   * Resolve the registered Web Channel. Returns `{ channel, enabled }` so
   * read-only routes can serve history even when the channel is disabled
   * (FEAT-031 AC3 read-only mode), while write routes can short-circuit
   * with 503 via `requireEnabled()`.
   */
  function tryWebChannel(): { channel: WebChannel; enabled: boolean } | null {
    const registry = runtime.channelRegistry;
    if (!registry?.has(WEB_CHANNEL_ID)) return null;
    const entry = registry.getEntry(WEB_CHANNEL_ID);
    if (!(entry.channel instanceof WebChannel)) return null;
    if (lastBoundChannel !== entry.channel) {
      streamUnsubscribe?.();
      streamUnsubscribe = options.publishStreamEvent
        ? entry.channel.onStream(options.publishStreamEvent)
        : null;
      lastBoundChannel = entry.channel;
    }
    return { channel: entry.channel, enabled: entry.enabled };
  }

  function disabledResponse(c: WebContext) {
    return c.json(
      {
        error: 'Web channel is unavailable',
        code: 'WEB_CHANNEL_DISABLED',
        message: 'Enable the channel via `haro channel enable web` or the Channels page.',
      },
      503,
    );
  }

  function requireEnabled(c: WebContext): WebChannel | Response {
    const resolved = tryWebChannel();
    if (!resolved) return disabledResponse(c);
    if (!resolved.enabled) return disabledResponse(c);
    return resolved.channel;
  }

  function requireReadable(c: WebContext): WebChannel | Response {
    const resolved = tryWebChannel();
    if (!resolved) return disabledResponse(c);
    return resolved.channel;
  }

  route.get('/sessions', (c) => {
    const channel = requireReadable(c);
    if (channel instanceof Response) return channel;
    const auth = readWebAuth(c);
    const filter: { ownerUserId?: string } = {};
    if (auth && !canPerform(auth.role, 'config-write')) {
      const username = readUsername(auth);
      if (username) filter.ownerUserId = username;
    }
    const sessions = channel.listSessions(filter);
    return c.json({ success: true, data: { items: sessions } });
  });

  route.post('/sessions', requireWebPermission('local-write'), async (c) => {
    const channel = requireEnabled(c);
    if (channel instanceof Response) return channel;
    const body = (await readJsonBody(c)) as { title?: string } | null;
    const ownerUserId = readUsername(readWebAuth(c));
    const session = channel.createSession({
      ...(body?.title ? { title: body.title } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
    });
    return c.json({ success: true, data: session }, 201);
  });

  route.get('/sessions/:id', (c) => {
    const channel = requireReadable(c);
    if (channel instanceof Response) return channel;
    const session = channel.getSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);
    return c.json({ success: true, data: session });
  });

  route.delete('/sessions/:id', requireWebPermission('local-write'), (c) => {
    const channel = requireEnabled(c);
    if (channel instanceof Response) return channel;
    const session = channel.getSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);
    const result = channel.deleteSession(session.sessionId);
    return c.json({ success: true, data: { deleted: result.deleted, sessionId: session.sessionId } });
  });

  route.get('/sessions/:id/messages', (c) => {
    const channel = requireReadable(c);
    if (channel instanceof Response) return channel;
    const session = channel.getSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);
    const before = parseOptionalInt(c.req.query('before'));
    const beforeId = c.req.query('beforeId');
    const limit = parseOptionalInt(c.req.query('limit'));
    const page = channel.listMessages(session.sessionId, {
      ...(before !== undefined ? { before } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json({ success: true, data: page });
  });

  route.post('/sessions/:id/messages', requireWebPermission('local-write'), async (c) => {
    const channel = requireEnabled(c);
    if (channel instanceof Response) return channel;
    const session = channel.getSession(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);

    const body = (await readJsonBody(c)) as
      | { content?: string; attachments?: WebMessageAttachmentRef[]; metadata?: Record<string, unknown> }
      | null;
    if (!body || typeof body.content !== 'string' || body.content.length === 0) {
      return c.json({ error: 'content is required' }, 400);
    }

    const userId = readUsername(readWebAuth(c)) ?? 'anonymous';
    try {
      const result = await channel.submitInbound({
        sessionId: session.sessionId,
        userId,
        content: body.content,
        ...(body.attachments ? { attachments: body.attachments } : {}),
        ...(body.metadata ? { metadata: body.metadata } : {}),
      });
      return c.json({ success: true, data: result.message }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not started/i.test(message)) {
        return c.json({ error: 'Web channel is not started', code: 'WEB_CHANNEL_NOT_STARTED' }, 503);
      }
      throw error;
    }
  });

  route.post('/upload', requireWebPermission('local-write'), async (c) => {
    const channel = requireEnabled(c);
    if (channel instanceof Response) return channel;
    let body: Record<string, string | File> | undefined;
    try {
      body = (await c.req.parseBody()) as Record<string, string | File>;
    } catch (error) {
      return c.json(
        { error: 'Invalid multipart body', message: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
    const sessionIdRaw = body.sessionId;
    const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw : '';
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);
    const session = channel.getSession(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);

    const file = body.file;
    if (!isFileLike(file)) return c.json({ error: 'file is required' }, 400);
    const uploadedBy = readUsername(readWebAuth(c)) ?? 'anonymous';
    const data = Buffer.from(await file.arrayBuffer());
    const result = channel.saveAttachment({
      sessionId: session.sessionId,
      filename: file.name || 'unnamed',
      ...(file.type ? { mimeType: file.type } : {}),
      data,
      uploadedBy,
    });
    if (!result.ok) {
      return c.json({ error: result.error.message, code: result.error.code }, statusForUploadError(result.error.code));
    }
    const { storagePath, ...rest } = result.file;
    void storagePath;
    return c.json({ success: true, data: rest }, 201);
  });

  route.get('/files/:id', (c) => {
    const channel = requireReadable(c);
    if (channel instanceof Response) return channel;
    const file = channel.getFile(c.req.param('id'));
    if (!file) return c.json({ error: 'File not found' }, 404);
    const session = channel.getSession(file.sessionId);
    if (!session) return c.json({ error: 'File session not found' }, 404);
    if (!authorizeSession(c, session)) return c.json({ error: 'Forbidden' }, 403);

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(file.storagePath);
    } catch {
      return c.json({ error: 'File missing on disk', code: 'FILE_MISSING' }, 410);
    }
    if (!stat.isFile()) {
      return c.json({ error: 'File missing on disk', code: 'FILE_MISSING' }, 410);
    }

    c.header('Content-Type', file.mimeType || 'application/octet-stream');
    c.header('Content-Length', String(stat.size));
    c.header(
      'Content-Disposition',
      `attachment; filename="${encodeFilenameForHeader(file.filename)}"`,
    );
    return stream(c, async (s) => {
      const reader = createReadStream(file.storagePath);
      try {
        for await (const chunk of reader) {
          await s.write(chunk as Uint8Array);
        }
      } finally {
        reader.close();
      }
    });
  });

  return route;
}

async function readJsonBody(c: WebContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

interface FileLike {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isFileLike(value: unknown): value is FileLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.arrayBuffer === 'function' &&
    typeof candidate.type === 'string'
  );
}

function readUsername(auth: WebAuthContext | undefined): string | undefined {
  if (!auth) return undefined;
  if (auth.kind === 'session') return auth.user.username;
  return undefined;
}

function authorizeSession(
  c: WebContext,
  session: { ownerUserId: string | null },
): boolean {
  const auth = readWebAuth(c);
  if (!auth) return false;
  // Owners / admins can see all sessions. Everyone else is locked to the
  // sessions they own (`ownerUserId === username`). Sessions with a null
  // owner predate the per-user binding (or were created via legacy API
  // key); keep them visible to admin-tier callers only so a freshly-added
  // viewer can't snoop on the bootstrap user's history.
  if (canPerform(auth.role, 'config-write')) return true;
  if (!session.ownerUserId) return false;
  const username = readUsername(auth);
  return username !== undefined && username === session.ownerUserId;
}

function statusForUploadError(code: string): 400 | 413 | 415 {
  if (code === 'too_large' || code === 'quota_exceeded') return 413;
  if (code === 'unsupported_mime' || code === 'forbidden_extension') return 415;
  return 400;
}

function encodeFilenameForHeader(filename: string): string {
  return filename.replace(/[\\"]/g, '_').replace(/[\r\n]/g, '');
}
