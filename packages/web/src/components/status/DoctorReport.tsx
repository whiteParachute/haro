import type { DoctorGroup } from '@/stores/system';
import { cn } from '@/lib/utils';

const severityClass: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-300',
  info: 'text-muted-foreground',
};

export function DoctorReport({ groups }: { groups: DoctorGroup[] }) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.id} className="rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <span className="text-xs text-muted-foreground">{group.items.length} checks</span>
          </div>
          <div className="divide-y divide-border">
            {group.items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">所有检查通过</p> : null}
            {group.items.map((item, index) => (
              <div key={`${group.id}-${index}`} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('font-mono text-xs uppercase', severityClass[item.severity])}>{item.severity}</span>
                  <span>{item.message}</span>
                </div>
                {item.path ? <div className="mt-1 font-mono text-xs text-muted-foreground">{item.path}</div> : null}
                {item.suggestion ? <div className="mt-2 text-xs text-muted-foreground">修复建议：{item.suggestion}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
