import { useEffect, useState } from 'react';
import { getProviderStats } from '@/api/client';
import { ProviderStatsTable } from '@/components/monitor/ProviderStatsTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ProviderStatsResponse } from '@/types';

const EMPTY_STATS: ProviderStatsResponse = { windows: { '24h': [], '7d': [], all: [] }, generatedAt: '' };

export function InvokeAgentPage() {
  const [stats, setStats] = useState<ProviderStatsResponse>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getProviderStats();
      setStats(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Invoke Agent / Provider Monitoring</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">从 session_events、provider_fallback_log 与 token budget ledger 聚合 provider/model 调用、成功率、fallback、延迟和 token 趋势。</p>
            {stats.generatedAt ? <p className="mt-1 text-xs text-muted-foreground">generatedAt {stats.generatedAt}</p> : null}
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>
        </CardHeader>
        {error ? <CardContent className="text-sm text-destructive">{error}</CardContent> : null}
      </Card>
      <ProviderStatsTable windows={stats.windows} />
    </div>
  );
}
