import { useEffect, useMemo, useState } from 'react';
import { get } from '@/api/client';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ChatInput } from '@/components/chat/ChatInput';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardTitle } from '@/components/ui/Card';
import { useChatStore } from '@/stores/chat';

interface AgentSummary {
  id: string;
  name: string;
  summary: string;
  defaultProvider?: string;
  defaultModel?: string;
}

interface ProviderModelInfo {
  id: string;
  maxContextTokens?: number;
}

interface ProviderListEntry {
  id: string;
  enabled: boolean;
  authMode?: 'env' | 'chatgpt' | 'auto';
  defaultModel?: string;
  liveModels: ProviderModelInfo[];
  liveModelsFailed?: boolean;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex (OpenAI)',
};

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function providerLabel(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

export function ChatPage() {
  const { messages, status, error, config, connect, disconnect, sendMessage, applySlashCommand, newChat, retryLast, cancelCurrent } = useChatStore();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [providers, setProviders] = useState<ProviderListEntry[]>([]);
  const [agentId, setAgentId] = useState(config.agentId ?? '');
  const [providerId, setProviderId] = useState(config.providerId ?? '');
  const [modelId, setModelId] = useState(config.modelId ?? '');
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    void get<AgentSummary[]>('/v1/agents').then((response) => {
      setAgents(response.data);
      const first = response.data[0];
      if (!first) return;
      setAgentId((current) => {
        if (current) return current;
        if (first.defaultProvider) setProviderId((cur) => cur || first.defaultProvider!);
        if (first.defaultModel) setModelId((cur) => cur || first.defaultModel!);
        return first.id;
      });
    });
    void get<ProviderListEntry[]>('/v1/providers').then((response) => {
      setProviders(response.data);
      const first = response.data.find((entry) => entry.enabled) ?? response.data[0];
      if (!first) return;
      setProviderId((current) => current || first.id);
      setModelId((current) => {
        if (current) return current;
        if (first.defaultModel) return first.defaultModel;
        return first.liveModels[0]?.id ?? '';
      });
    });
  }, []);

  const activeProvider = useMemo(
    () => providers.find((entry) => entry.id === providerId),
    [providers, providerId],
  );

  const modelOptions = useMemo(() => {
    if (!providerId) return [] as string[];
    const live = activeProvider?.liveModels.map((m) => m.id) ?? [];
    const explicit = activeProvider?.defaultModel ? [activeProvider.defaultModel] : [];
    const fromAgent = agents.find((a) => a.id === agentId)?.defaultModel
      ? [agents.find((a) => a.id === agentId)!.defaultModel as string]
      : [];
    return dedupe([...explicit, ...fromAgent, ...live]);
  }, [providerId, activeProvider, agents, agentId]);

  const providerOptions = useMemo(() => {
    const enabled = providers.filter((entry) => entry.enabled);
    if (enabled.length > 0) return enabled;
    if (providers.length > 0) return providers;
    return [{ id: 'codex', enabled: true, liveModels: [] } as ProviderListEntry];
  }, [providers]);

  function submit(content: string) {
    if (applySlashCommand(content)) return;
    if (!agentId) return;
    sendMessage({
      agentId,
      providerId: providerId || undefined,
      modelId: modelId || undefined,
      content,
    });
  }

  const summaryParts: string[] = [];
  const agentLabel = agents.find((a) => a.id === agentId)?.name ?? agentId;
  if (agentLabel) summaryParts.push(agentLabel);
  if (providerId) summaryParts.push(providerLabel(providerId));
  if (modelId) summaryParts.push(modelId);
  const authModeBadge = activeProvider?.authMode === 'chatgpt' ? 'ChatGPT 订阅' : null;

  // Disable submit when we cannot resolve a runnable (provider, model) pair.
  // Sending an empty modelId would fall back to runtime selection rules,
  // which call provider.listModels() — and we already know that's empty for
  // chatgpt-mode users without a populated models_cache.json.
  const cannotSubmit =
    !agentId ||
    !providerId ||
    !modelId ||
    (activeProvider?.liveModels.length === 0 && modelOptions.length === 0);
  let disabledReason: string | undefined;
  if (cannotSubmit) {
    if (!agentId) disabledReason = '请先选择 Agent';
    else if (!providerId) disabledReason = '请先选择 Provider';
    else if (!modelId) disabledReason = '请先选择 Model（展开"运行配置"卡片）';
    else if (activeProvider?.authMode === 'chatgpt')
      disabledReason = '未检测到可用模型；请运行一次 codex 触发 ~/.codex/models_cache.json 生成';
    else disabledReason = '未检测到可用模型';
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <Card>
        <button
          type="button"
          onClick={() => setConfigOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left"
          aria-expanded={configOpen}
        >
          <div className="flex flex-col">
            <CardTitle className="text-base">运行配置</CardTitle>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {summaryParts.length > 0 ? summaryParts.join(' · ') : '尚未选择 Agent / Provider / 模型'}
              {authModeBadge ? `  •  ${authModeBadge}` : ''}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{configOpen ? '收起 ▴' : '展开 ▾'}</span>
        </button>
        {configOpen ? (
          <CardContent className="space-y-3 border-t border-border pt-4 text-sm">
            <label className="block space-y-1">
              <span className="text-muted-foreground">Agent</span>
              <select className="w-full rounded-md border border-input bg-background px-2 py-2" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Provider</span>
              <select className="w-full rounded-md border border-input bg-background px-2 py-2" value={providerId} onChange={(event) => {
                const next = event.target.value;
                setProviderId(next);
                const entry = providers.find((p) => p.id === next);
                const fallback = entry?.defaultModel ?? entry?.liveModels[0]?.id;
                if (fallback) setModelId(fallback);
              }}>
                <option value="">选择 Provider</option>
                {providerOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>{providerLabel(entry.id)}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Model</span>
              <select className="w-full rounded-md border border-input bg-background px-2 py-2" value={modelId} onChange={(event) => setModelId(event.target.value)}>
                <option value="">默认模型</option>
                {modelOptions.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              {activeProvider?.liveModels.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Provider 暂无可用模型；如已 <code>codex login</code>，请确认 <code>~/.codex/models_cache.json</code> 已生成（运行一次 <code>codex</code> 即可触发）。
                </span>
              ) : null}
            </label>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={newChat}>/new</Button>
              <Button variant="outline" size="sm" onClick={retryLast}>/retry</Button>
            </div>
            <p className="text-xs text-muted-foreground">最近选择会保存到 localStorage：haro:lastChatConfig。</p>
          </CardContent>
        ) : null}
      </Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>状态：{status}</span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </div>
        <ChatContainer messages={messages} />
        <ChatInput
          onSubmit={submit}
          onCancel={cancelCurrent}
          running={status === 'running'}
          disabled={cannotSubmit}
          {...(disabledReason ? { disabledReason } : {})}
        />
      </div>
    </div>
  );
}
