import type { ConfigSource, FieldSource } from '@/stores/config';

export function ConfigSources({ sources, fieldSources }: { sources: ConfigSource[]; fieldSources: Record<string, FieldSource> }) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">配置来源层级</div>
        <table className="w-full text-left text-sm">
          <tbody>
            {sources.map((source) => (
              <tr key={source.id} className="border-b border-border last:border-0">
                <td className="p-3 font-medium">{source.label}</td>
                <td className="p-3">{source.active ? 'active' : source.present ? 'present' : 'missing'}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{source.path ?? '内置/运行时'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-xl border border-border">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">字段生效来源</div>
        <table className="w-full text-left text-sm">
          <tbody>
            {Object.entries(fieldSources).map(([field, source]) => (
              <tr key={field} className="border-b border-border last:border-0">
                <td className="p-3 font-mono">{field}</td>
                <td className="p-3">{source.source}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{source.path ?? 'defaults'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
