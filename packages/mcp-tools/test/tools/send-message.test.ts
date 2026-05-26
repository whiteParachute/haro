import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentDockIpcMessageGateway } from '../../src/agentdock-messaging.js';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('send_message tool [FEAT-032 R4 / AC1]', () => {
  it('routes a text message to AgentDock messaging and audits success', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'feishu:oc_fake', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'feishu:oc_fake' }),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('allowed');
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.channelId).toBe('feishu:oc_fake');
    expect(out.result.value.channelSessionId).toBe('sess-A');
    expect(out.result.value.gateway).toBe('agentdock-messaging');
    expect(out.result.value.messageId).toBe('fake-agentdock-message-1');
    expect(e.messaging.outbound).toHaveLength(1);
    const captured = e.messaging.outbound[0]!;
    expect(captured.channel).toBe('feishu:oc_fake');
    expect(captured.text).toBe('hi');
    expect(captured.urgent).toBe(false);
  });


  it('writes the AgentDock IPC messages contract used by agentdock-tool send-message', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-agentdock-ipc-'));
    try {
      const gateway = createAgentDockIpcMessageGateway({
        ipcDir: root,
        chatJid: 'web:test-chat',
        groupFolder: 'flow-test',
        now: () => new Date('2026-05-26T03:00:00.000Z'),
        randomSuffix: () => 'fixed',
      });
      const result = await gateway.sendMessage({
        channel: 'feishu:oc_fake',
        text: 'hello ipc',
        urgent: true,
        replyToMessageId: 'msg-1',
      });
      expect(result.status).toBe('queued');
      expect(result.targetChannel).toBe('feishu:oc_fake');
      const files = readdirSync(join(root, 'messages'));
      expect(files).toHaveLength(1);
      const payload = JSON.parse(readFileSync(join(root, 'messages', files[0]!), 'utf8')) as Record<string, unknown>;
      expect(payload).toEqual({
        type: 'message',
        chatJid: 'web:test-chat',
        text: 'hello ipc',
        targetChannel: 'feishu:oc_fake',
        urgent: true,
        replyToMsgId: 'msg-1',
        groupFolder: 'flow-test',
        timestamp: '2026-05-26T03:00:00.000Z',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns NEEDS_APPROVAL on cross-channel send', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'feishu:oc_fake', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'web' }),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('needs-approval');
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('NEEDS_APPROVAL');
    expect(e.messaging.outbound).toHaveLength(0);
  });

  it('fails closed when AgentDock messaging gateway is not configured', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const { messaging: _messaging, ...depsWithoutMessaging } = e.buildDeps();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'feishu:oc_fake', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'feishu:oc_fake' }),
      deps: depsWithoutMessaging,
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_NOT_FOUND');
    expect(out.result.error.message).toContain('AgentDock messaging gateway is not configured');
    expect(out.result.error.remediation).toContain('HAPPYCLAW_WORKSPACE_IPC');
    expect(e.messaging.outbound).toHaveLength(0);
  });

  it('accepts AgentDock-style channel/text aliases', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channel: 'telegram:123', text: 'hello', urgent: true, reply_to_message_id: 'msg-1' },
      session: e.buildSession({ channelId: 'telegram:123' }),
      deps: e.buildDeps(),
    });
    expect(out.result.ok).toBe(true);
    expect(e.messaging.outbound).toEqual([
      expect.objectContaining({
        channel: 'telegram:123',
        text: 'hello',
        urgent: true,
        replyToMessageId: 'msg-1',
      }),
    ]);
  });

  it('returns INVALID_PARAMS on empty content', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'feishu:oc_fake', sessionId: 'sess-A', content: '' },
      session: e.buildSession({ channelId: 'feishu:oc_fake' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('returns INVALID_PARAMS when attachments[] is non-empty (v1 unsupported)', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: {
        channelId: 'feishu:oc_fake',
        sessionId: 'sess-A',
        content: 'see file',
        attachments: [{ url: 'https://example.com/x.png' }],
      },
      session: e.buildSession({ channelId: 'feishu:oc_fake' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('maps AgentDock gateway failure to INTERNAL_ERROR', async () => {
    const e = (env = setupEnv());
    e.messaging.shouldFail = true;
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'feishu:oc_fake', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'feishu:oc_fake' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INTERNAL_ERROR');
    expect(out.result.error.message).toContain('AgentDock messaging gateway failed');
    expect(out.result.error.retryable).toBe(true);
  });
});
