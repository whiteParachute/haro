export interface LiveSessionRecord {
  sessionId: string;
  status: string;
  updatedAt: string;
}

interface LiveSessionMonitorProps {
  sessions: LiveSessionRecord[];
  activeSessions: number;
  connected: boolean;
  gatewayConnected?: boolean;
  uptimeSeconds?: number;
}

export function LiveSessionMonitor({ sessions, activeSessions, connected, gatewayConnected, uptimeSeconds }: LiveSessionMonitorProps) {
  return (
    <div className="space-y-3" data-testid="live-session-monitor">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="WebSocket" value={connected ? 'connected' : 'reconnecting'} />
        <Metric label="active sessions" value={String(activeSessions)} />
        <Metric label="gateway" value={gatewayConnected ? 'connected' : 'not connected'} />
        <Metric label="uptime" value={uptimeSeconds === undefined ? 'n/a' : `${uptimeSeconds}s`} />
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr><th className="p-3">sessionId</th><th>status</th><th className="p-3">updatedAt</th></tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.sessionId} className="border-t border-border">
                <td className="p-3 font-mono">{session.sessionId}</td>
                <td>{session.status}</td>
                <td className="p-3 font-mono text-xs">{session.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">暂无活跃 session.update。</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
