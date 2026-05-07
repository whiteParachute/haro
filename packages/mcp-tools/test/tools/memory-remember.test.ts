import { afterEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('memory_remember tool [FEAT-032 R6 / AC3]', () => {
  it('writes agent-scope memory and persists the input dimension as a tag', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
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
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.dimension).toBe('feedback');
    expect(out.result.value.dimensionPersisted).toBe(true);
    expect(out.result.value.scope.startsWith('agent:')).toBe(true);
  });

  it('returns NEEDS_APPROVAL for shared scope', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: 'x', scope: 'shared', dimension: 'reference' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('needs-approval');
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('NEEDS_APPROVAL');
  });

  it('returns NEEDS_APPROVAL for platform scope', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: 'p', scope: 'platform', dimension: 'project' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('needs-approval');
  });

  it('records an EvolutionAssetRegistry event for successful writes', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: {
        content: 'project Haro phase 1.5',
        scope: 'agent',
        dimension: 'project',
      },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(typeof out.result.value.assetEventId).toBe('string');
    const events = e.evolution.listEvents();
    expect(events.some((event) => event.evidenceRefs.some((ref) => ref.startsWith('memory:')))).toBe(
      true,
    );
  });

  it('defaults dimension to project when caller omits it', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_remember',
      rawParams: { content: 'random', scope: 'agent' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(['user', 'feedback', 'project', 'reference']).toContain(out.result.value.dimension);
  });

  it('returns INVALID_PARAMS on empty content', async () => {
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
