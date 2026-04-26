import { Button } from '@/components/ui/Button';
import type { MemoryQueryFilters } from '@/types';

interface MemorySearchProps {
  filters: MemoryQueryFilters;
  onChange: (filters: MemoryQueryFilters) => void;
  onSearch: () => void;
  loading?: boolean;
}

export function MemorySearch({ filters, onChange, onSearch, loading = false }: MemorySearchProps) {
  return (
    <form
      className="grid gap-3 md:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Keyword
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={filters.keyword ?? ''}
          onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
          placeholder="memory keyword"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Scope
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={filters.scope ?? ''}
          onChange={(event) => onChange({ ...filters, scope: event.target.value as MemoryQueryFilters['scope'] })}
        >
          <option value="">all</option>
          <option value="shared">shared</option>
          <option value="agent">agent</option>
          <option value="platform">platform (read-only)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Agent ID
        <input
          className="rounded-md border border-border bg-background px-3 py-2 disabled:opacity-50"
          value={filters.agentId ?? ''}
          disabled={filters.scope !== 'agent'}
          onChange={(event) => onChange({ ...filters, agentId: event.target.value })}
          placeholder="haro-assistant"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Layer
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={filters.layer ?? ''}
          onChange={(event) => onChange({ ...filters, layer: event.target.value as MemoryQueryFilters['layer'] })}
        >
          <option value="">all</option>
          <option value="session">session</option>
          <option value="persistent">persistent</option>
          <option value="skill">skill</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Verification
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={filters.verificationStatus ?? ''}
          onChange={(event) => onChange({ ...filters, verificationStatus: event.target.value as MemoryQueryFilters['verificationStatus'] })}
        >
          <option value="">all</option>
          <option value="unverified">unverified</option>
          <option value="verified">verified</option>
          <option value="conflicted">conflicted</option>
          <option value="rejected">rejected</option>
        </select>
      </label>
      <div className="md:col-span-5">
        <Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search Memory'}</Button>
      </div>
    </form>
  );
}
