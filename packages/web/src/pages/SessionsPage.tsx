import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useSessionsStore } from '@/stores/sessions';

export function SessionsPage() {
  const { items, total, loading, error, loadSessions, deleteSession } = useSessionsStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [agentId, setAgentId] = useState('');

  useEffect(() => {
    void loadSessions({ limit: 20 });
  }, [loadSessions]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <input className="rounded-md border border-input bg-background px-2 py-2" placeholder="status" value={status} onChange={(event) => setStatus(event.target.value)} />
          <input className="rounded-md border border-input bg-background px-2 py-2" placeholder="agentId" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
          <Button onClick={() => void loadSessions({ status: status || undefined, agentId: agentId || undefined, limit: 20 })}>筛选</Button>
          <span className="self-center text-muted-foreground">total {total}</span>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr><th className="p-3">sessionId</th><th>agentId</th><th>status</th><th>createdAt</th><th /></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.sessionId} className="border-t border-border align-top">
                <td className="p-3 font-mono"><Link className="underline" to={`/sessions/${item.sessionId}`}>{item.sessionId}</Link></td>
                <td>{item.agentId}</td>
                <td>{item.status}</td>
                <td>{item.createdAt}</td>
                <td className="space-x-2 p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === item.sessionId ? null : item.sessionId)}>详情</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteSession(item.sessionId)}>删除</Button>
                  {expanded === item.sessionId ? <pre className="mt-2 text-left text-xs text-muted-foreground">{JSON.stringify(item, null, 2)}</pre> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? <p className="p-4 text-sm text-muted-foreground">加载中…</p> : null}
      </div>
    </div>
  );
}
