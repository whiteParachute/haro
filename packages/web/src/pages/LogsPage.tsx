import { useEffect } from 'react';
import { PaginatedTable, type PaginatedTableState } from '@/components/PaginatedTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useLogsStore } from '@/stores/logs';
import type { LogSessionEventRecord, ProviderFallbackRecord } from '@/types';

export function LogsPage() {
  const t = useT();
  const { events, fallbacks, total, query, loading, error, loadLogs } = useLogsStore();

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleChange = (next: Partial<PaginatedTableState>) => {
    void loadLogs(next);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{t(K.LOGS.TITLE)}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t(K.LOGS.DESC)}</p>
          </div>
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>{t(K.COMMON.REFRESH)}</Button>
        </CardHeader>
      </Card>

      <PaginatedTable<LogSessionEventRecord>
        columns={[
          { key: 'createdAt', header: t(K.SESSIONS.CREATED_AT), sortable: true },
          { key: 'sessionId', header: t(K.SESSIONS.ID), sortable: true },
          { key: 'agentId', header: t(K.SESSIONS.AGENT), sortable: true },
          { key: 'eventType', header: t(K.LOGS.EVENT_TYPE), sortable: true },
          { key: 'provider', header: t(K.SESSIONS.PROVIDER), sortable: true, render: (item) => `${item.provider}/${item.model}` },
          { key: 'latencyMs', header: t(K.LOGS.LATENCY), sortable: true },
          { key: 'payload', header: t(K.LOGS.PAYLOAD), render: (item) => <pre className="max-w-lg overflow-auto text-xs">{JSON.stringify(item.payload, null, 2)}</pre> },
        ]}
        rows={events}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        sort={query.sort}
        order={query.order}
        q={query.q}
        onChange={handleChange}
        loading={loading}
        error={error}
        emptyMessage={t(K.LOGS.EMPTY)}
        onRetry={() => void loadLogs()}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t(K.LOGS.FALLBACK_TITLE)}</CardTitle>
        </CardHeader>
        <CardContent>
          <FallbackTable rows={fallbacks} />
        </CardContent>
      </Card>
    </div>
  );
}

function FallbackTable({ rows }: { rows: ProviderFallbackRecord[] }) {
  const t = useT();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t(K.TABLE.EMPTY)}</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr><th className="p-3">{t(K.SESSIONS.CREATED_AT)}</th><th>{t(K.SESSIONS.ID)}</th><th>original</th><th>fallback</th><th>trigger</th></tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="p-3 font-mono text-xs">{item.createdAt}</td>
              <td className="font-mono text-xs">{item.sessionId}</td>
              <td>{item.originalProvider}/{item.originalModel}</td>
              <td>{item.fallbackProvider}/{item.fallbackModel}</td>
              <td>{item.trigger}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
