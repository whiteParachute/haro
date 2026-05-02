/**
 * Shared helpers for forwarding Hono query params into `@haro/core/services`
 * normalized page queries (FEAT-039 R5/R13).
 */

import type { Context } from 'hono';

export interface RoutePageQuery {
  page?: string;
  pageSize?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  order?: string;
  q?: string;
}

export function readPageQuery(c: Context): RoutePageQuery {
  return {
    ...(c.req.query('page') !== undefined ? { page: c.req.query('page')! } : {}),
    ...(c.req.query('pageSize') !== undefined ? { pageSize: c.req.query('pageSize')! } : {}),
    ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit')! } : {}),
    ...(c.req.query('offset') !== undefined ? { offset: c.req.query('offset')! } : {}),
    ...(c.req.query('sort') !== undefined ? { sort: c.req.query('sort')! } : {}),
    ...(c.req.query('order') !== undefined ? { order: c.req.query('order')! } : {}),
    ...(c.req.query('q') !== undefined ? { q: c.req.query('q')! } : {}),
  };
}

/** Convert a string filter param into a service filter, dropping empty/undefined. */
export function readStringFilter(c: Context, key: string): string | undefined {
  const value = c.req.query(key);
  return value !== undefined && value !== '' ? value : undefined;
}
