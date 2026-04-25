import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { useManagementStore, type AgentSummary } from '@/stores/management';

export function AgentEditorPage() {
  const {
    agents,
    selectedAgentId,
    agentYaml,
    validation,
    loading,
    saving,
    error,
    loadAgents,
    selectAgent,
    newAgent,
    setAgentYaml,
    validateAgent,
    saveAgent,
    deleteAgent,
  } = useManagementStore();

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (!agentYaml.trim()) return undefined;
    const timer = setTimeout(() => {
      void validateAgent();
    }, 300);
    return () => clearTimeout(timer);
  }, [agentYaml, validateAgent]);

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Agent YAML 创建、编辑、删除与校验。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={newAgent}>New Agent</Button>
          {agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              active={agent.id === selectedAgentId}
              onSelect={() => void selectAgent(agent.id)}
              onDelete={() => {
                if (globalThis.confirm?.(`Delete agent ${agent.id}?`) ?? true) void deleteAgent(agent.id);
              }}
            />
          ))}
          {agents.length === 0 ? <p className="text-sm text-muted-foreground">暂无 Agent。</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{selectedAgentId ? `Editing ${selectedAgentId}` : 'New Agent YAML'}</CardTitle>
            <CardDescription>
              使用 YAML 编辑 Agent 配置；保存前会调用 /api/v1/agents/:id/validate。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <textarea
              className="min-h-[28rem] w-full rounded-lg border border-border bg-background p-4 font-mono text-sm"
              aria-label="Agent YAML editor"
              value={agentYaml}
              onChange={(event) => setAgentYaml(event.target.value)}
              spellCheck={false}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void validateAgent()} disabled={loading || !agentYaml.trim()}>Validate</Button>
              <Button onClick={() => void saveAgent()} disabled={saving || !agentYaml.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {selectedAgentId ? (
                <Button variant="outline" onClick={() => void selectAgent(selectedAgentId)}>Reload YAML</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
            <CardDescription>固定 AgentValidationResponse：通过或列出字段级 issues。</CardDescription>
          </CardHeader>
          <CardContent>
            <ValidationPanel validation={validation} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AgentListItem({
  agent,
  active,
  onSelect,
  onDelete,
}: {
  agent: AgentSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-primary' : 'border-border'}`}>
      <button className="w-full text-left" type="button" onClick={onSelect}>
        <span className="block font-medium">{agent.name}</span>
        <span className="block text-xs text-muted-foreground">{agent.id}</span>
        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{agent.summary}</span>
      </button>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={onSelect}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}

function ValidationPanel({ validation }: { validation: ReturnType<typeof useManagementStore.getState>['validation'] }) {
  if (!validation) {
    return <p className="text-sm text-muted-foreground">等待 YAML 校验。</p>;
  }
  if (validation.ok) {
    return <p className="text-sm text-green-600">✓ YAML 格式有效：{validation.id}</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {validation.issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`} className="rounded-lg bg-destructive/10 p-3 text-destructive">
          <span className="font-medium">{issue.path}</span>
          {issue.code ? <span className="ml-2 rounded bg-background px-2 py-0.5 text-xs">{issue.code}</span> : null}
          <p className="mt-1">{issue.message}</p>
        </li>
      ))}
    </ul>
  );
}
