import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { ChannelLogger } from '@haro/channel';

/**
 * FEAT-031 R2/R7 — message and session persistence for the Web Channel.
 *
 * Schema notes:
 * - `web_messages` is a time-series of structured chat content.
 * - `web_files` records uploaded artefacts (storage path, size, mime).
 * - `web_sessions` is the master session registry — Memory Fabric is the
 *   authoritative session store for *Haro* sessions, but the channel needs
 *   its own minimal record so the Dashboard can list channel-scoped sessions
 *   without hitting Memory Fabric on every render.
 */

const NOOP_LOGGER: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface WebSessionRecord {
  sessionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUserId: string | null;
}

export interface WebMessageInput {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  attachments?: readonly WebMessageAttachmentRef[];
  metadata?: Record<string, unknown>;
  /** Epoch milliseconds — defaults to Date.now() when omitted. */
  createdAt?: number;
}

export interface WebMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  attachments: WebMessageAttachmentRef[];
  metadata: Record<string, unknown>;
  /** Epoch milliseconds for cursor pagination. */
  createdAt: number;
}

export interface WebMessageAttachmentRef {
  fileId: string;
  filename: string;
  mimeType?: string;
  size?: number;
}

export interface WebFileInput {
  id: string;
  sessionId: string;
  filename: string;
  size: number;
  mimeType: string;
  storagePath: string;
  uploadedBy: string;
  createdAt?: number;
}

export interface WebFileRecord {
  id: string;
  sessionId: string;
  filename: string;
  size: number;
  mimeType: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: number;
}

export interface ListMessagesOptions {
  /** Cursor: only return messages created strictly before this ms timestamp. */
  before?: number;
  /**
   * Tie-break for the `before` cursor — id of the message at the page
   * boundary, so two messages sharing a millisecond don't get split across
   * pages. Required when more than one message can share a `created_at`.
   */
  beforeId?: string;
  /** Page size, clamped to [1, 200]. */
  limit?: number;
}

export class WebChannelStore {
  private readonly db: Database.Database;
  private readonly logger: ChannelLogger;
  private closed = false;

