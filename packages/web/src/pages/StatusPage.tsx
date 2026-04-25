import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { DoctorReport } from '@/components/status/DoctorReport';
import { HealthCard } from '@/components/status/HealthCard';
import { ProviderStatusGrid } from '@/components/status/ProviderStatusGrid';
import { useSystemStore } from '@/stores/system';

export function StatusPage() {
  const { status, doctor, loading, error, refresh } = useSystemStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writable = doctor?.dataDir.checks.filter((check) => check.writable).length ?? 0;
  const totalDirs = doctor?.dataDir.checks.length ?? 0;
  const unhealthyChannels = status?.channels.filter((channel) => channel.health === 'unhealthy').length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Status</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">系统状态、doctor 分组报告与 Channel 只读健康摘要。</p>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>
        </CardHeader>
        {error ? <CardContent className="text-sm text-destructive">{error}</CardContent> : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <HealthCard title="Database" value={status?.database.ok ? 'OK' : 'Unknown'} detail={status?.database.dbFile} tone={status?.database.ok ? 'ok' : 'unknown'} />
        <HealthCard title="Filesystem" value={totalDirs ? `${writable}/${totalDirs}` : 'Unknown'} detail="writable directories" tone={totalDirs && writable === totalDirs ? 'ok' : 'warn'} />
        <HealthCard title="Providers" value={`${status?.providers.filter((item) => item.healthy).length ?? 0}/${status?.providers.length ?? 0}`} detail="healthy providers" tone={status?.providers.some((item) => !item.healthy) ? 'error' : 'ok'} />
        <HealthCard title="Channels" value={`${status?.channels.length ?? 0}`} detail={`${unhealthyChannels} unhealthy · FEAT-019 owns actions`} tone={unhealthyChannels > 0 ? 'warn' : 'ok'} />
        <HealthCard title="Sessions" value={`${status?.sessions.total ?? 0}`} detail={`${status?.sessions.today ?? 0} today · ${formatRate(status?.sessions.successRate)} success`} tone="unknown" />
      </div>

      {status ? <ProviderStatusGrid providers={status.providers} channels={status.channels} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Doctor Report</CardTitle>
        </CardHeader>
        <CardContent>
          {doctor ? <DoctorReport groups={doctor.groups} /> : <p className="text-sm text-muted-foreground">加载 doctor 报告中…</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  return `${Math.round(value * 100)}%`;
}
