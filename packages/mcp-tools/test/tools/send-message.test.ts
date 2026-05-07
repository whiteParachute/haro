import { afterEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('send_message tool [FEAT-032 R4 / AC1]', () => {
  it('routes a text message to the registered channel and audits success', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'fake-im' }),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('allowed');
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.channelId).toBe('fake-im');
    expect(e.fakeChannel.outbound).toHaveLength(1);
    expect(e.fakeChannel.outbound[0]!.sessionId).toBe('sess-A');
  });

  it('returns NEEDS_APPROVAL on cross-channel send', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'web' }),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('needs-approval');
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('NEEDS_APPROVAL');
    expect(e.fakeChannel.outbound).toHaveLength(0);
  });

  it('returns TARGET_NOT_FOUND when channel is not registered', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'ghost', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'ghost' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_NOT_FOUND');
  });

  it('returns TARGET_DISABLED when channel is registered but disabled', async () => {
    const e = (env = setupEnv());
    e.channels.disable('fake-im');
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'fake-im' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_DISABLED');
  });

  it('returns INVALID_PARAMS on empty content', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'sess-A', content: '' },
      session: e.buildSession({ channelId: 'fake-im' }),
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
        channelId: 'fake-im',
        sessionId: 'sess-A',
        content: 'see file',
        attachments: [{ url: 'https://example.com/x.png' }],
      },
      session: e.buildSession({ channelId: 'fake-im' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('maps channel.send failure to INTERNAL_ERROR', async () => {
    const e = (env = setupEnv());
    e.fakeChannel.shouldFail = true;
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'sess-A', content: 'hi' },
      session: e.buildSession({ channelId: 'fake-im' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INTERNAL_ERROR');
    expect(out.result.error.retryable).toBe(true);
  });
});
