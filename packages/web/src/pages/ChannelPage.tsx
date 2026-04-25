import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { useManagementStore, type ChannelSummary } from '@/stores/management';

export function ChannelPage() {
  const {
    channels,
    channelDoctor,
    loading,
    error,
    loadChannels,
    enableChannel,
    disableChannel,
    removeChannel,
    runChannelDoctor,
    setupChannel,
  } = useManagementStore();

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            管理 Haro channel 生命周期：启用、禁用、移除、Doctor 与 Setup。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Button onClick={() => void loadChannels()} disabled={loading}>Refresh</Button>
          {error ? <span className="text-destructive">{error}</span> : null}
          <span className="text-muted-foreground">Contract: /api/v1/channels*</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {channels.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">暂无已注册 Channel。</CardContent>
          </Card>
        ) : channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            onEnable={() => void enableChannel(channel.id)}
            onDisable={() => void disableChannel(channel.id)}
            onRemove={() => {
              if (globalThis.confirm?.(`Remove channel ${channel.id}?`) ?? true) void removeChannel(channel.id);
            }}
            onDoctor={() => void runChannelDoctor(channel.id)}
            onSetup={() => void setupChannel(channel.id)}
          />
        ))}
      </div>

      {channelDoctor ? (
        <Card>
          <CardHeader>
            <CardTitle>Channel Doctor Report</CardTitle>
            <CardDescription>最近一次 Channel 健康检查结果。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(channelDoctor, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ChannelCard({
  channel,
  onEnable,
  onDisable,
  onRemove,
  onDoctor,
  onSetup,
}: {
  channel: ChannelSummary;
  onEnable: () => void;
  onDisable: () => void;
  onRemove: () => void;
  onDoctor: () => void;
  onSetup: () => void;
}) {
  const capabilities = Object.entries(channel.capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{channel.displayName}</CardTitle>
            <CardDescription>{channel.id} · {channel.source} · {channel.configSource}</CardDescription>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {channel.enabled ? channel.health : 'disabled'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
          <span>Enabled: {String(channel.enabled)}</span>
          <span>Last checked: {channel.lastCheckedAt}</span>
          <span>Removable: {String(channel.removable)}</span>
          <span>Capabilities: {capabilities.join(', ') || 'none'}</span>
        </div>
        {channel.error ? <p className="text-destructive">{channel.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={channel.enabled ? onDisable : onEnable}>
            {channel.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="outline" onClick={onDoctor}>Doctor</Button>
          <Button size="sm" variant="outline" onClick={onSetup}>Setup</Button>
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={!channel.removable}>Remove</Button>
        </div>
      </CardContent>
    </Card>
  );
}
