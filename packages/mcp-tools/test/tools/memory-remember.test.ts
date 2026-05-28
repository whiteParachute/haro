import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

function expectRetiredMessage(message: string): void {
  expect(message).toContain('retired');
  expect(message).toContain('FEAT-081X/F-2');
  expect(message).toContain('AgentDock memory');
  expect(message).toContain('aria-memory-vault');
}

describe('memory_remember tool [FEAT-081X/F-2]', () => {
  it('remains registered but advertises retired/fail-closed semantics', () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const tools = registry.list();
    const remember = tools.find((tool) => tool.name === 'memory_remember');

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'memory_query',
      'memory_remember',
      'schedule_task',
      'send_message',
    ]);
    expect(remember).toBeDefined();
    expectRetiredMessage(remember!.description);
  });

  it('fails closed with TARGET_DISABLED and never writes agent-scope memory', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const writeSpy = vi.spyOn(e.memory, 'writeEntry');
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: {
        content: 'user prefers concise responses',
        scope: 'agent',
        dimension: 'feedback',
        topic: 'concise-pref',
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });

    expect(out.decision).toBe('allowed');
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_DISABLED');
    expectRetiredMessage(out.result.error.message);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('fails closed for shared/platform scopes without approval flow or writes', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const writeSpy = vi.spyOn(e.memory, 'writeEntry');

    for (const scope of ['shared', 'platform'] as const) {
      const out = await registry.invoke({
        name: 'memory_remember',
        rawParams: { content: `retired ${scope}`, scope, dimension: 'reference' },
        session: e.buildSession(),
        deps: e.buildDeps(),
      });
      expect(out.decision).toBe('allowed');
      expect(out.result.ok).toBe(false);
      if (out.result.ok) throw new Error('unreachable');
      expect(out.result.error.code).toBe('TARGET_DISABLED');
      expectRetiredMessage(out.result.error.message);
    }

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('returns INVALID_PARAMS on empty content before retired execution', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: '', scope: 'agent' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });
});
