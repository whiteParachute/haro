export interface PageQuerySource {
  req: {
    query(name: string): string | undefined;
  };
}

export interface ParsePageQueryOptions<TSort extends string> {
  allowedSort: readonly TSort[];
  defaultSort: TSort;
  defaultOrder?: 'asc' | 'desc';
  maxPageSize?: number;
  maxQLength?: number;
}

export interface ParsedPageQuery<TSort extends string> {
  page: number;
  pageSize: number;
  sort: TSort;
  order: 'asc' | 'desc';
  q: string;
  offset: number;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_Q_LENGTH = 200;

export function parsePageQuery<TSort extends string>(
  c: PageQuerySource,
  opts: ParsePageQueryOptions<TSort>,
): ParsedPageQuery<TSort> {
  const maxPageSize = opts.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const maxQLength = opts.maxQLength ?? DEFAULT_MAX_Q_LENGTH;
  const defaultOrder = opts.defaultOrder ?? 'desc';
  const legacyPageSize = clampInteger(c.req.query('limit'), 1, maxPageSize, DEFAULT_PAGE_SIZE);
  const pageSize = c.req.query('pageSize') === undefined
    ? legacyPageSize
    : clampInteger(c.req.query('pageSize'), 1, maxPageSize, legacyPageSize);
  const legacyOffset = clampInteger(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const explicitPage = clampInteger(c.req.query('page'), 1, Number.MAX_SAFE_INTEGER, 1);
  const useLegacyOffset = c.req.query('page') === undefined && c.req.query('offset') !== undefined;
  const offset = useLegacyOffset ? legacyOffset : (explicitPage - 1) * pageSize;
  const page = c.req.query('page') === undefined ? Math.floor(offset / pageSize) + 1 : explicitPage;
  const rawSort = c.req.query('sort');
  const sort = rawSort && opts.allowedSort.includes(rawSort as TSort)
    ? rawSort as TSort
    : opts.defaultSort;
  const rawOrder = c.req.query('order');
  const order = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : defaultOrder;
  const q = (c.req.query('q') ?? '').trim().slice(0, maxQLength);

  return { page, pageSize, sort, order, q, offset };
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

function clampInteger(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
