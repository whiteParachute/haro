import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db as haroDb } from '@haro/core';
import type {
  AuthenticatedWebUser,
  WebAuthContext,
  WebOperationClass,
  WebUserRole,
  WebUserStatus,
} from './types.js';
import type { WebRuntime } from './runtime.js';

export const WEB_USER_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export const WEB_USER_STATUSES = ['active', 'disabled'] as const;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const PASSWORD_MIN_LENGTH = 8;

type RunResult = { changes: number };
type StatementLike = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): RunResult;
};
type DatabaseLike = {
  prepare(sql: string): StatementLike;
  close(): void;
  exec(sql: string): void;
};

interface WebUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: WebUserRole;
  status: WebUserStatus;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  password_updated_at: string;
}

interface WebSessionRow extends WebUserRow {
  session_id: string;
  expires_at: string;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_kind: 'web-user' | 'legacy-api-key' | 'anonymous' | 'system';
  actor_role: WebUserRole | null;
  target_type: string;
  target_id: string | null;
  operation: string;
  operation_class: WebOperationClass;
  result: 'allowed' | 'denied' | 'failed';
  metadata_json: string | null;
  created_at: string;
}

interface AuditActor {
  actorUserId?: string;
  actorKind: 'web-user' | 'legacy-api-key' | 'anonymous' | 'system';
  actorRole?: WebUserRole;
}

export interface WebAuthStatus {
  userCount: number;
  hasOwner: boolean;
  requiresBootstrap: boolean;
  sessionAuthEnabled: boolean;
  legacyApiKeyEnabled: boolean;
}

export interface WebSessionToken {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export interface WebUserWithAudit extends AuthenticatedWebUser {
  auditSummary: {
    count: number;
    lastEventAt: string | null;
  };
}

export interface WebAuditEventReadModel {
  id: string;
  actorUserId: string | null;
  actorKind: string;
  actorRole: WebUserRole | null;
  targetType: string;
  targetId: string | null;
  operation: string;
  operationClass: WebOperationClass;
  result: 'allowed' | 'denied' | 'failed';
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type WebAuthErrorStatus = 400 | 401 | 403 | 404 | 409;

export class WebAuthError extends Error {
  readonly status: WebAuthErrorStatus;
  readonly code: string;

