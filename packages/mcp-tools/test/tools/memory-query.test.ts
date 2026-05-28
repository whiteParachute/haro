import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

function expectRetiredMessage(message: string): void {
  expect(message).toContain('retired');
  expect(message).toContain('FEAT-081X/F-3');
  expect(message).toContain('self-evolution sidecar');
  expect(message).toContain('No ~/.haro memory data is read');
}

describe('memory_query tool [FEAT-081X/F-3]', () => {
  it('remains registered but advertises retired/fail-closed read semantics', () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const tools = registry.list();
    const query = tools.find((tool) => tool.name === 'memory_query');

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'memory_query',
      'memory_remember',
      'schedule_task',
      'send_message',
    ]);
    expect(query).toBeDefined();
    expectRetiredMessage(query!.description);
  });

  it('fails closed with TARGET_DISABLED and never reads Haro MemoryFabric', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const searchSpy = vi.spyOn(e.memory, 'searchMemoryFiles');
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'project', scope: 'agent', dimension: 'project', limit: 10 },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });

    expect(out.decision).toBe('allowed');
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_DISABLED');
    expectRetiredMessage(out.result.error.message);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('fails closed with the same retired message when memory deps are absent', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const searchSpy = vi.spyOn(e.memory, 'searchMemoryFiles');
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'project' },
      session: e.buildSession(),
      deps: { ...e.buildDeps(), memory: undefined },
    });

    expect(out.decision).toBe('allowed');
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_DISABLED');
    expectRetiredMessage(out.result.error.message);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns INVALID_PARAMS on over-limit before retired execution', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const searchSpy = vi.spyOn(e.memory, 'searchMemoryFiles');
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'project', limit: 999 },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns INVALID_PARAMS on empty query before retired execution', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const searchSpy = vi.spyOn(e.memory, 'searchMemoryFiles');
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: '' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
    expect(searchSpy).not.toHaveBeenCalled();
  });
});
