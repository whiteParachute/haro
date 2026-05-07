import { afterEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

/**
 * FEAT-032 spec §7 Test Plan: ≥ 5 negative security cases.
 */
describe('mcp-tools security [FEAT-032 §7]', () => {
  it('cross-channel send is blocked at the permission layer (no channel.send call)', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'fake-im', sessionId: 'x', content: 'hi' },
      session: e.buildSession({ channelId: 'web' }),
      deps: e.buildDeps(),
    });
    expect(e.fakeChannel.outbound).toHaveLength(0);
  });

  it('cross-scope memory write (shared) is blocked at the permission layer', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: 'leak', scope: 'shared', dimension: 'project' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('needs-approval');
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('NEEDS_APPROVAL');
  });

  it('cron expression injection is rejected as INVALID_PARAMS', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'schedule_task',
      rawParams: {
        when: '* * * * * ; rm -rf /',
        mode: 'cron',
        taskInput: 'evil',
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('non-existent target channel is rejected as TARGET_NOT_FOUND', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'send_message',
      rawParams: { channelId: 'phantom', sessionId: 'x', content: 'hi' },
      session: e.buildSession({ channelId: 'phantom' }),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_NOT_FOUND');
  });

  it('over-limit memory_query.limit is rejected at schema parse time', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'x', limit: 10_000 },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('audit row is written even when permission denies the call (so operators see the attempt)', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: 'attempt', scope: 'shared', dimension: 'feedback' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    const rows = e.audit.list();
    expect(rows[0]!.decision).toBe('needs-approval');
    expect(rows[0]!.errorCode).toBe('NEEDS_APPROVAL');
  });
});