  constructor(status: WebAuthErrorStatus, code: string, message: string) {
    super(message);
    this.name = 'WebAuthError';
    this.status = status;
    this.code = code;
  }
}

export function isWebUserRole(value: unknown): value is WebUserRole {
  return typeof value === 'string' && (WEB_USER_ROLES as readonly string[]).includes(value);
}

export function isWebUserStatus(value: unknown): value is WebUserStatus {
  return typeof value === 'string' && (WEB_USER_STATUSES as readonly string[]).includes(value);
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new WebAuthError(400, 'invalid_password', `Password must contain at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return password;
}

export function validateUsername(username: unknown): string {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
    throw new WebAuthError(400, 'invalid_username', 'Username must be 3-64 characters and only contain letters, numbers, dot, underscore, or dash');
  }
  return username.trim();
}

export function validateDisplayName(displayName: unknown, fallback: string): string {
  if (displayName === undefined || displayName === null) return fallback;
  if (typeof displayName !== 'string') throw new WebAuthError(400, 'invalid_display_name', 'Display name must be a string');
  const normalized = displayName.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new WebAuthError(400, 'invalid_display_name', 'Display name must be 1-80 characters');
  }
  return normalized;
}

export function hashPassword(password: string, salt = randomBytes(16).toString('base64url')): string {
  const key = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [scheme, salt, expectedKey] = passwordHash.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedKey) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedKey, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function readAuthStatus(runtime: WebRuntime): WebAuthStatus {
  const database = openDb(runtime);
  try {
    const userCount = readUserCount(database);
    const ownerCount = readOwnerCount(database);
    return {
      userCount,
      hasOwner: ownerCount > 0,
      requiresBootstrap: userCount === 0,
      sessionAuthEnabled: userCount > 0,
      legacyApiKeyEnabled: hasLegacyApiKey(),
    };
  } finally {
    database.close();
  }
}

export function authenticateWebSession(runtime: WebRuntime, token: string): WebAuthContext | null {
  const tokenHash = hashSessionToken(token);
  const now = timestamp();
  const database = openDb(runtime);
  try {
    const row = database
      .prepare(
        `SELECT u.id,
                u.username,
                u.display_name,
                u.password_hash,
                u.role,
                u.status,
                u.created_at,
                u.updated_at,
                u.last_login_at,
                u.password_updated_at,
                s.id AS session_id,
                s.expires_at
           FROM web_sessions s
           JOIN web_users u ON u.id = s.user_id
          WHERE s.session_token_hash = ?
            AND s.revoked_at IS NULL`,
      )
      .get(tokenHash) as WebSessionRow | undefined;
    if (!row || row.status !== 'active' || row.expires_at <= now) return null;
    database.prepare(`UPDATE web_sessions SET last_seen_at = ? WHERE id = ?`).run(now, row.session_id);
    return {
      kind: 'session',
      authenticated: true,
      user: toPublicUser(row),
      role: row.role,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
    };
  } finally {
    database.close();
  }
}

export function bootstrapOwner(runtime: WebRuntime, input: { username: unknown; displayName?: unknown; password: unknown }): { user: AuthenticatedWebUser; session: WebSessionToken } {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName, username);
  const password = validatePassword(input.password);
  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      if (readUserCount(database) > 0) {
        throw new WebAuthError(409, 'bootstrap_closed', 'Owner bootstrap is only available before the first web user exists');
      }
      const now = timestamp();
      const user = insertUser(database, {
        username,
        displayName,
        password,
        role: 'owner',
        status: 'active',
        now,
      });
      const session = insertSession(database, user.id, now);
      recordAudit(database, {
        actorKind: 'system',
        targetType: 'web_user',
        targetId: user.id,
        operation: 'auth.bootstrap-owner',
        operationClass: 'owner-transfer',
        result: 'allowed',
        metadata: { username: user.username },
        createdAt: now,
      });
      database.exec('COMMIT');
      return { user, session };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function loginWithPassword(runtime: WebRuntime, input: { username: unknown; password: unknown }): { user: AuthenticatedWebUser; session: WebSessionToken } {
  const username = validateUsername(input.username);
  const password = typeof input.password === 'string' ? input.password : '';
  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      const row = database.prepare(`SELECT * FROM web_users WHERE username = ?`).get(username) as WebUserRow | undefined;
      if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
        recordAudit(database, {
          actorKind: 'anonymous',
          targetType: 'web_user',
          targetId: row?.id ?? username,
          operation: 'auth.login',
          operationClass: 'read-only',
          result: 'denied',
          metadata: { username },
        });
        throw new WebAuthError(401, 'invalid_credentials', 'Invalid username or password');
      }
      const now = timestamp();
      database.prepare(`UPDATE web_users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id);
      const refreshed = { ...row, last_login_at: now, updated_at: now } satisfies WebUserRow;
      const session = insertSession(database, row.id, now);
      recordAudit(database, {
        actorUserId: row.id,
        actorKind: 'web-user',
        actorRole: row.role,
        targetType: 'web_user',
        targetId: row.id,
        operation: 'auth.login',
        operationClass: 'read-only',
        result: 'allowed',
        createdAt: now,
      });
      database.exec('COMMIT');
      return { user: toPublicUser(refreshed), session };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function revokeSession(runtime: WebRuntime, auth: WebAuthContext): void {
  if (auth.kind !== 'session') return;
  const now = timestamp();
  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      database.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE id = ?`).run(now, auth.sessionId);
      recordAudit(database, {
        actorUserId: auth.user.id,
        actorKind: 'web-user',
        actorRole: auth.role,
        targetType: 'web_session',
        targetId: auth.sessionId,
        operation: 'auth.logout',
        operationClass: 'read-only',
        result: 'allowed',
        createdAt: now,
      });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function listUsers(runtime: WebRuntime): WebUserWithAudit[] {
  const database = openDb(runtime);
  try {
    const rows = database
      .prepare(
        `SELECT u.id,
                u.username,
                u.display_name,
                u.password_hash,
                u.role,
                u.status,
                u.created_at,
                u.updated_at,
                u.last_login_at,
                u.password_updated_at,
                COUNT(e.id) AS audit_count,
                MAX(e.created_at) AS last_audit_at
           FROM web_users u
      LEFT JOIN web_audit_events e
             ON e.target_type = 'web_user'
            AND e.target_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`,
      )
      .all() as Array<WebUserRow & { audit_count: number; last_audit_at: string | null }>;
    return rows.map((row) => ({
      ...toPublicUser(row),
      auditSummary: {
        count: row.audit_count,
        lastEventAt: row.last_audit_at,
      },
    }));
  } finally {
    database.close();
  }
}

export function createUser(
  runtime: WebRuntime,
  input: { username: unknown; displayName?: unknown; password: unknown; role: unknown; status?: unknown },
  actor: WebAuthContext,
): AuthenticatedWebUser {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName, username);
  const password = validatePassword(input.password);
  if (!isWebUserRole(input.role)) throw new WebAuthError(400, 'invalid_role', 'Invalid role');
  const status = input.status === undefined ? 'active' : input.status;
  if (!isWebUserStatus(status)) throw new WebAuthError(400, 'invalid_status', 'Invalid status');

  // FEAT-028 critical fix — only `owner` actors may create another `owner`.
  // `config-write` is intentionally narrower: granting owner crosses the
  // owner-transfer boundary defined in spec §5.4.
  if (input.role === 'owner' && actor.role !== 'owner') {
    throw new WebAuthError(403, 'owner_transfer_required', 'Only an owner may create another owner account');
  }

  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      const now = timestamp();
      const user = insertUser(database, { username, displayName, password, role: input.role, status, now });
      recordAudit(database, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: user.id,
        operation: 'users.create',
        operationClass: 'config-write',
        result: 'allowed',
        metadata: { username: user.username, role: user.role, status: user.status },
        createdAt: now,
      });
      database.exec('COMMIT');
      return user;
    } catch (error) {
      database.exec('ROLLBACK');
      if (isUniqueConstraintError(error)) throw new WebAuthError(409, 'username_exists', `Username '${username}' already exists`);
      throw error;
    }
  } finally {
    database.close();
  }
}

export function updateUser(
  runtime: WebRuntime,
  id: string,
  patch: { displayName?: unknown; role?: unknown; status?: unknown },
  actor: WebAuthContext,
): AuthenticatedWebUser {
  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      const current = readUserById(database, id);
      const nextDisplayName = patch.displayName === undefined ? current.display_name : validateDisplayName(patch.displayName, current.username);
      const nextRole = patch.role === undefined ? current.role : readRolePatch(patch.role);
      const nextStatus = patch.status === undefined ? current.status : readStatusPatch(patch.status);
      // FEAT-028 critical fix — both promoting to owner and demoting an owner
      // count as owner-transfer; only an owner actor may do either. Disabling
      // an owner account is also restricted because it removes owner access.
      const promoting = current.role !== 'owner' && nextRole === 'owner';
      const demoting = current.role === 'owner' && nextRole !== 'owner';
      const disablingOwner = current.role === 'owner' && nextRole === 'owner' && current.status === 'active' && nextStatus !== 'active';
      if ((promoting || demoting || disablingOwner) && actor.role !== 'owner') {
        throw new WebAuthError(403, 'owner_transfer_required', 'Only an owner may grant, revoke, or disable owner accounts');
      }
      assertOwnerSafety(database, current, nextRole, nextStatus);
      const now = timestamp();
      database
        .prepare(`UPDATE web_users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(nextDisplayName, nextRole, nextStatus, now, id);
      const updated = readUserById(database, id);
      recordAudit(database, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: id,
        operation: 'users.update',
        operationClass: nextStatus !== current.status ? 'user-disable' : 'config-write',
        result: 'allowed',
        metadata: { role: nextRole, status: nextStatus },
        createdAt: now,
      });
      database.exec('COMMIT');
      return toPublicUser(updated);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function resetUserPassword(
  runtime: WebRuntime,
  id: string,
  passwordInput: unknown,
  actor: WebAuthContext,
): AuthenticatedWebUser {
  const password = validatePassword(passwordInput);
  const database = openDb(runtime);
  try {
    database.exec('BEGIN');
    try {
      const current = readUserById(database, id);
      const now = timestamp();
      database
        .prepare(`UPDATE web_users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?`)
        .run(hashPassword(password), now, now, id);
      database.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now, id);
      const updated = readUserById(database, id);
      recordAudit(database, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: id,
        operation: 'users.reset-password',
        operationClass: 'token-reset',
        result: 'allowed',
        metadata: { username: current.username },
        createdAt: now,
      });
      database.exec('COMMIT');
      return toPublicUser(updated);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function listAuditEvents(runtime: WebRuntime, input: { targetId?: string; limit?: number } = {}): WebAuditEventReadModel[] {
  const database = openDb(runtime);
  try {
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    const params: unknown[] = [];
    const where = input.targetId ? 'WHERE target_id = ?' : '';
    if (input.targetId) params.push(input.targetId);
    const rows = database
      .prepare(
        `SELECT id,
                actor_user_id,
                actor_kind,
                actor_role,
                target_type,
                target_id,
                operation,
                operation_class,
                result,
                metadata_json,
                created_at
           FROM web_audit_events
          ${where}
       ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(...params, limit) as AuditRow[];
    return rows.map(toAuditEvent);
  } finally {
    database.close();
  }
}

function openDb(runtime: WebRuntime): DatabaseLike {
  return haroDb.initHaroDatabase({ root: runtime.root, dbFile: runtime.dbFile, keepOpen: true }).database as unknown as DatabaseLike;
}

function hasLegacyApiKey(): boolean {
  return Boolean(process.env.HARO_WEB_API_KEY?.trim());
}

function timestamp(): string {
  return new Date().toISOString();
}

function readUserCount(database: DatabaseLike): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM web_users`).get() as { count: number }).count;
}

function readOwnerCount(database: DatabaseLike): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM web_users WHERE role = 'owner' AND status = 'active'`).get() as { count: number }).count;
}

function insertUser(
  database: DatabaseLike,
  input: {
    username: string;
    displayName: string;
    password: string;
    role: WebUserRole;
    status: WebUserStatus;
    now: string;
  },
): AuthenticatedWebUser {
  const id = `web_user_${randomUUID()}`;
  database
    .prepare(
      `INSERT INTO web_users (
        id,
        username,
        display_name,
        password_hash,
        role,
        status,
        created_at,
        updated_at,
        last_login_at,
        password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      input.username,
      input.displayName,
      hashPassword(input.password),
      input.role,
      input.status,
      input.now,
      input.now,
      input.now,
    );
  return {
    id,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    status: input.status,
    createdAt: input.now,
    updatedAt: input.now,
    lastLoginAt: null,
  };
}

function insertSession(database: DatabaseLike, userId: string, now: string): WebSessionToken {
  const token = randomBytes(32).toString('base64url');
  const sessionId = `web_session_${randomUUID()}`;
  const expiresAt = new Date(Date.parse(now) + SESSION_TTL_MS).toISOString();
  database
    .prepare(
      `INSERT INTO web_sessions (
        id,
        user_id,
        session_token_hash,
        created_at,
        last_seen_at,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(sessionId, userId, hashSessionToken(token), now, now, expiresAt);
  return { token, sessionId, expiresAt };
}

function recordAudit(
  database: DatabaseLike,
  input: AuditActor & {
    targetType: string;
    targetId?: string;
    operation: string;
    operationClass: WebOperationClass;
    result: 'allowed' | 'denied' | 'failed';
    metadata?: Record<string, unknown>;
    createdAt?: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO web_audit_events (
        id,
        actor_user_id,
        actor_kind,
        actor_role,
        target_type,
        target_id,
        operation,
        operation_class,
        result,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `web_audit_${randomUUID()}`,
      input.actorUserId ?? null,
      input.actorKind,
      input.actorRole ?? null,
      input.targetType,
      input.targetId ?? null,
      input.operation,
      input.operationClass,
      input.result,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdAt ?? timestamp(),
    );
}

function actorToAudit(auth: WebAuthContext): AuditActor {
  if (auth.kind === 'session') {
    return { actorUserId: auth.user.id, actorKind: 'web-user', actorRole: auth.role };
  }
  if (auth.kind === 'legacy-api-key') return { actorKind: 'legacy-api-key', actorRole: 'owner' };
  return { actorKind: 'anonymous', actorRole: 'owner' };
}

function readUserById(database: DatabaseLike, id: string): WebUserRow {
  const row = database.prepare(`SELECT * FROM web_users WHERE id = ?`).get(id) as WebUserRow | undefined;
  if (!row) throw new WebAuthError(404, 'user_not_found', `Web user '${id}' not found`);
  return row;
}

function readRolePatch(value: unknown): WebUserRole {
  if (!isWebUserRole(value)) throw new WebAuthError(400, 'invalid_role', 'Invalid role');
  return value;
}

function readStatusPatch(value: unknown): WebUserStatus {
  if (!isWebUserStatus(value)) throw new WebAuthError(400, 'invalid_status', 'Invalid status');
  return value;
}

function assertOwnerSafety(database: DatabaseLike, current: WebUserRow, nextRole: WebUserRole, nextStatus: WebUserStatus): void {
  if (current.role !== 'owner') return;
  if (nextRole === 'owner' && nextStatus === 'active') return;
  if (readOwnerCount(database) <= 1) {
    throw new WebAuthError(400, 'last_owner_required', 'Cannot remove or disable the last active owner');
  }
}

function toPublicUser(row: WebUserRow): AuthenticatedWebUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function toAuditEvent(row: AuditRow): WebAuditEventReadModel {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorKind: row.actor_kind,
    actorRole: row.actor_role,
    targetType: row.target_type,
    targetId: row.target_id,
    operation: row.operation,
    operationClass: row.operation_class,
    result: row.result,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}
