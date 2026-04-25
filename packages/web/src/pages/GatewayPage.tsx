import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { useManagementStore } from '@/stores/management';

export function GatewayPage() {
  const {
    gateway,
    gatewayDoctor,
    gatewayLogs,
    loading,
    error,
    loadGateway,
    startGateway,
    stopGateway,
    runGatewayDoctor,
    loadGatewayLogs,
  } = useManagementStore();

  useEffect(() => {
    void loadGateway();
    void loadGatewayLogs();
  }, [loadGateway, loadGatewayLogs]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Gateway</CardTitle>
          <CardDescription>
            查看 Gateway 运行状态，控制 Start/Stop，并执行 Gateway Doctor。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Button onClick={() => void loadGateway()} disabled={loading}>Refresh</Button>
          <Button onClick={() => void startGateway()} disabled={gateway?.running === true}>Start</Button>
          <Button variant="outline" onClick={() => void stopGateway()} disabled={gateway?.running !== true}>Stop</Button>
          <Button variant="outline" onClick={() => void runGatewayDoctor()}>Doctor</Button>
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{gateway?.running ? 'Running' : 'Stopped'}</CardTitle>
            <CardDescription>Gateway Status Panel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>PID: {gateway?.pid ?? '-'}</p>
            <p>Started at: {gateway?.startedAt ?? '-'}</p>
            <p>Connected channels: {gateway?.connectedChannelCount ?? 0}</p>
            <p>PID file: {gateway?.pidFile ?? '-'}</p>
            <p>Log file: {gateway?.logFile ?? '-'}</p>
            <div>
              <p className="font-medium">Enabled channels</p>
              <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                {(gateway?.enabledChannels ?? []).map((channel) => (
                  <li key={channel.id}>{channel.id}: {channel.healthy ? 'healthy' : 'unhealthy'}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gateway Doctor</CardTitle>
            <CardDescription>GET /api/v1/gateway/doctor 健康检查报告。</CardDescription>
          </CardHeader>
          <CardContent>
            {gatewayDoctor ? (
              <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(gatewayDoctor, null, 2)}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">点击 Doctor 运行健康检查。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gateway Logs</CardTitle>
          <CardDescription>轮询 GET /api/v1/gateway/logs 最近 100 行日志。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="mb-3" size="sm" variant="outline" onClick={() => void loadGatewayLogs()}>Reload logs</Button>
          <pre className="min-h-32 overflow-auto rounded-lg bg-muted p-4 text-xs">
            {gatewayLogs.length > 0 ? gatewayLogs.join('\n') : 'No gateway logs yet.'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