  constructor(file: string, logger?: ChannelLogger) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.logger = logger ?? NOOP_LOGGER;
    this.bootstrap();
  }

  /** Insert-or-touch a session row; returns the persisted record. */
  upsertSession(input: { sessionId: string; title?: string | null; ownerUserId?: string | null }): WebSessionRecord {
    const now = new Date().toISOString();
    const existing = this.getSession(input.sessionId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE web_sessions
              SET updated_at = @updatedAt,
                  title = COALESCE(@title, title),
                  owner_user_id = COALESCE(@ownerUserId, owner_user_id)
            WHERE session_id = @sessionId`,
        )
        .run({
          sessionId: input.sessionId,
          updatedAt: now,
          title: input.title ?? null,
          ownerUserId: input.ownerUserId ?? null,
        });
      return this.getSession(input.sessionId)!;
    }
    this.db
      .prepare(
        `INSERT INTO web_sessions (session_id, title, owner_user_id, created_at, updated_at)
         VALUES (@sessionId, @title, @ownerUserId, @createdAt, @updatedAt)`,
      )
      .run({
        sessionId: input.sessionId,
        title: input.title ?? null,
        ownerUserId: input.ownerUserId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return this.getSession(input.sessionId)!;
  }

  getSession(sessionId: string): WebSessionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT session_id, title, owner_user_id, created_at, updated_at
           FROM web_sessions
          WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string;
          title: string | null;
          owner_user_id: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return row ? rowToSession(row) : undefined;
  }

  listSessions(options: { ownerUserId?: string; limit?: number } = {}): WebSessionRecord[] {
    const limit = clampInt(options.limit, 1, 500, 100);
    const params: unknown[] = [];
    let where = '';
    if (options.ownerUserId !== undefined) {
      where = 'WHERE owner_user_id = ?';
      params.push(options.ownerUserId);
    }
    const rows = this.db
      .prepare(
        `SELECT session_id, title, owner_user_id, created_at, updated_at
           FROM web_sessions
           ${where}
       ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      session_id: string;
      title: string | null;
      owner_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map(rowToSession);
  }

  /**
   * Drop a session and its messages. Returns the file IDs whose blobs need to
   * be removed from disk by the caller (the store owns rows, not bytes).
   */
  deleteSession(sessionId: string): { deleted: boolean; fileIds: string[] } {
    const fileRows = this.db
      .prepare(`SELECT id FROM web_files WHERE session_id = ?`)
      .all(sessionId) as Array<{ id: string }>;
    const tx = this.db.transaction((id: string) => {
      this.db.prepare(`DELETE FROM web_messages WHERE session_id = ?`).run(id);
      this.db.prepare(`DELETE FROM web_files WHERE session_id = ?`).run(id);
      const result = this.db.prepare(`DELETE FROM web_sessions WHERE session_id = ?`).run(id);
      return result.changes > 0;
    });
    const deleted = tx(sessionId);
    return { deleted, fileIds: fileRows.map((row) => row.id) };
  }

  appendMessage(input: WebMessageInput): WebMessageRecord {
    const createdAt = input.createdAt ?? Date.now();
    const attachments = input.attachments ? Array.from(input.attachments) : [];
    const metadata = input.metadata ?? {};
    this.db
      .prepare(
        `INSERT INTO web_messages (id, session_id, role, content, attachments, metadata, created_at)
         VALUES (@id, @sessionId, @role, @content, @attachments, @metadata, @createdAt)`,
      )
      .run({
        id: input.id,
        sessionId: input.sessionId,
        role: input.role,
        content: JSON.stringify(input.content),
        attachments: attachments.length === 0 ? null : JSON.stringify(attachments),
        metadata: JSON.stringify(metadata),
        createdAt,
      });
    // Bump session updated_at so listSessions ordering stays meaningful.
    this.db
      .prepare(`UPDATE web_sessions SET updated_at = ? WHERE session_id = ?`)
      .run(new Date(createdAt).toISOString(), input.sessionId);
    return {
      id: input.id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      attachments,
      metadata,
      createdAt,
    };
  }

  /**
   * Cursor pagination by `created_at` (descending). Caller asks for messages
   * strictly before `before`; first page passes no cursor. Returned items are
   * in chronological order (oldest → newest) so the Dashboard can append
   * directly without re-sorting, and `nextCursor` is the oldest message's
   * `createdAt` for the *next* request.
   *
   * We over-fetch by one row to detect the "more available?" boundary: if
   * the DB returns `limit + 1` rows, there is at least one older message and
   * `nextCursor` is the oldest *returned* row's timestamp; otherwise the
   * caller is at the start of history and gets `null`.
   */
  listMessages(
    sessionId: string,
    options: ListMessagesOptions = {},
  ): { items: WebMessageRecord[]; nextCursor: number | null; nextCursorId: string | null } {
    const limit = clampInt(options.limit, 1, 200, 50);
    const before = options.before ?? Number.MAX_SAFE_INTEGER;
    // When the caller supplies both `before` and `beforeId`, use a composite
    // cursor so messages sharing a millisecond don't get split across pages.
    // When only `before` is supplied (legacy callers), keep the strict-less
    // behavior so paging by raw timestamp still works.
    const params: unknown[] = [sessionId];
    let where = 'session_id = ?';
    if (options.beforeId !== undefined) {
      where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      params.push(before, before, options.beforeId);
    } else {
      where += ' AND created_at < ?';
      params.push(before);
    }
    params.push(limit + 1);
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, content, attachments, metadata, created_at
           FROM web_messages
          WHERE ${where}
       ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(...params) as MessageRow[];
    const hasMore = rows.length > limit;
    const truncated = hasMore ? rows.slice(0, limit) : rows;
    const items = truncated.map(rowToMessage).reverse();
    const oldest = truncated[truncated.length - 1];
    const nextCursor = hasMore && oldest ? oldest.created_at : null;
    const nextCursorId = hasMore && oldest ? oldest.id : null;
    return { items, nextCursor, nextCursorId };
  }

  recordFile(input: WebFileInput): WebFileRecord {
    const createdAt = input.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO web_files (
            id, session_id, filename, size, mime_type, storage_path, uploaded_by, created_at
          ) VALUES (
            @id, @sessionId, @filename, @size, @mimeType, @storagePath, @uploadedBy, @createdAt
          )`,
      )
      .run({
        id: input.id,
        sessionId: input.sessionId,
        filename: input.filename,
        size: input.size,
        mimeType: input.mimeType,
        storagePath: input.storagePath,
        uploadedBy: input.uploadedBy,
        createdAt,
      });
    return {
      id: input.id,
      sessionId: input.sessionId,
      filename: input.filename,
      size: input.size,
      mimeType: input.mimeType,
      storagePath: input.storagePath,
      uploadedBy: input.uploadedBy,
      createdAt,
    };
  }

  getFile(fileId: string): WebFileRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, session_id, filename, size, mime_type, storage_path, uploaded_by, created_at
           FROM web_files
          WHERE id = ?`,
      )
      .get(fileId) as FileRow | undefined;
    return row ? rowToFile(row) : undefined;
  }

  /** Sum of file sizes already stored for a session — for quota enforcement. */
  sessionUsageBytes(sessionId: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM web_files WHERE session_id = ?`)
      .get(sessionId) as { total: number };
    return Number(row.total) || 0;
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        owner_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_web_messages_session_time
        ON web_messages(session_id, created_at);
      CREATE TABLE IF NOT EXISTS web_files (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT,
        storage_path TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_web_files_session
        ON web_files(session_id);
    `);
    const journalMode = this.db.pragma('journal_mode = WAL', { simple: true }) as string;
    if (String(journalMode).toLowerCase() !== 'wal') {
      this.logger.warn(
        { journalMode },
        'WebChannelStore could not enable WAL; continuing with SQLite default mode',
      );
    }
  }
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  attachments: string | null;
  metadata: string | null;
  created_at: number;
}

interface FileRow {
  id: string;
  session_id: string;
  filename: string;
  size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string;
  created_at: number;
}

function rowToSession(row: {
  session_id: string;
  title: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}): WebSessionRecord {
  return {
    sessionId: row.session_id,
    title: row.title,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): WebMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as WebMessageRecord['role'],
    content: parseJson(row.content),
    attachments: parseJsonArray<WebMessageAttachmentRef>(row.attachments),
    metadata: parseJsonObject(row.metadata),
    createdAt: Number(row.created_at),
  };
}

function rowToFile(row: FileRow): WebFileRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    filename: row.filename,
    size: Number(row.size),
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by,
    createdAt: Number(row.created_at),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function clampInt(raw: number | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
