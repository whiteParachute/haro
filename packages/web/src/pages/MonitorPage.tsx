import { useEffect, useMemo, useState } from 'react';
import { DashboardWebSocketClient, type ServerMessage } from '@/api/ws';
import { getProviderStats } from '@/api/client';
import { LiveSessionMonitor, type LiveSessionRecord } from '@/components/monitor/LiveSessionMonitor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ProviderStatsResponse } from '@/types';

interface Metrics {
  activeSessions: number;
  dbConnections: number;
  gatewayConnected: boolean;
  uptimeSeconds: number;
}

const EMPTY_STATS: ProviderStatsResponse = { windows: { '24h': [], '7d': [], all: [] }, generatedAt: '' };

export function MonitorPage() {
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({ activeSessions: 0, dbConnections: 0, gatewayConnected: false, uptimeSeconds: 0 });
  const [sessions, setSessions] = useState<LiveSessionRecord[]>([]);
  const [stats, setStats] = useState<ProviderStatsResponse>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = new DashboardWebSocketClient();
    const unsubscribe = client.onMessage((message: ServerMessage) => {
      if (message.type === 'authenticated') setConnected(message.ok);
      if (message.type === 'system.status') {
        setConnected(true);
        setMetrics(message.metrics);
      }
      if (message.type === 'session.update') {
        setSessions((current) => upsertSession(current, { sessionId: message.sessionId, status: message.status, updatedAt: new Date().toISOString() }));
      }
    });
    client.connect();
    client.send({ type: 'subscribe', channel: 'system' });
    client.send({ type: 'subscribe', channel: 'sessions' });
    return () => {
      unsubscribe();
      client.close();
    };
  }, []);

  useEffect(() => {
    getProviderStats().then((response) => setStats(response.data)).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const alerts = useMemo(() => buildAlerts(stats), [stats]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Runtime Monitor</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">订阅 WebSocket system.status 与 session.update，展示活跃 session；provider 告警只读展示，不修改 provider selection rules。</p>
        </CardHeader>
        {error ? <CardContent className="text-sm text-destructive">{error}</CardContent> : null}
      </Card>

      <LiveSessionMonitor sessions={sessions} activeSessions={metrics.activeSessions} connected={connected} gatewayConnected={metrics.gatewayConnected} uptimeSeconds={metrics.uptimeSeconds} />

      <Card>
        <CardHeader><CardTitle>Provider alerts</CardTitle></CardHeader>
        <CardContent>
          {alerts.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {alerts.map((alert) => <li key={alert} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">{alert}</li>)}
            </ul>
          ) : <p className="text-sm text-muted-foreground">暂无 provider unhealthy / fallback spike 告警。</p>}
          <p className="mt-3 text-xs text-muted-foreground">只展示告警；本页不会自动切换 provider，也不会修改 selection rules。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function upsertSession(current: LiveSessionRecord[], next: LiveSessionRecord): LiveSessionRecord[] {
  const without = current.filter((item) => item.sessionId !== next.sessionId);
  const updated = [next, ...without].filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status));
  return updated.slice(0, 20);
}

function buildAlerts(stats: ProviderStatsResponse): string[] {
  const alerts: string[] = [];
  for (const stat of stats.windows['24h']) {
    if (stat.callCount >= 3 && stat.successCount === 0) alerts.push(`provider unhealthy: ${stat.provider}/${stat.model} 24h success rate 0%`);
    if (stat.fallbackCount >= 3) alerts.push(`fallback spike: ${stat.provider}/${stat.model} 24h fallbacks ${stat.fallbackCount}`);
  }
  return alerts;
}
