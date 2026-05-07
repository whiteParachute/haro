import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from '../helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

beforeEach(async () => {
  // helper: each test sets up its own env in `setup()`
});

async function seed(e: TestEnv): Promise<void> {
  await e.memory.writeEntry({
    layer: 'persistent',
    scope: 'agent:default',
    agentId: 'default',
    topic: 'feedback note',
    content: 'user prefers terse responses',
    sourceRef: 'test:feedback',
    tags: ['mcp', 'feedback'],
  });
  await e.memory.writeEntry({
    layer: 'persistent',
    scope: 'agent:default',
    agentId: 'default',
    topic: 'project status',
    content: 'project Haro phase 1.5 in progress',
    sourceRef: 'test:project',
    tags: ['mcp', 'project'],
  });
  await e.memory.writeEntry({
    layer: 'persistent',
    scope: 'shared',
    topic: 'reference doc',
    content: 'reference link',
    sourceRef: 'test:reference',
    tags: ['mcp', 'reference'],
  });
}

describe('memory_query tool [FEAT-032 R5 / AC2]', () => {
  it('returns hits scoped to the agent by default', async () => {
    const e = (env = setupEnv());
    await seed(e);
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'project' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of out.result.value.hits) {
      expect(hit.scope.startsWith('agent:default') || hit.scope === 'shared').toBe(true);
    }
  });

  it('filters by dimension=feedback', async () => {
    const e = (env = setupEnv());
    await seed(e);
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'user', dimension: 'feedback' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    expect(out.result.value.hits.every((h) => h.dimension === 'feedback')).toBe(true);
  });

  it('respects scope=shared filter', async () => {
    const e = (env = setupEnv());
    await seed(e);
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'reference', scope: 'shared' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    for (const hit of out.result.value.hits) {
      expect(hit.scope).toBe('shared');
    }
  });

  it('clamps limit to spec maximum (50)', async () => {
    const e = (env = setupEnv());
    await seed(e);
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'project', limit: 999 },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('expected INVALID_PARAMS');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });

  it('returns excerpt truncated to 200 chars', async () => {
    const e = (env = setupEnv());
    await e.memory.writeEntry({
      layer: 'persistent',
      scope: 'agent:default',
      agentId: 'default',
      topic: 'long doc',
      content: 'x'.repeat(500),
      sourceRef: 'test:long',
      tags: ['mcp', 'reference'],
    });
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: 'long' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (!out.result.ok) throw new Error('expected success');
    for (const hit of out.result.value.hits) {
      expect(hit.excerpt.length).toBeLessThanOrEqual(200);
    }
  });

  it('returns INVALID_PARAMS on empty query', async () => {
    const e = (env = setupEnv());
    const registry = e.buildRegistry();
    const out = await registry.invoke({
      name: 'memory_query',
      rawParams: { query: '' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
  });
});
