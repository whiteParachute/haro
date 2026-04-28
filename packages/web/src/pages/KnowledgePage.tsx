import { useEffect, useState } from 'react';
import { PaginatedTable, type PaginatedTableState } from '@/components/PaginatedTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useKnowledgeStore } from '@/stores/knowledge';
import type { MemorySearchResult } from '@/types';

export interface KnowledgeWriteState {
  scope: 'shared' | 'agent';
  agentId: string;
  topic: string;
  summary: string;
  content: string;
  assetRef: string;
}

const defaultWriteState: KnowledgeWriteState = {
  scope: 'shared',
  agentId: '',
  topic: '',
  summary: '',
  content: '',
  assetRef: '',
};

interface KnowledgePageViewProps {
  results: MemorySearchResult[];
  filters: Record<string, unknown>;
  onFiltersChange: (filters: Record<string, unknown>) => void;
  onSearch: () => void;
  onWrite: (input: KnowledgeWriteState) => void;
  onMaintenance: () => void;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
}

export function KnowledgePage() {
  const t = useT();
  const { results, total, query, loading, error, message, loadKnowledge, writeKnowledge, runMaintenance } = useKnowledgeStore();
  const [draft, setDraft] = useState<KnowledgeWriteState>(defaultWriteState);
  const canWrite = draft.topic.trim().length > 0 && draft.content.trim().length > 0 && (draft.scope === 'shared' || draft.agentId.trim().length > 0);

  useEffect(() => {
    void loadKnowledge();
  }, [loadKnowledge]);

  const handleChange = (next: Partial<PaginatedTableState>) => {
    void loadKnowledge(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Knowledge / {t(K.KNOWLEDGE.TITLE)}</CardTitle>
          <CardDescription>{t(K.KNOWLEDGE.DESC)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Button variant="outline" onClick={() => void runMaintenance()}>{t(K.KNOWLEDGE.MAINTENANCE)}</Button>
          {message ? <span>{message}</span> : null}
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>

      <PaginatedTable<MemorySearchResult>
        columns={[
          { key: 'topic', header: t(K.KNOWLEDGE.TOPIC), sortable: true, render: (item) => item.entry.topic },
          { key: 'scope', header: t(K.KNOWLEDGE.SCOPE), sortable: true, render: (item) => item.entry.scope },
          { key: 'layer', header: t(K.KNOWLEDGE.LAYER), sortable: true, render: (item) => item.entry.layer },
          { key: 'summary', header: t(K.KNOWLEDGE.SUMMARY), render: (item) => item.entry.summary },
          { key: 'updatedAt', header: t(K.KNOWLEDGE.UPDATED_AT), sortable: true, render: (item) => item.entry.updatedAt },
        ]}
        rows={results}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        sort={query.sort}
        order={query.order}
        q={query.q}
        onChange={handleChange}
        loading={loading}
        error={error}
        emptyMessage={t(K.KNOWLEDGE.EMPTY)}
        onRetry={() => void loadKnowledge()}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t(K.KNOWLEDGE.WRITE_TITLE)}</CardTitle>
          <CardDescription>platform scope read-only；写入只允许 shared 或当前 agent。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <label className="flex flex-col gap-1">
            {t(K.KNOWLEDGE.SCOPE)}
            <select className="rounded-md border border-border bg-background px-3 py-2" value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as 'shared' | 'agent' })}>
              <option value="shared">shared</option>
              <option value="agent">agent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Agent ID
            <input className="rounded-md border border-border bg-background px-3 py-2 disabled:opacity-50" value={draft.agentId} disabled={draft.scope !== 'agent'} onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {t(K.KNOWLEDGE.TOPIC)}
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            Asset ref
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.assetRef} onChange={(event) => setDraft({ ...draft, assetRef: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            {t(K.KNOWLEDGE.SUMMARY)}
            <input className="rounded-md border border-border bg-background px-3 py-2" value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            {t(K.KNOWLEDGE.CONTENT)}
            <textarea className="min-h-28 rounded-md border border-border bg-background px-3 py-2" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
          </label>
          <div className="md:col-span-2">
            <Button disabled={!canWrite || loading} onClick={() => void writeKnowledge(draft)}>{t(K.KNOWLEDGE.WRITE)}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function KnowledgePageView({
  results,
  filters: _filters,
  onFiltersChange: _onFiltersChange,
  onSearch,
  onWrite,
  onMaintenance,
  loading = false,
  error = null,
  message = null,
}: KnowledgePageViewProps) {
  const t = useT();
  const [draft, setDraft] = useState<KnowledgeWriteState>(defaultWriteState);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Knowledge / {t(K.KNOWLEDGE.TITLE)}</CardTitle>
          <CardDescription>{t(K.KNOWLEDGE.DESC)} platform (read-only)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Button variant="outline" onClick={onMaintenance}>{t(K.KNOWLEDGE.MAINTENANCE)}</Button>
          <Button variant="outline" onClick={onSearch} disabled={loading}>{t(K.COMMON.SEARCH)}</Button>
          {message ? <span>{message}</span> : null}
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>
      <div className="grid gap-4">
        {results.length === 0 ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">{t(K.KNOWLEDGE.EMPTY)}</CardContent></Card> : results.map((result) => (
          <Card key={result.entry.id}>
            <CardHeader><CardTitle>{result.entry.topic}</CardTitle><CardDescription>{result.entry.summary}</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>sourceRef: {result.entry.sourceRef}</p>
              <p>{result.entry.verificationStatus}</p>
              <p>{result.entry.assetRef}</p>
              <p>{result.entry.updatedAt}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>{t(K.KNOWLEDGE.WRITE_TITLE)}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as 'shared' | 'agent' })}>
            <option value="shared">shared</option>
            <option value="agent">agent</option>
          </select>
          <Button onClick={() => onWrite(draft)}>{t(K.KNOWLEDGE.WRITE)}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
