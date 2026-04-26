import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MemorySearchResult } from '@/types';

export function MemoryResultCard({ result }: { result: MemorySearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const entry = result.entry;

  return (
    <Card data-memory-entry-id={entry.id}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{entry.summary}</CardTitle>
            <CardDescription>
              {entry.scope} · {entry.layer} · {entry.sourceRef} · {entry.updatedAt}
            </CardDescription>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{entry.verificationStatus}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 text-muted-foreground md:grid-cols-2">
          <span>sourceRef: {entry.sourceRef}</span>
          <span>assetRef: {entry.assetRef ?? 'none'}</span>
          <span>timestamp: {entry.updatedAt}</span>
          <span>rank: {result.rank} · score: {result.score}</span>
        </div>
        {expanded ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{entry.content}</pre>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Collapse content' : 'Expand content'}
        </Button>
      </CardContent>
    </Card>
  );
}
