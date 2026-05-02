/**
 * Haro service layer (FEAT-039 R5/R13).
 *
 * Both `@haro/cli` commands and `@haro/web-api` routes call into the same
 * service functions so business logic isn't duplicated.
 */

export type {
  ServiceContext,
  PageQuery,
  NormalizedPageQuery,
  PageInfo,
  PaginatedResult,
  NormalizePageOptions,
} from './types.js';
export { normalizePageQuery, buildPageInfo } from './types.js';

export * as sessions from './sessions.js';
export * as logs from './logs.js';
export * as workflows from './workflows.js';
export * as agents from './agents.js';
export * as memory from './memory.js';
export * as users from './users.js';
export * as budget from './budget.js';
export * as config from './config.js';
export * as skills from './skills.js';

// Re-export commonly-imported users symbols at the namespace root for
// drop-in compatibility with the legacy `@haro/web-api/auth-store`
// import surface (FEAT-039 R5/R13).
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
} from './users.js';
export type {
  AuthenticatedWebUser,
  UserActor,
  WebAuditEventReadModel,
  WebAuthErrorStatus,
  WebAuthStatus,
  WebSessionToken,
  WebUserRole,
  WebUserStatus,
  WebOperationClass,
  WebUserWithAudit,
} from './users.js';
