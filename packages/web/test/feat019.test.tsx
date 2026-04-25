import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelPage } from '@/pages/ChannelPage';
import { GatewayPage } from '@/pages/GatewayPage';
import { AgentEditorPage } from '@/pages/AgentEditorPage';
import { NEW_AGENT_TEMPLATE, useManagementStore } from '@/stores/management';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function resetManagementStore() {
  useManagementStore.setState({
    channels: [],
    channelDoctor: null,
    gateway: null,
    gatewayDoctor: null,
    gatewayLogs: [],
    agents: [],
    selectedAgentId: null,
    agentYaml: '',
    validation: null,
    loading: false,
    saving: false,
    error: null,
  });
}

describe('FEAT-019 web channel/gateway/agent management client', () => {
  beforeEach(() => {
    resetManagementStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('management store calls Channel and Gateway contracts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/channels') && init?.method !== 'DELETE') {
        return jsonResponse({ success: true, data: [channelFixture] });
      }
      if (url.endsWith('/api/v1/channels/feishu/enable')) {
        return jsonResponse({ success: true, data: { ...channelFixture, enabled: true } });
      }
      if (url.endsWith('/api/v1/channels/feishu/doctor')) {
        return jsonResponse({ success: true, data: { ok: true, message: 'healthy' } });
      }
      if (url.endsWith('/api/v1/gateway')) {
        return jsonResponse({ success: true, data: gatewayFixture });
      }
      if (url.endsWith('/api/v1/gateway/doctor')) {
        return jsonResponse({ success: true, data: gatewayDoctorFixture });
      }
      if (url.endsWith('/api/v1/gateway/logs?lines=100')) {
        return jsonResponse({ success: true, data: { logFile: '/tmp/gateway.log', lines: ['ready'] } });
      }
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await useManagementStore.getState().loadChannels();
    expect(useManagementStore.getState().channels[0].id).toBe('feishu');

    await useManagementStore.getState().enableChannel('feishu');
    await useManagementStore.getState().runChannelDoctor('feishu');
    await useManagementStore.getState().loadGateway();
    await useManagementStore.getState().runGatewayDoctor();
    await useManagementStore.getState().loadGatewayLogs();

    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/api/v1/channels/feishu/enable');
    expect(urls).toContain('/api/v1/channels/feishu/doctor');
    expect(urls).toContain('/api/v1/gateway/doctor');
    expect(useManagementStore.getState().gatewayLogs).toEqual(['ready']);
  });

  it('management store calls Agent YAML validation, create, load, and delete contracts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/agents') && init?.method === 'GET') {
        return jsonResponse({ success: true, data: [agentFixture] });
      }
      if (url.endsWith('/api/v1/agents/web-agent/yaml')) {
        return jsonResponse({ success: true, data: { id: 'web-agent', yaml: agentYaml, updatedAt: '2026-04-25T00:00:00.000Z' } });
      }
      if (url.endsWith('/api/v1/agents/web-agent/validate')) {
        return jsonResponse({ success: true, data: { ok: true, id: 'web-agent', issues: [] } });
      }
      if (url.endsWith('/api/v1/agents') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'web-agent', yaml: agentYaml } }, { status: 201 });
      }
      if (url.endsWith('/api/v1/agents/web-agent') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: { id: 'web-agent', deleted: true } });
      }
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await useManagementStore.getState().loadAgents();
    await useManagementStore.getState().selectAgent('web-agent');
    expect(useManagementStore.getState().agentYaml).toContain('id: web-agent');

    useManagementStore.getState().newAgent();
    useManagementStore.getState().setAgentYaml(agentYaml);
    expect(await useManagementStore.getState().saveAgent()).toBe(true);
    await useManagementStore.getState().deleteAgent('web-agent');

    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`);
    expect(calls).toContain('POST /api/v1/agents/web-agent/validate');
    expect(calls).toContain('POST /api/v1/agents');
    expect(calls).toContain('DELETE /api/v1/agents/web-agent');
  });

  it('renders usable Channels, Gateway, and Agents pages instead of marketing placeholders', () => {
    useManagementStore.setState({
      channels: [channelFixture],
      channelDoctor: { ok: true, message: 'healthy' },
      gateway: gatewayFixture,
      gatewayDoctor: gatewayDoctorFixture,
      gatewayLogs: ['ready'],
      agents: [agentFixture],
      selectedAgentId: 'web-agent',
      agentYaml,
      validation: { ok: false, issues: [{ path: 'description', message: 'Unknown field', code: 'unknown-field' }] },
    });

    const channelHtml = renderToString(<ChannelPage />);
    expect(channelHtml).toContain('Channels');
    expect(channelHtml).toContain('启用、禁用、移除');
    expect(channelHtml).toContain('Doctor');

    const gatewayHtml = renderToString(<GatewayPage />);
    expect(gatewayHtml).toContain('Gateway Status Panel');
    expect(gatewayHtml).toContain('Gateway Doctor');
    expect(gatewayHtml).toContain('Gateway Logs');

    const agentHtml = renderToString(<AgentEditorPage />);
    expect(agentHtml).toContain('Agent YAML editor');
    expect(agentHtml).toContain('Validate');
    expect(agentHtml).not.toContain('后续 FEAT');
    expect(NEW_AGENT_TEMPLATE).toContain('systemPrompt');
  });
});

const channelFixture = {
  id: 'feishu',
  displayName: 'Feishu',
  enabled: false,
  removable: true,
  source: 'user' as const,
  capabilities: { streaming: true, richText: true, attachments: false, threading: true },
  health: 'disabled' as const,
  lastCheckedAt: '2026-04-25T00:00:00.000Z',
  configSource: '/tmp/config.yaml',
  config: { enabled: false },
};

const gatewayFixture = {
  status: 'stopped' as const,
  running: false,
  connectedChannelCount: 1,
  enabledChannels: [{ id: 'feishu', healthy: true }],
  pidFile: '/tmp/gateway.pid',
  logFile: '/tmp/gateway.log',
};

const gatewayDoctorFixture = {
  ok: true,
  gateway: { running: false },
  channels: [{ id: 'feishu', healthy: true }],
  paths: { root: '/tmp/haro', pidFile: '/tmp/gateway.pid', logFile: '/tmp/gateway.log', channelData: '/tmp/channels' },
};

const agentFixture = {
  id: 'web-agent',
  name: 'Web Agent',
  summary: 'First paragraph',
  defaultProvider: 'codex',
  defaultModel: 'gpt-5',
};

const agentYaml = `id: web-agent
name: Web Agent
systemPrompt: |
  First paragraph.
tools: []
`;
