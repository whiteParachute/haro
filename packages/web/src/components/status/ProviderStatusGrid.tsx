import type { ChannelHealthSummary, ProviderHealthSummary } from '@/stores/system';

export function ProviderStatusGrid({ providers, channels }: { providers: ProviderHealthSummary[]; channels: ChannelHealthSummary[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StatusTable
        title="Providers"
        empty="暂无 provider 健康数据"
        rows={providers.map((provider) => ({ id: provider.id, state: provider.healthy ? 'healthy' : 'unhealthy', detail: provider.error ?? 'runtime healthCheck()' }))}
      />
      <StatusTable
        title="Channels（只读摘要）"
        empty="暂无 channel 配置"
        rows={channels.map((channel) => ({ id: channel.id, state: channel.enabled ? channel.health : 'disabled', detail: `${channel.source} · ${channel.lastCheckedAt}` }))}
      />
    </div>
  );
}

function StatusTable({ title, rows, empty }: { title: string; rows: Array<{ id: string; state: string; detail: string }>; empty: string }) {
  return (
    <section className="rounded-xl border border-border">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{empty}</p> : null}
      {rows.length > 0 ? (
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="p-3 font-mono">{row.id}</td>
                <td className="p-3">{row.state}</td>
                <td className="p-3 text-xs text-muted-foreground">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
