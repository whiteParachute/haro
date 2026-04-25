import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useSessionsStore, type SessionEventRecord } from '@/stores/sessions';

interface FoldedEntry {
  key: string;
  type: 'message' | 'event';
  content?: string;
  event?: SessionEventRecord;
}

export function SessionDetailPage() {
  const { id } = useParams();
  const { detail, events, loading, error, loadSessionDetail } = useSessionsStore();

  useEffect(() => {
    if (id) void loadSessionDetail(id);
  }, [id, loadSessionDetail]);

  const folded = useMemo(() => foldEvents(events), [events]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <Card>
        <CardHeader><CardTitle>Session Detail</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {detail ? <pre className="overflow-auto rounded-md bg-muted p-3">{JSON.stringify(detail, null, 2)}</pre> : null}
          {loading ? <p className="text-muted-foreground">加载中…</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
      <div className="space-y-3">
        {folded.map((entry) => entry.type === 'message' ? (
          <Card key={entry.key}><CardContent className="pt-6 whitespace-pre-wrap text-sm">{entry.content}</CardContent></Card>
        ) : (
          <EventCard key={entry.key} record={entry.event!} />
        ))}
      </div>
    </div>
  );
}

function EventCard({ record }: { record: SessionEventRecord }) {
  const [expanded, setExpanded] = useState(record.eventType !== 'tool_call' && record.eventType !== 'tool_result');
  return (
    <Card>
      <CardHeader>
        <button className="text-left text-sm font-semibold" onClick={() => setExpanded((value) => !value)}>
          {record.eventType} · {record.createdAt} {expanded ? '▲' : '▼'}
        </button>
      </CardHeader>
      {expanded ? <CardContent><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(record.event, null, 2)}</pre></CardContent> : null}
    </Card>
  );
}

function foldEvents(events: SessionEventRecord[]): FoldedEntry[] {
  const folded: FoldedEntry[] = [];
  let buffer = '';
  let bufferKey = '';
  for (const record of events) {
    const event = record.event;
    if (isTextLike(event)) {
      buffer += event.content;
      bufferKey ||= `message-${record.id}`;
      continue;
    }
    if (buffer) {
      folded.push({ key: bufferKey, type: 'message', content: buffer });
      buffer = '';
      bufferKey = '';
    }
    folded.push({ key: `event-${record.id}`, type: 'event', event: record });
  }
  if (buffer) folded.push({ key: bufferKey, type: 'message', content: buffer });
  return folded;
}

function isTextLike(event: unknown): event is { type: 'text' | 'result'; content: string } {
  return typeof event === 'object' && event !== null && 'content' in event &&
    ((event as { type?: unknown }).type === 'text' || (event as { type?: unknown }).type === 'result') &&
    typeof (event as { content?: unknown }).content === 'string';
}
