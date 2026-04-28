import { useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { PaginationControls } from './PaginationControls';

export interface PaginatedTableColumn<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

export interface PaginatedTableState {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
}

export interface PaginatedTableProps<T> extends PaginatedTableState {
  columns: Array<PaginatedTableColumn<T>>;
  rows: T[];
  total: number;
  onChange: (next: Partial<PaginatedTableState>) => void;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  onRetry?: () => void;
}

export function parseTableSearchParams(params: URLSearchParams, fallback: PaginatedTableState): PaginatedTableState {
  const page = clampInteger(params.get('page'), 1, Number.MAX_SAFE_INTEGER, fallback.page);
  const pageSize = clampInteger(params.get('pageSize'), 1, 100, fallback.pageSize);
  const sort = params.get('sort') || fallback.sort;
  const order = params.get('order') === 'asc' ? 'asc' : params.get('order') === 'desc' ? 'desc' : fallback.order;
  const q = params.get('q') ?? fallback.q;
  return { page, pageSize, sort, order, q };
}

export function nextSortState(current: Pick<PaginatedTableState, 'sort' | 'order'>, sort: string): Pick<PaginatedTableState, 'sort' | 'order'> {
  if (current.sort !== sort) return { sort, order: 'asc' };
  return { sort, order: current.order === 'asc' ? 'desc' : 'asc' };
}

export function PaginatedTable<T extends object>({
  columns,
  rows,
  total,
  page,
  pageSize,
  sort,
  order,
  q,
  onChange,
  loading = false,
  error = null,
  emptyMessage,
  onRetry,
}: PaginatedTableProps<T>) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = useMemo(() => ({ page, pageSize, sort, order, q }), [page, pageSize, sort, order, q]);

  useEffect(() => {
    const parsed = parseTableSearchParams(searchParams, fallback);
    if (parsed.page !== page || parsed.pageSize !== pageSize || parsed.sort !== sort || parsed.order !== order || parsed.q !== q) {
      onChange(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    next.set('pageSize', String(pageSize));
    if (sort) next.set('sort', sort);
    else next.delete('sort');
    next.set('order', order);
    if (q) next.set('q', q);
    else next.delete('q');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [order, page, pageSize, q, searchParams, setSearchParams, sort]);

  const commonControls = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3 text-sm">
      <input
        className="min-w-56 rounded-md border border-input bg-background px-3 py-2"
        placeholder={t(K.TABLE.SEARCH_PLACEHOLDER)}
        value={q}
        onChange={(event) => onChange({ q: event.target.value, page: 1 })}
      />
      <span className="text-muted-foreground">{t(K.COMMON.TOTAL)} {total}</span>
    </div>
  );

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        {commonControls}
        <div className="space-y-3 p-4" aria-busy="true">
          <p className="text-sm text-muted-foreground">{t(K.TABLE.LOADING)}</p>
          {[0, 1, 2].map((index) => <div key={index} className="h-8 animate-pulse rounded-md bg-muted" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        {commonControls}
        <div className="space-y-3 p-4">
          <p className="font-medium text-destructive">{t(K.TABLE.ERROR)}</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={onRetry}>{t(K.COMMON.RETRY)}</Button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        {commonControls}
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{emptyMessage ?? t(K.TABLE.EMPTY)}</p>
          <Button variant="outline" onClick={onRetry}>{t(K.COMMON.RETRY)}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {commonControls}
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map((column) => {
              const columnKey = String(column.key);
              const active = sort === columnKey;
              return (
                <th key={columnKey} className="p-3">
                  {column.sortable ? (
                    <button
                      className="inline-flex items-center gap-1 font-medium"
                      type="button"
                      onClick={() => onChange({ ...nextSortState({ sort, order }, columnKey), page: 1 })}
                    >
                      {column.header}
                      <span aria-label={active ? (order === 'asc' ? t(K.TABLE.SORT_ASC) : t(K.TABLE.SORT_DESC)) : undefined}>{active ? (order === 'asc' ? '↑' : '↓') : '↕'}</span>
                    </button>
                  ) : column.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String((row as Record<string, unknown>).id ?? (row as Record<string, unknown>).sessionId ?? (row as Record<string, unknown>).key ?? index)} className="border-t border-border align-top">
              {columns.map((column) => (
                <td key={String(column.key)} className="p-3">
                  {column.render ? column.render(row) : renderCell((row as Record<string, unknown>)[String(column.key)])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(nextPage) => onChange({ page: nextPage })}
        onPageSizeChange={(nextPageSize) => onChange({ page: 1, pageSize: nextPageSize })}
      />
    </div>
  );
}

function clampInteger(value: string | null, min: number, max: number, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function renderCell(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'object') return <pre className="max-w-md overflow-auto text-xs">{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}
