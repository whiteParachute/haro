/**
 * Adapter around `@haro/core/services/users` (FEAT-039 R5 — single
 * service-layer source for user CRUD + audit + password handling).
 *
 * The original 750-line `auth-store.ts` was relocated into core; this
 * module preserves the same export surface so existing route imports keep
 * working, and converts between web-api-only `WebAuthContext` and the
 * core service's smaller `UserActor` shape.
 */

import { services } from '@haro/core';
import type { WebAuthContext } from './types.js';
import type { WebRuntime } from './runtime.js';

const users = services.users;

export {
  WEB_USER_ROLES,
  WEB_USER_STATUSES,
  SESSION_TTL_MS,
  WebAuthError,
  hashPassword,
  hashSessionToken,
  isWebUserRole,
  isWebUserStatus,
  validateDisplayName,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '@haro/core/services';
export type {
  AuthenticatedWebUser,
  WebAuditEventReadModel,
  WebAuthErrorStatus,
  WebAuthStatus,
  WebSessionToken,
  WebUserWithAudit,
} from '@haro/core/services';

function ctx(runtime: WebRuntime): services.ServiceContext {
  return {
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  };
}

function actorFrom(auth: WebAuthContext): services.users.UserActor {
  if (auth.kind === 'session') {
    return { kind: 'web-user', userId: auth.user.id, role: auth.role };
  }
  if (auth.kind === 'legacy-api-key') return { kind: 'legacy-api-key', role: 'owner' };
  return { kind: 'anonymous', role: 'owner' };
}

export function readAuthStatus(runtime: WebRuntime): services.users.WebAuthStatus {
  return users.readAuthStatus(ctx(runtime));
}

export function authenticateWebSession(runtime: WebRuntime, token: string): WebAuthContext | null {
  const row = users.authenticateBySessionToken(ctx(runtime), token);
  if (!row) return null;
  return {
    kind: 'session',
    authenticated: true,
    user: row.user,
    role: row.role,
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
  };
}

export function bootstrapOwner(
  runtime: WebRuntime,
  input: { username: unknown; displayName?: unknown; password: unknown },
): { user: services.users.AuthenticatedWebUser; session: services.users.WebSessionToken } {
  return users.bootstrapOwner(ctx(runtime), input);
}

export function loginWithPassword(
  runtime: WebRuntime,
  input: { username: unknown; password: unknown },
): { user: services.users.AuthenticatedWebUser; session: services.users.WebSessionToken } {
  return users.loginWithPassword(ctx(runtime), input);
}

export function revokeSession(runtime: WebRuntime, auth: WebAuthContext): void {
  if (auth.kind !== 'session') return;
  users.revokeSession(ctx(runtime), {
    actorUserId: auth.user.id,
    actorRole: auth.role,
    sessionId: auth.sessionId,
  });
}

export function listUsers(runtime: WebRuntime): services.users.WebUserWithAudit[] {
  return users.listUsers(ctx(runtime));
}

export function createUser(
  runtime: WebRuntime,
  input: { username: unknown; displayName?: unknown; password: unknown; role: unknown; status?: unknown },
  actor: WebAuthContext,
): services.users.AuthenticatedWebUser {
  return users.createUser(ctx(runtime), input, actorFrom(actor));
}

export function updateUser(
  runtime: WebRuntime,
  id: string,
  patch: { displayName?: unknown; role?: unknown; status?: unknown },
  actor: WebAuthContext,
): services.users.AuthenticatedWebUser {
  return users.updateUser(ctx(runtime), id, patch, actorFrom(actor));
}

export function resetUserPassword(
  runtime: WebRuntime,
  id: string,
  passwordInput: unknown,
  actor: WebAuthContext,
): services.users.AuthenticatedWebUser {
  return users.resetUserPassword(ctx(runtime), id, passwordInput, actorFrom(actor));
}

export function listAuditEvents(
  runtime: WebRuntime,
  input: { targetId?: string; limit?: number } = {},
): services.users.WebAuditEventReadModel[] {
  return users.listAuditEvents(ctx(runtime), input);
}
