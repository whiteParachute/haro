import type { HaroLogger } from '../logger/index.js';

/** Subset of HaroLogger that services actually call. */
export type ServiceLogger = Pick<HaroLogger, 'info' | 'warn' | 'error' | 'debug'>;

export interface ServiceContext {
  /** Haro root directory (defaults to ~/.haro). */
  root?: string;
  /** Optional override for the SQLite DB path (test/dry-run). */
  dbFile?: string;
  /** Project root used for project-scoped config lookups. */
  projectRoot?: string;
  /** Logger; services log warnings/errors but never fatal. */
  logger?: ServiceLogger;
}

export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_MAX_PAGE_SIZE = 100;
export const DEFAULT_MAX_Q_LENGTH = 200;

export interface PageQueryRaw {
  page?: string | number;
  pageSize?: string | number;
  /** Legacy alias for pageSize (web-api compat). */
  limit?: string | number;
  /** Legacy raw offset (web-api compat). */
  offset?: string | number;
  sort?: string;
  order?: string;
  q?: string;
}

export interface NormalizePageOptions {
  allowedSort: readonly string[];
  defaultSort: string;
  defaultOrder?: 'asc' | 'desc';
  maxPageSize?: number;
  maxQLength?: number;
}

export interface NormalizedPageQuery {
  page: number;
  pageSize: number;
  offset: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
  total: number;
  limit: number;
  offset: number;
}

/**
 * Normalize raw page query input into the canonical shape used by all
 * services. Mirrors web-api's `parsePageQuery` semantics so route + CLI
 * share defaults: DEFAULT_PAGE_SIZE=20, DEFAULT_MAX_PAGE_SIZE=100, with
 * optional legacy `limit`/`offset` aliases.
 */
export function normalizePageQuery(query: PageQueryRaw, options: NormalizePageOptions): NormalizedPageQuery {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const maxQLength = options.maxQLength ?? DEFAULT_MAX_Q_LENGTH;
  const defaultOrder = options.defaultOrder ?? 'desc';

  const legacyPageSize = clampInt(query.limit, 1, maxPageSize, DEFAULT_PAGE_SIZE);
  const pageSize = query.pageSize === undefined
    ? legacyPageSize
    : clampInt(query.pageSize, 1, maxPageSize, legacyPageSize);
  const legacyOffset = clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const explicitPage = clampInt(query.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const useLegacyOffset = query.page === undefined && query.offset !== undefined;
  const offset = useLegacyOffset ? legacyOffset : (explicitPage - 1) * pageSize;
  const page = query.page === undefined ? Math.floor(offset / pageSize) + 1 : explicitPage;

  const sort = typeof query.sort === 'string' && options.allowedSort.includes(query.sort)
    ? query.sort
    : options.defaultSort;
  const order = query.order === 'asc' || query.order === 'desc' ? query.order : defaultOrder;
  const q = (typeof query.q === 'string' ? query.q : '').trim().slice(0, maxQLength);

  return { page, pageSize, offset, sort, order, q };
}

export function buildPageInfo(input: { page: number; pageSize: number; total: number }): PageInfo {
  const page = Math.max(1, Math.trunc(input.page) || 1);
  const pageSize = Math.max(1, Math.trunc(input.pageSize) || DEFAULT_PAGE_SIZE);
  const total = Math.max(0, Math.trunc(input.total) || 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function clampInt(raw: number | string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** Backwards-compatible alias kept for callers that imported the old name. */
export type PageQuery = PageQueryRaw;
