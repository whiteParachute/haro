/**
 * User management service (FEAT-039 R8 + FEAT-028 multi-user / RBAC).
 *
 * Core's home for user CRUD + audit + password hashing so CLI (`haro user
 * ...`) and Web API (`/api/v1/users`, `/api/v1/auth/*`) share one
 * implementation. Session-cookie / login-token logic stays in
 * `@haro/web-api` because it is HTTP-shaped; this module only handles
 * persisted user records and audit events.
 *
 * Backwards-compatible re-exports keep `@haro/web-api/auth-store` callers
 * working.
 */

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { initHaroDatabase } from '../db/index.js';
import type { ServiceContext } from './types.js';

export const WEB_USER_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export const WEB_USER_STATUSES = ['active', 'disabled'] as const;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type WebUserRole = typeof WEB_USER_ROLES[number];
export type WebUserStatus = typeof WEB_USER_STATUSES[number];

export type WebOperationClass =
  | 'read-only'
  | 'local-write'
  | 'config-write'
  | 'token-reset'
  | 'user-disable'
  | 'owner-transfer';

export type ActorKind = 'web-user' | 'legacy-api-key' | 'anonymous' | 'system' | 'cli';

export interface UserActor {
  kind: ActorKind;
  userId?: string;
  role?: WebUserRole;
}

export interface AuthenticatedWebUser {
  id: string;
  username: string;
  displayName: string;
  role: WebUserRole;
  status: WebUserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
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

export interface WebSessionToken {
  token: string;
  sessionId: string;
  expiresAt: string;
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

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const PASSWORD_MIN_LENGTH = 8;

interface RunResult { changes: number }
interface StatementLike {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): RunResult;
}
interface DatabaseLike {
  prepare(sql: string): StatementLike;
  close(): void;
  exec(sql: string): void;
}

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
  actor_kind: ActorKind;
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
  actorKind: ActorKind;
  actorRole?: WebUserRole;
}

export interface WebAuthStatus {
  userCount: number;
  hasOwner: boolean;
  requiresBootstrap: boolean;
  sessionAuthEnabled: boolean;
  legacyApiKeyEnabled: boolean;
}

// --------------------------------------------------------------------------
// validation helpers
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// password hashing / session token
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// auth status (bootstrap detection)
// --------------------------------------------------------------------------

export function readAuthStatus(ctx: ServiceContext): WebAuthStatus {
  const db = openDb(ctx);
  try {
    const userCount = readUserCount(db);
    const ownerCount = readOwnerCount(db);
    return {
      userCount,
      hasOwner: ownerCount > 0,
      requiresBootstrap: userCount === 0,
      sessionAuthEnabled: userCount > 0,
      legacyApiKeyEnabled: hasLegacyApiKey(),
    };
  } finally {
    db.close();
  }
}

// --------------------------------------------------------------------------
// session login / token machinery — used by web-api auth flow
// --------------------------------------------------------------------------

export interface SessionAuthRow {
  user: AuthenticatedWebUser;
  role: WebUserRole;
  sessionId: string;
  expiresAt: string;
}

export function authenticateBySessionToken(ctx: ServiceContext, token: string): SessionAuthRow | null {
  const tokenHash = hashSessionToken(token);
  const now = timestamp();
  const db = openDb(ctx);
  try {
    const row = db
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
    db.prepare(`UPDATE web_sessions SET last_seen_at = ? WHERE id = ?`).run(now, row.session_id);
    return {
      user: toPublicUser(row),
      role: row.role,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
    };
  } finally {
    db.close();
  }
}

