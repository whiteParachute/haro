import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/provider';
import { nextSortState, PaginatedTable, parseTableSearchParams } from '../PaginatedTable';

const baseProps = {
  columns: [{ key: 'name', header: '名称', sortable: true }],
  rows: [{ id: '1', name: 'alpha' }],
  total: 1,
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc' as const,
  q: '',
  onChange: () => undefined,
};

function render(element: ReactNode) {
  return renderToString(<I18nProvider locale="zh-CN"><MemoryRouter>{element}</MemoryRouter></I18nProvider>);
}

describe('FEAT-028 PaginatedTable', () => {
  it('renders loading, empty, error and ok states', () => {
    expect(render(<PaginatedTable {...baseProps} loading />)).toContain('正在加载列表');
    expect(render(<PaginatedTable {...baseProps} rows={[]} emptyMessage="空状态" />)).toContain('空状态');
    expect(render(<PaginatedTable {...baseProps} error="boom" />)).toContain('boom');
    expect(render(<PaginatedTable {...baseProps} />)).toContain('alpha');
  });

  it('parses URL state and computes sort/page interactions', () => {
    const parsed = parseTableSearchParams(new URLSearchParams('page=3&pageSize=50&sort=createdAt&order=desc&q=hello'), baseProps);
    expect(parsed).toEqual({ page: 3, pageSize: 50, sort: 'createdAt', order: 'desc', q: 'hello' });
    expect(nextSortState({ sort: 'name', order: 'asc' }, 'name')).toEqual({ sort: 'name', order: 'desc' });
    expect(nextSortState({ sort: 'name', order: 'asc' }, 'createdAt')).toEqual({ sort: 'createdAt', order: 'asc' });
  });
});
