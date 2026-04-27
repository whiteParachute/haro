import { useCallback, useEffect, useState } from 'react';
import { listProviderFallbacks, listSessionEvents } from '@/api/client';
import { EventFilterBar } from '@/components/logs/EventFilterBar';
import { EventTable } from '@/components/logs/EventTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { LogSessionEventFilters, LogSessionEventRecord, ProviderFallbackRecord } from '@/types';

export function LogsPage() {
  const [filters, setFilters] = useState<LogSessionEventFilters>({ limit: 100 });
  const [events, setEvents] = useState<LogSessionEventRecord[]>([]);
  const [fallbacks, setFallbacks] = useState<ProviderFallbackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilters: LogSessionEventFilters) => {
    setLoading(true);
    setError(null);
    try {
      const [eventResponse, fallbackResponse] = await Promise.all([
        listSessionEvents(nextFilters),
        listProviderFallbacks({ sessionId: nextFilters.sessionId, from: nextFilters.from, to: nextFilters.to, limit: nextFilters.limit }),
      ]);
      setEvents(eventResponse.data.items);
      setFallbacks(fallbackResponse.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ limit: 100 });
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Runtime Logs</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">按 sessionId、agentId、eventType 和时间范围查询 session_events，保留结构化 JSON payload。</p>
          </div>
          <Button variant="outline" onClick={() => void load(filters)} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>
        </CardHeader>
        <CardContent>
          <EventFilterBar filters={filters} onChange={setFilters} onApply={() => void load(filters)} loading={loading} />
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <EventTable events={events} />

      <Card>
        <CardHeader>
          <CardTitle>Provider fallback log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr><th className="p-3">createdAt</th><th>sessionId</th><th>original provider</th><th>fallback provider</th><th>trigger</th><th className="p-3">ruleId</th></tr>
              </thead>
              <tbody>
                {fallbacks.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="p-3 font-mono text-xs">{item.createdAt}</td>
                    <td className="font-mono text-xs">{item.sessionId}</td>
                    <td>{item.originalProvider}/{item.originalModel}</td>
                    <td>{item.fallbackProvider}/{item.fallbackModel}</td>
                    <td>{item.trigger}</td>
                    <td className="p-3">{item.ruleId ?? 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fallbacks.length === 0 ? <p className="p-4 text-sm text-muted-foreground">暂无 provider fallback 记录。</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
