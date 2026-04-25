import { useEffect, useState } from 'react';
import { get } from '@/api/client';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ChatInput } from '@/components/chat/ChatInput';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useChatStore } from '@/stores/chat';

interface AgentSummary {
  id: string;
  name: string;
  summary: string;
  defaultProvider?: string;
  defaultModel?: string;
}

export function ChatPage() {
  const { messages, status, error, config, connect, disconnect, sendMessage, applySlashCommand, newChat, retryLast } = useChatStore();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState(config.agentId ?? '');
  const [providerId, setProviderId] = useState(config.providerId ?? '');
  const [modelId, setModelId] = useState(config.modelId ?? '');

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
        if (first.defaultProvider) setProviderId(first.defaultProvider);
        if (first.defaultModel) setModelId(first.defaultModel);
        return first.id;
      });
    });
  }, []);

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

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>运行配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
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
            <input className="w-full rounded-md border border-input bg-background px-2 py-2" value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="可选" />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Model</span>
            <input className="w-full rounded-md border border-input bg-background px-2 py-2" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="可选" />
          </label>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={newChat}>/new</Button>
            <Button variant="outline" size="sm" onClick={retryLast}>/retry</Button>
          </div>
          <p className="text-xs text-muted-foreground">最近选择会保存到 localStorage：haro:lastChatConfig。</p>
        </CardContent>
      </Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>状态：{status}</span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </div>
        <ChatContainer messages={messages} />
        <ChatInput onSubmit={submit} />
      </div>
    </div>
  );
}
