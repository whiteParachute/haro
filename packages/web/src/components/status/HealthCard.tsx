import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export type HealthTone = 'ok' | 'warn' | 'error' | 'unknown';

const toneClass: Record<HealthTone, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  error: 'border-destructive/50 bg-destructive/5 text-destructive',
  unknown: 'border-border bg-card text-muted-foreground',
};

export function HealthCard({ title, value, detail, tone = 'unknown' }: { title: string; value: string; detail?: string; tone?: HealthTone }) {
  return (
    <Card className={cn('min-h-32', toneClass[tone])}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}