export function bootstrapOwner(
  ctx: ServiceContext,
  input: { username: unknown; displayName?: unknown; password: unknown },
): { user: AuthenticatedWebUser; session: WebSessionToken } {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName, username);
  const password = validatePassword(input.password);
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      if (readUserCount(db) > 0) {
        throw new WebAuthError(409, 'bootstrap_closed', 'Owner bootstrap is only available before the first web user exists');
      }
      const now = timestamp();
      const user = insertUser(db, { username, displayName, password, role: 'owner', status: 'active', now });
      const session = insertSession(db, user.id, now);
      recordAudit(db, {
        actorKind: 'system',
        targetType: 'web_user',
        targetId: user.id,
        operation: 'auth.bootstrap-owner',
        operationClass: 'owner-transfer',
        result: 'allowed',
        // Stamp actorSource so post-hoc review can tell bootstrap apart
        // from CLI 'system' rows (both share actor_kind='system').
        metadata: { username: user.username, actorSource: 'bootstrap' },
        createdAt: now,
      });
      db.exec('COMMIT');
      return { user, session };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function loginWithPassword(
  ctx: ServiceContext,
  input: { username: unknown; password: unknown },
): { user: AuthenticatedWebUser; session: WebSessionToken } {
  const username = validateUsername(input.username);
  const password = typeof input.password === 'string' ? input.password : '';
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      const row = db.prepare(`SELECT * FROM web_users WHERE username = ?`).get(username) as WebUserRow | undefined;
      if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
        recordAudit(db, {
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
      db.prepare(`UPDATE web_users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id);
      const refreshed = { ...row, last_login_at: now, updated_at: now } satisfies WebUserRow;
      const session = insertSession(db, row.id, now);
      recordAudit(db, {
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
      db.exec('COMMIT');
      return { user: toPublicUser(refreshed), session };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function revokeSession(
  ctx: ServiceContext,
  args: { actorUserId: string; actorRole: WebUserRole; sessionId: string },
): void {
  const now = timestamp();
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE id = ?`).run(now, args.sessionId);
      recordAudit(db, {
        actorUserId: args.actorUserId,
        actorKind: 'web-user',
        actorRole: args.actorRole,
        targetType: 'web_session',
        targetId: args.sessionId,
        operation: 'auth.logout',
        operationClass: 'read-only',
        result: 'allowed',
        createdAt: now,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

// --------------------------------------------------------------------------
// user CRUD — what CLI calls
// --------------------------------------------------------------------------

export function listUsers(ctx: ServiceContext): WebUserWithAudit[] {
  const db = openDb(ctx);
  try {
    const rows = db
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
    db.close();
  }
}

export function getUserById(ctx: ServiceContext, id: string): AuthenticatedWebUser {
  const db = openDb(ctx);
  try {
    return toPublicUser(readUserById(db, id));
  } finally {
    db.close();
  }
}

export function getUserByUsername(ctx: ServiceContext, username: string): AuthenticatedWebUser {
  const db = openDb(ctx);
  try {
    const row = db.prepare(`SELECT * FROM web_users WHERE username = ?`).get(username) as WebUserRow | undefined;
    if (!row) throw new WebAuthError(404, 'user_not_found', `Web user '${username}' not found`);
    return toPublicUser(row);
  } finally {
    db.close();
  }
}

export function createUser(
  ctx: ServiceContext,
  input: { username: unknown; displayName?: unknown; password: unknown; role: unknown; status?: unknown },
  actor: UserActor,
): AuthenticatedWebUser {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName, username);
  const password = validatePassword(input.password);
  if (!isWebUserRole(input.role)) throw new WebAuthError(400, 'invalid_role', 'Invalid role');
  const status = input.status === undefined ? 'active' : input.status;
  if (!isWebUserStatus(status)) throw new WebAuthError(400, 'invalid_status', 'Invalid status');

  // FEAT-028: only `owner` actors may create another `owner` (CLI runs
  // as effective owner, web flows pass the session role). `system` is
  // reserved for bootstrap and may always create an owner.
  if (input.role === 'owner' && actor.kind !== 'system' && actor.kind !== 'cli' && actor.role !== 'owner') {
    throw new WebAuthError(403, 'owner_transfer_required', 'Only an owner may create another owner account');
  }

  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      const now = timestamp();
      const user = insertUser(db, { username, displayName, password, role: input.role, status, now });
      recordAudit(db, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: user.id,
        operation: 'users.create',
        operationClass: 'config-write',
        result: 'allowed',
        metadata: withActorSource(actor, { username: user.username, role: user.role, status: user.status }),
        createdAt: now,
      });
      db.exec('COMMIT');
      return user;
    } catch (error) {
      db.exec('ROLLBACK');
      if (isUniqueConstraintError(error)) throw new WebAuthError(409, 'username_exists', `Username '${username}' already exists`);
      throw error;
    }
  } finally {
    db.close();
  }
}

export function updateUser(
  ctx: ServiceContext,
  id: string,
  patch: { displayName?: unknown; role?: unknown; status?: unknown },
  actor: UserActor,
): AuthenticatedWebUser {
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      const current = readUserById(db, id);
      const nextDisplayName = patch.displayName === undefined ? current.display_name : validateDisplayName(patch.displayName, current.username);
      const nextRole = patch.role === undefined ? current.role : readRolePatch(patch.role);
      const nextStatus = patch.status === undefined ? current.status : readStatusPatch(patch.status);
      const promoting = current.role !== 'owner' && nextRole === 'owner';
      const demoting = current.role === 'owner' && nextRole !== 'owner';
      const disablingOwner = current.role === 'owner' && nextRole === 'owner' && current.status === 'active' && nextStatus !== 'active';
      const ownerTransfer = promoting || demoting || disablingOwner;
      if (ownerTransfer && actor.kind !== 'system' && actor.kind !== 'cli' && actor.role !== 'owner') {
        throw new WebAuthError(403, 'owner_transfer_required', 'Only an owner may grant, revoke, or disable owner accounts');
      }
      assertOwnerSafety(db, current, nextRole, nextStatus);
      const now = timestamp();
      db
        .prepare(`UPDATE web_users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(nextDisplayName, nextRole, nextStatus, now, id);
      const updated = readUserById(db, id);
      recordAudit(db, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: id,
        operation: 'users.update',
        operationClass: nextStatus !== current.status ? 'user-disable' : 'config-write',
        result: 'allowed',
        metadata: withActorSource(actor, { role: nextRole, status: nextStatus }),
        createdAt: now,
      });
      db.exec('COMMIT');
      return toPublicUser(updated);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function resetUserPassword(
  ctx: ServiceContext,
  id: string,
  passwordInput: unknown,
  actor: UserActor,
): AuthenticatedWebUser {
  const password = validatePassword(passwordInput);
  const db = openDb(ctx);
  try {
    db.exec('BEGIN');
    try {
      const current = readUserById(db, id);
      const now = timestamp();
      db
        .prepare(`UPDATE web_users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?`)
        .run(hashPassword(password), now, now, id);
      db.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now, id);
      const updated = readUserById(db, id);
      recordAudit(db, {
        ...actorToAudit(actor),
        targetType: 'web_user',
        targetId: id,
        operation: 'users.reset-password',
        operationClass: 'token-reset',
        result: 'allowed',
        metadata: withActorSource(actor, { username: current.username }),
        createdAt: now,
      });
      db.exec('COMMIT');
      return toPublicUser(updated);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function listAuditEvents(
  ctx: ServiceContext,
  input: { targetId?: string; limit?: number } = {},
): WebAuditEventReadModel[] {
  const db = openDb(ctx);
  try {
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    const params: unknown[] = [];
    const where = input.targetId ? 'WHERE target_id = ?' : '';
    if (input.targetId) params.push(input.targetId);
    const rows = db
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
    db.close();
  }
}

// --------------------------------------------------------------------------
// internals
// --------------------------------------------------------------------------

function openDb(ctx: ServiceContext): DatabaseLike {
  return initHaroDatabase({ root: ctx.root, dbFile: ctx.dbFile, keepOpen: true })
    .database as unknown as DatabaseLike;
}

function hasLegacyApiKey(): boolean {
  return Boolean(process.env.HARO_WEB_API_KEY?.trim());
}

function timestamp(): string {
  return new Date().toISOString();
}

function readUserCount(db: DatabaseLike): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM web_users`).get() as { count: number }).count;
}

