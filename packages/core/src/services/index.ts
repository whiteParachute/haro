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
