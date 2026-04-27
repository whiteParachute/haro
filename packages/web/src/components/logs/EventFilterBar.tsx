import { Button } from '@/components/ui/Button';
import type { LogSessionEventFilters } from '@/types';

interface EventFilterBarProps {
  filters: LogSessionEventFilters;
  onChange: (filters: LogSessionEventFilters) => void;
  onApply: () => void;
  loading?: boolean;
}

export function EventFilterBar({ filters, onChange, onApply, loading = false }: EventFilterBarProps) {
  const update = (key: keyof LogSessionEventFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="grid gap-2 text-sm md:grid-cols-6" data-testid="event-filter-bar">
      <input className="rounded-md border border-input bg-background px-2 py-2" placeholder="sessionId" value={filters.sessionId ?? ''} onChange={(event) => update('sessionId', event.target.value)} />
      <input className="rounded-md border border-input bg-background px-2 py-2" placeholder="agentId" value={filters.agentId ?? ''} onChange={(event) => update('agentId', event.target.value)} />
      <input className="rounded-md border border-input bg-background px-2 py-2" placeholder="eventType" value={filters.eventType ?? ''} onChange={(event) => update('eventType', event.target.value)} />
      <input className="rounded-md border border-input bg-background px-2 py-2" aria-label="from" type="datetime-local" value={filters.from ?? ''} onChange={(event) => update('from', event.target.value)} />
      <input className="rounded-md border border-input bg-background px-2 py-2" aria-label="to" type="datetime-local" value={filters.to ?? ''} onChange={(event) => update('to', event.target.value)} />
      <Button onClick={onApply} disabled={loading}>{loading ? '筛选中…' : '筛选 Session Events'}</Button>
    </div>
  );
}
