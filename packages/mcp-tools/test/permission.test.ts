import { describe, expect, it } from 'vitest';
import { evaluatePermission } from '../src/permission.js';
import type { SessionContext, ToolDependencies } from '../src/types.js';

const fakeDeps = {} as ToolDependencies;

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 's',
    agentId: 'a',
    ...overrides,
  };
}

describe('evaluatePermission [FEAT-032 R3 / G3]', () => {
  it('allows send_message when caller channel matches target', () => {
    expect(
      evaluatePermission({
        toolName: 'send_message',
        params: { channelId: 'web', sessionId: 'x', content: 'hi' },
        session: session({ channelId: 'web' }),
        deps: fakeDeps,
      }),
    ).toEqual({ decision: 'allowed' });
  });

  it('flags cross-channel send_message as needs-approval', () => {
    const out = evaluatePermission({
      toolName: 'send_message',
      params: { channelId: 'feishu', sessionId: 'x', content: 'hi' },
      session: session({ channelId: 'web' }),
      deps: fakeDeps,
    });
    expect(out.decision).toBe('needs-approval');
    expect(out.reason).toMatch(/cross-channel/);
  });

  it('falls back to allow when caller has no channel context (CLI / cron)', () => {
    expect(
      evaluatePermission({
        toolName: 'send_message',
        params: { channelId: 'web', sessionId: 'x', content: 'hi' },
        session: session(),
        deps: fakeDeps,
      }),
    ).toEqual({ decision: 'allowed' });
  });

  it('memory_remember scope=agent → allow, shared/platform → needs-approval', () => {
    expect(
      evaluatePermission({
        toolName: 'memory_remember',
        params: { scope: 'agent', content: 'x' },
        session: session(),
        deps: fakeDeps,
      }),
    ).toEqual({ decision: 'allowed' });
    expect(
      evaluatePermission({
        toolName: 'memory_remember',
        params: { scope: 'shared', content: 'x' },
        session: session(),
        deps: fakeDeps,
      }).decision,
    ).toBe('needs-approval');
    expect(
      evaluatePermission({
        toolName: 'memory_remember',
        params: { scope: 'platform', content: 'x' },
        session: session(),
        deps: fakeDeps,
      }).decision,
    ).toBe('needs-approval');
  });

  it('allows memory_query and schedule_task by default', () => {
    expect(
      evaluatePermission({
        toolName: 'memory_query',
        params: { query: 'x' },
        session: session(),
        deps: fakeDeps,
      }).decision,
    ).toBe('allowed');
    expect(
      evaluatePermission({
        toolName: 'schedule_task',
        params: { when: '* * * * *', taskInput: 'do it', mode: 'cron' },
        session: session(),
        deps: fakeDeps,
      }).decision,
    ).toBe('allowed');
  });

  it('denies unknown tools', () => {
    const out = evaluatePermission({
      toolName: 'unknown',
      params: {},
      session: session(),
      deps: fakeDeps,
    });
    expect(out.decision).toBe('denied');
  });
});
