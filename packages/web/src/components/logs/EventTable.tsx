import type { LogSessionEventRecord } from '@/types';

interface EventTableProps {
  events: LogSessionEventRecord[];
}

export function EventTable({ events }: EventTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-testid="event-table">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="p-3">createdAt</th>
            <th>session / agent</th>
            <th>eventType</th>
            <th>provider</th>
            <th>latency</th>
            <th className="p-3">payload JSON</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-border align-top">
              <td className="p-3 font-mono text-xs">{event.createdAt}</td>
              <td className="font-mono text-xs"><div>{event.sessionId}</div><div className="text-muted-foreground">{event.agentId}</div></td>
              <td>{event.eventType}</td>
              <td>{event.provider}/{event.model}</td>
              <td>{event.latencyMs ?? 'n/a'} ms</td>
              <td className="p-3">
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{formatPayload(event.payload)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 ? <p className="p-4 text-sm text-muted-foreground">暂无 session events。</p> : null}
    </div>
  );
}

function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload, null, 2);
}
