import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { ConfigValidationIssue } from '@/stores/config';

type ConfigRecord = Record<string, unknown>;

export function ConfigEditor({ config, rawYaml, issues, saving, onSaveConfig, onSaveYaml, validate }: {
  config: ConfigRecord;
  rawYaml: string;
  issues: ConfigValidationIssue[];
  saving: boolean;
  onSaveConfig: (config: ConfigRecord) => Promise<boolean>;
  onSaveYaml: (rawYaml: string) => Promise<boolean>;
  validate: (input: { loggingLevel?: string; defaultAgent?: string; taskTimeoutMs?: string }) => ConfigValidationIssue[];
}) {
  const [loggingLevel, setLoggingLevel] = useState(stringValue(getPath(config, 'logging.level')) || 'info');
  const [defaultAgent, setDefaultAgent] = useState(stringValue(getPath(config, 'defaultAgent')));
  const [taskTimeoutMs, setTaskTimeoutMs] = useState(stringValue(getPath(config, 'runtime.taskTimeoutMs')));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [yamlText, setYamlText] = useState(rawYaml);
  const [localIssues, setLocalIssues] = useState<ConfigValidationIssue[]>([]);
  const allIssues = [...localIssues, ...issues];
  const channelConfig = useMemo(() => getPath(config, 'channels'), [config]);

  async function saveCommon() {
    const nextIssues = validate({ loggingLevel, defaultAgent, taskTimeoutMs });
    setLocalIssues(nextIssues);
    if (nextIssues.length > 0) return;
    const next = structuredClone(config) as ConfigRecord;
    setPath(next, 'logging.level', loggingLevel);
    if (defaultAgent.trim()) setPath(next, 'defaultAgent', defaultAgent.trim());
    if (taskTimeoutMs.trim()) setPath(next, 'runtime.taskTimeoutMs', Number.parseInt(taskTimeoutMs, 10));
    await onSaveConfig(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">logging.level</span>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2" value={loggingLevel} onChange={(event) => setLoggingLevel(event.target.value)}>
            {['debug', 'info', 'warn', 'error'].map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">defaultAgent</span>
          <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={defaultAgent} onChange={(event) => setDefaultAgent(event.target.value)} placeholder="assistant" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">runtime.taskTimeoutMs</span>
          <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={taskTimeoutMs} onChange={(event) => setTaskTimeoutMs(event.target.value)} placeholder="600000" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void saveCommon()} disabled={saving}>{saving ? '保存中…' : '保存常用配置'}</Button>
        <Button variant="outline" onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? '收起高级选项' : '展开高级选项'}</Button>
      </div>

      {allIssues.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {allIssues.map((issue) => <div key={`${issue.path}-${issue.message}`}>{issue.path}: {issue.message}</div>)}
        </div>
      ) : null}

      {advancedOpen ? (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">高级 YAML 模式（textarea，无新增依赖）</h3>
            <p className="mt-1 text-xs text-muted-foreground">保存仍走后端 schema/loading 校验；channels.* 仅用于只读配置摘要，生命周期操作属于 FEAT-019。</p>
          </div>
          <textarea className="min-h-72 w-full rounded-md border border-input bg-background p-3 font-mono text-xs" value={yamlText} onChange={(event) => setYamlText(event.target.value)} />
          <Button variant="secondary" onClick={() => void onSaveYaml(yamlText)} disabled={saving}>保存 YAML</Button>
          <div className="rounded-md bg-muted p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">channels.* 只读预览</div>
            <pre className="overflow-auto text-xs">{JSON.stringify(channelConfig ?? {}, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function getPath(value: ConfigRecord, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPath(value: ConfigRecord, path: string, nextValue: unknown): void {
  const parts = path.split('.');
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) current[part] = {};
    current = current[part] as ConfigRecord;
  }
  current[parts.at(-1)!] = nextValue;
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
