import { useCallback, useEffect, useMemo, useState } from 'react';
import { queryMemory, runMemoryMaintenance, writeMemory } from '@/api/client';
import { MemoryResultCard } from '@/components/knowledge/MemoryResultCard';
import { MemorySearch } from '@/components/knowledge/MemorySearch';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MemoryQueryFilters, MemorySearchResult } from '@/types';

interface KnowledgePageViewProps {
  results: MemorySearchResult[];
  filters: MemoryQueryFilters;
  onFiltersChange: (filters: MemoryQueryFilters) => void;
  onSearch: () => void;
  onWrite: (input: KnowledgeWriteState) => void;
  onMaintenance: () => void;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
}

export interface KnowledgeWriteState {
  scope: 'shared' | 'agent';
  agentId: string;
  topic: string;
  summary: string;
  content: string;
  assetRef: string;
}

const defaultFilters: MemoryQueryFilters = { keyword: '', scope: '', layer: '', verificationStatus: '', limit: 20 };
const defaultWriteState: KnowledgeWriteState = {
  scope: 'shared',
  agentId: '',
  topic: '',
  summary: '',
  content: '',
  assetRef: '',
};

export function KnowledgePage() {
  const [filters, setFilters] = useState<MemoryQueryFilters>(defaultFilters);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await queryMemory(filters);
      setResults(response.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <KnowledgePageView
      results={results}
      filters={filters}
      onFiltersChange={setFilters}
      onSearch={() => void load()}
      onWrite={(input) => {
        void (async () => {
          setLoading(true);
          setError(null);
          setMessage(null);
          try {
            await writeMemory({
              scope: input.scope,
              agentId: input.scope === 'agent' ? input.agentId : undefined,
              layer: 'persistent',
              topic: input.topic,
              summary: input.summary || undefined,
              content: input.content,
              sourceRef: 'web-dashboard',
              assetRef: input.assetRef || undefined,
              verificationStatus: 'unverified',
            });
            setMessage('Memory write accepted');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setLoading(false);
          }
        })();
      }}
      onMaintenance={() => {
        void (async () => {
          const response = await runMemoryMaintenance({});
          setMessage(`Maintenance accepted: ${response.data.taskId}`);
        })();
      }}
      loading={loading}
      error={error}
      message={message}
    />
  );
}

export function KnowledgePageView({
  results,
  filters,
  onFiltersChange,
  onSearch,
  onWrite,
  onMaintenance,
  loading = false,
  error = null,
  message = null,
}: KnowledgePageViewProps) {
  const [draft, setDraft] = useState<KnowledgeWriteState>(defaultWriteState);
  const canWrite = draft.topic.trim().length > 0 && draft.content.trim().length > 0 && (draft.scope === 'shared' || draft.agentId.trim().length > 0);
  const scopeLabel = useMemo(() => (draft.scope === 'shared' ? 'shared（默认）' : 'agent（需要 agentId）'), [draft.scope]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Knowledge</CardTitle>
          <CardDescription>
            搜索 Memory Fabric v1，并安全写入 shared 或当前 agent scope；platform 仅只读展示。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MemorySearch filters={filters} onChange={onFiltersChange} onSearch={onSearch} loading={loading} />
          <div className="flex flex-wrap gap-3 text-sm">
            <Button variant="outline" onClick={onMaintenance}>Run async maintenance</Button>
            <span className="text-muted-foreground">Contract: /api/v1/memory/query · write · stats · maintenance</span>
            {message ? <span>{message}</span> : null}
            {error ? <span className="text-destructive">{error}</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Write Memory</CardTitle>
          <CardDescription>
            写入入口不提供 platform scope；当前选择：{scopeLabel}。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <label className="flex flex-col gap-1">
            Write scope
            <select
              className="rounded-md border border-border bg-background px-3 py-2"
              value={draft.scope}
              onChange={(event) => setDraft({ ...draft, scope: event.target.value as 'shared' | 'agent' })}
            >
              <option value="shared">shared</option>
              <option value="agent">agent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Agent ID
            <input
              className="rounded-md border border-border bg-background px-3 py-2 disabled:opacity-50"
              value={draft.agentId}
              disabled={draft.scope !== 'agent'}
              onChange={(event) => setDraft({ ...draft, agentId: event.target.value })}
              placeholder="required for agent scope"
            />
          </label>
          <label className="flex flex-col gap-1">
            Topic
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            Asset ref
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.assetRef} onChange={(event) => setDraft({ ...draft, assetRef: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            Summary
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            Content
            <textarea className="min-h-28 rounded-md border border-border bg-background px-3 py-2" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
          </label>
          <div className="md:col-span-2">
            <Button disabled={!canWrite || loading} onClick={() => onWrite(draft)}>Write shared/agent memory</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {results.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">暂无 Memory 查询结果。</CardContent>
          </Card>
        ) : results.map((result) => <MemoryResultCard key={result.entry.id} result={result} />)}
      </div>
    </div>
  );
}
