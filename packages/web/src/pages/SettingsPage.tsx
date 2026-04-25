import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfigEditor } from '@/components/settings/ConfigEditor';
import { ConfigSources } from '@/components/settings/ConfigSources';
import { useConfigStore } from '@/stores/config';

export function SettingsPage() {
  const { config, rawYaml, sources, fieldSources, channels, loading, saving, saved, error, issues, loadConfig, saveConfig, validateCommonConfig } = useConfigStore();

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <p className="text-sm text-muted-foreground">编辑项目级 .haro/config.yaml；高级 YAML 模式使用 textarea，无新增依赖。Channel 配置在此只读展示，生命周期操作归 FEAT-019。</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading ? <p className="text-muted-foreground">加载配置中…</p> : null}
          {saved ? <p className="text-emerald-600 dark:text-emerald-300">配置已保存，对 CLI 立即生效。</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {config ? (
        <Card>
          <CardHeader>
            <CardTitle>常用配置</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfigEditor
              config={config}
              rawYaml={rawYaml}
              issues={issues}
              saving={saving}
              onSaveConfig={(next) => saveConfig({ config: next })}
              onSaveYaml={(nextRawYaml) => saveConfig({ rawYaml: nextRawYaml })}
              validate={validateCommonConfig}
            />
          </CardContent>
        </Card>
      ) : null}

      <ConfigSources sources={sources} fieldSources={fieldSources} />

      <Card>
        <CardHeader>
          <CardTitle>Channel 配置摘要（只读）</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="pb-2">id</th><th className="pb-2">enabled</th><th className="pb-2">health</th><th className="pb-2">source</th></tr></thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id} className="border-t border-border">
                  <td className="py-2 font-mono">{channel.id}</td>
                  <td>{channel.enabled ? 'enabled' : 'disabled'}</td>
                  <td>{channel.health}</td>
                  <td>{channel.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {channels.length === 0 ? <p className="text-sm text-muted-foreground">暂无 channel 配置。</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
