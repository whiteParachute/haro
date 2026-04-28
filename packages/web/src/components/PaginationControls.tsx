import { Button } from '@/components/ui/Button';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';

export interface PaginationControlState {
  page: number;
  pageSize: number;
  total: number;
}

export function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationControlState & {
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const t = useT();
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t(K.TABLE.PAGE_SIZE)}</span>
        <select
          className="rounded-md border border-input bg-background px-2 py-1"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {[10, 20, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t(K.TABLE.PAGE_INFO, { page, totalPages })}</span>
        <Button aria-label={t(K.TABLE.PREVIOUS)} variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>{t(K.TABLE.PREVIOUS)}</Button>
        <Button aria-label={t(K.TABLE.NEXT)} variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>{t(K.TABLE.NEXT)}</Button>
      </div>
    </div>
  );
}