function readOwnerCount(db: DatabaseLike): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM web_users WHERE role = 'owner' AND status = 'active'`).get() as { count: number }).count;
}

function insertUser(
  db: DatabaseLike,
  input: { username: string; displayName: string; password: string; role: WebUserRole; status: WebUserStatus; now: string },
): AuthenticatedWebUser {
  const id = `web_user_${randomUUID()}`;
  db
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

function insertSession(db: DatabaseLike, userId: string, now: string): WebSessionToken {
  const token = randomBytes(32).toString('base64url');
  const sessionId = `web_session_${randomUUID()}`;
  const expiresAt = new Date(Date.parse(now) + SESSION_TTL_MS).toISOString();
  db
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
  db: DatabaseLike,
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
  db
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

function actorToAudit(actor: UserActor): AuditActor {
  if (actor.kind === 'web-user') {
    return {
      ...(actor.userId ? { actorUserId: actor.userId } : {}),
      actorKind: 'web-user',
      ...(actor.role ? { actorRole: actor.role } : {}),
    };
  }
  if (actor.kind === 'legacy-api-key') return { actorKind: 'legacy-api-key', actorRole: 'owner' };
  // CLI runs locally as operator-of-record. The web_audit_events.actor_kind
  // CHECK constraint still only allows the four legacy values, so we
  // collapse 'cli' into 'system' for the column, then stamp every CLI
  // audit row with `metadata.actorSource: 'cli'` (see withActorSource)
  // so RBAC review can tell CLI from bootstrap/system actions.
  if (actor.kind === 'cli') return { actorKind: 'system', actorRole: actor.role ?? 'owner' };
  if (actor.kind === 'anonymous') return { actorKind: 'anonymous', actorRole: 'owner' };
  return { actorKind: 'system', ...(actor.role ? { actorRole: actor.role } : {}) };
}

/**
 * Stamp every audit row's metadata with `actorSource` derived from the
 * UserActor.kind so CLI mutations stay distinguishable in `web_audit_events`
 * even when actor_kind is collapsed to 'system' (Codex adversarial review
 * 2026-05-02 medium).
 */
function withActorSource(
  actor: UserActor,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { ...metadata, actorSource: actor.kind };
}

function readUserById(db: DatabaseLike, id: string): WebUserRow {
  const row = db.prepare(`SELECT * FROM web_users WHERE id = ?`).get(id) as WebUserRow | undefined;
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

function assertOwnerSafety(db: DatabaseLike, current: WebUserRow, nextRole: WebUserRole, nextStatus: WebUserStatus): void {
  if (current.role !== 'owner') return;
  if (nextRole === 'owner' && nextStatus === 'active') return;
  if (readOwnerCount(db) <= 1) {
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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}
