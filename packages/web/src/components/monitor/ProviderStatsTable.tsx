import type { ProviderStats, ProviderStatsWindow } from '@/types';

const WINDOW_LABELS: Record<ProviderStatsWindow, string> = {
  '24h': '24h',
  '7d': '7d',
  all: 'all',
};

interface ProviderStatsTableProps {
  windows: Record<ProviderStatsWindow, ProviderStats[]>;
}

export function ProviderStatsTable({ windows }: ProviderStatsTableProps) {
  return (
    <div className="space-y-4" data-testid="provider-stats-table">
      {(Object.keys(WINDOW_LABELS) as ProviderStatsWindow[]).map((windowKey) => (
        <section key={windowKey} className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-muted px-3 py-2 text-sm font-semibold">{`Provider stats · ${WINDOW_LABELS[windowKey]}`}</div>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-3">provider/model</th>
                <th>calls</th>
                <th>success rate</th>
                <th>fallbacks</th>
                <th>avg latency</th>
                <th>tokens</th>
                <th className="p-3">estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {windows[windowKey].map((stat) => (
                <tr key={`${windowKey}:${stat.provider}:${stat.model}`} className="border-t border-border">
                  <td className="p-3 font-mono">{stat.provider}/{stat.model}</td>
                  <td>{stat.callCount}</td>
                  <td>{formatRate(stat.successCount, stat.callCount)} <span className="text-muted-foreground">({stat.successCount}/{stat.failureCount})</span></td>
                  <td>{stat.fallbackCount}</td>
                  <td>{stat.avgLatencyMs === null ? 'n/a' : `${stat.avgLatencyMs} ms`}</td>
                  <td>{`${stat.inputTokens} in / ${stat.outputTokens} out`}</td>
                  <td className="p-3">{stat.estimatedCost > 0 ? stat.estimatedCost.toFixed(4) : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {windows[windowKey].length === 0 ? <p className="p-4 text-sm text-muted-foreground">该窗口暂无 provider 调用数据。</p> : null}
        </section>
      ))}
    </div>
  );
}

function formatRate(successCount: number, callCount: number): string {
  if (callCount <= 0) return 'n/a';
  return `${Math.round((successCount / callCount) * 100)}%`;
}
