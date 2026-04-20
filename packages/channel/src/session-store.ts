import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { ChannelLogger } from './protocol.js';

const NOOP_LOGGER: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface SessionStoreRecord {
  scopeKey: string;
  sessionId: string;
  userId?: string;
  chatId?: string;
}

export class ChannelSessionStore {
  private readonly db: Database.Database;
  private readonly logger: ChannelLogger;
  private closed = false;

  constructor(file: string, logger?: ChannelLogger) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.logger = logger ?? NOOP_LOGGER;
    this.bootstrap();
  }

  resolve(input: {
    scopeKey: string;
    createSessionId: () => string;
    userId?: string;
    chatId?: string;
  }): string {
    const existing = this.get(input.scopeKey);
    if (existing) {
      this.db
        .prepare(
          `UPDATE channel_sessions
             SET updated_at = @updatedAt,
                 user_id = COALESCE(@userId, user_id),
                 chat_id = COALESCE(@chatId, chat_id)
           WHERE scope_key = @scopeKey`,
        )
        .run({
          scopeKey: input.scopeKey,
          updatedAt: new Date().toISOString(),
          userId: input.userId ?? null,
          chatId: input.chatId ?? null,
        });
      return existing.sessionId;
    }
    const sessionId = input.createSessionId();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO channel_sessions (
          scope_key,
          session_id,
          user_id,
          chat_id,
          created_at,
          updated_at
        ) VALUES (
          @scopeKey,
          @sessionId,
          @userId,
          @chatId,
          @createdAt,
          @updatedAt
        )`,
      )
      .run({
        scopeKey: input.scopeKey,
        sessionId,
        userId: input.userId ?? null,
        chatId: input.chatId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return sessionId;
  }

  get(scopeKey: string): SessionStoreRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT scope_key, session_id, user_id, chat_id
           FROM channel_sessions
          WHERE scope_key = ?`,
      )
      .get(scopeKey) as
      | { scope_key: string; session_id: string; user_id: string | null; chat_id: string | null }
      | undefined;
    if (!row) return undefined;
    return {
      scopeKey: row.scope_key,
      sessionId: row.session_id,
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.chat_id ? { chatId: row.chat_id } : {}),
    };
  }

  findBySessionId(sessionId: string): SessionStoreRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT scope_key, session_id, user_id, chat_id
           FROM channel_sessions
          WHERE session_id = ?
          ORDER BY updated_at DESC
          LIMIT 1`,
      )
      .get(sessionId) as
      | { scope_key: string; session_id: string; user_id: string | null; chat_id: string | null }
      | undefined;
    if (!row) return undefined;
    return {
      scopeKey: row.scope_key,
      sessionId: row.session_id,
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.chat_id ? { chatId: row.chat_id } : {}),
    };
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_sessions (
        scope_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT,
        chat_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const journalMode = this.db.pragma('journal_mode = WAL', { simple: true }) as string;
    if (String(journalMode).toLowerCase() !== 'wal') {
      this.logger.warn(
        { journalMode },
        'ChannelSessionStore could not enable WAL; continuing with SQLite default mode',
      );
    }
  }
}
