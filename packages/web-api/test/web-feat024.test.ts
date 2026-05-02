import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHaroPaths, createEvolutionAssetRegistry, createMemoryFabric, type EvolutionAssetRegistry } from '@haro/core';
import type { SkillsManager } from '@haro/skills';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('web dashboard knowledge and skills REST [FEAT-024]', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function tempRoot(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it('implements Memory query, write, stats, and async maintenance contract', async () => {
    const root = tempRoot('haro-feat024-memory-');
    const paths = buildHaroPaths(root);
    const fabric = createMemoryFabric({ root: paths.dirs.memory, dbFile: paths.dbFile });
    await fabric.writeEntry({
      layer: 'persistent',
      scope: 'shared',
      topic: 'dashboard knowledge',
      summary: 'Dashboard memory summary',
      content: 'Knowledge dashboard content with source reference',
      sourceRef: 'spec:FEAT-024',
      assetRef: 'asset:memory-demo',
      verificationStatus: 'verified',
      tags: ['feat-024'],
    });
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, dbFile: paths.dbFile } });

    const queryResponse = await app.request('/api/v1/memory/query?keyword=dashboard&scope=shared&layer=persistent&verificationStatus=verified&limit=5');
    const query = await queryResponse.json();
    expect(queryResponse.status).toBe(200);
    expect(query.data.items[0].entry).toMatchObject({
      summary: 'Dashboard memory summary',
      sourceRef: 'spec:FEAT-024',
      verificationStatus: 'verified',
      assetRef: 'asset:memory-demo',
    });

    const writeResponse = await app.request('/api/v1/memory/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'shared',
        layer: 'persistent',
        topic: 'web write',
        summary: 'Web write summary',
        content: 'Write from dashboard',
        sourceRef: 'web-dashboard',
      }),
    });
    expect(writeResponse.status).toBe(201);
    expect((await writeResponse.json()).data.scope).toBe('shared');

    const stats = await (await app.request('/api/v1/memory/stats')).json();
    expect(stats.data.totalEntries).toBeGreaterThanOrEqual(2);

    const maintenanceResponse = await app.request('/api/v1/memory/maintenance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'shared' }),
    });
    const maintenance = await maintenanceResponse.json();
    expect(maintenanceResponse.status).toBe(202);
    expect(maintenance.data).toMatchObject({ status: 'accepted', async: true });
    expect(maintenance.data.taskId).toMatch(/^memory-maintenance-/);
  });

  it('rejects platform Memory writes before any entry is persisted', async () => {
    const root = tempRoot('haro-feat024-platform-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const response = await app.request('/api/v1/memory/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'platform',
        layer: 'persistent',
        topic: 'forbidden',
        content: 'must not persist',
        sourceRef: 'web-dashboard',
      }),
    });

    expect(response.status).toBe(403);
    const stats = await (await app.request('/api/v1/memory/stats')).json();
    expect(stats.data.totalEntries ?? 0).toBe(0);
  });

  it('implements Skills list, detail, enable, disable, install, uninstall, preinstall guard, and audit events', async () => {
    const root = tempRoot('haro-feat024-skills-');
    const skillSource = join(root, 'skill-source');
    mkdirSync(skillSource, { recursive: true });
    writeFileSync(skillSourceFile(skillSource), '---\nname: user-demo\ndescription: "User demo skill."\n---\nDemo skill body.\n', 'utf8');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const list = await (await app.request('/api/v1/skills')).json();
    expect(list.data.items.some((item: { id: string; isPreinstalled: boolean }) => item.id === 'eat' && item.isPreinstalled)).toBe(true);
    expect(list.data.items[0]).toHaveProperty('assetStatus');
    expect(list.data.items[0]).toHaveProperty('useCount');

    const detail = await (await app.request('/api/v1/skills/eat')).json();
    expect(detail.data).toMatchObject({ id: 'eat', source: 'preinstalled', enabled: true });

    const disabled = await (await app.request('/api/v1/skills/eat/disable', { method: 'POST' })).json();
    expect(disabled.data.skill).toMatchObject({ id: 'eat', enabled: false });
    expect(disabled.data.audit.event.type).toBe('disabled');

    const enabled = await (await app.request('/api/v1/skills/eat/enable', { method: 'POST' })).json();
    expect(enabled.data.skill).toMatchObject({ id: 'eat', enabled: true });
    expect(enabled.data.audit.event.type).toBe('enabled');

    const protectedDelete = await app.request('/api/v1/skills/eat', { method: 'DELETE' });
    expect(protectedDelete.status).toBe(403);

    const installResponse = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: skillSource }),
    });
    const installed = await installResponse.json();
    expect(installResponse.status).toBe(201);
    expect(installed.data.skill).toMatchObject({ id: 'user-demo', source: 'user', enabled: true });
    expect(installed.data.audit.event.type).toBe('promoted');

    const uninstallResponse = await app.request('/api/v1/skills/user-demo', { method: 'DELETE' });
    const uninstalled = await uninstallResponse.json();
    expect(uninstallResponse.status).toBe(200);
    expect(uninstalled.data.skill).toMatchObject({ id: 'user-demo', assetStatus: 'archived' });
    expect(uninstalled.data.audit.event.type).toBe('archived');

    const registry = createEvolutionAssetRegistry({ root });
    expect(registry.listEvents('skill:user-demo').map((event) => event.type)).toEqual(['promoted', 'archived']);
    registry.close();
  });

  it('returns explicit unsupported when skill asset audit is unavailable', async () => {
    const root = tempRoot('haro-feat024-skills-unsupported-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, skillAssetAuditSupported: false } });

    const installResponse = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '/tmp/nope' }),
    });
    const uninstallResponse = await app.request('/api/v1/skills/user-demo', { method: 'DELETE' });

    expect(installResponse.status).toBe(501);
    expect((await installResponse.json()).code).toBe('asset-audit-unsupported');
    expect(uninstallResponse.status).toBe(501);
  });

  it('does not report a stale skill asset event as this mutation audit', async () => {
    const root = tempRoot('haro-feat024-stale-audit-');
    const entry = {
      id: 'user-demo',
      source: 'user' as const,
      originalSource: '/tmp/user-demo',
      pinnedCommit: 'local-path',
      license: 'unknown',
      installedAt: '2026-04-26T00:00:00.000Z',
      isPreinstalled: false,
      enabled: true,
      path: '/tmp/user-demo',
      description: 'User demo',
    };
    const fakeSkills = {
      ensureInitialized: vi.fn(),
      list: vi.fn(() => [entry]),
      enable: vi.fn(() => entry),
      getUsage: vi.fn(() => undefined),
    } as unknown as SkillsManager;
    const staleEvent = {
      id: 'asset_evt_old',
      assetId: 'skill:user-demo',
      type: 'promoted',
      actor: 'user',
      evidenceRefs: [],
      createdAt: '2026-04-25T00:00:00.000Z',
    };
    const fakeRegistry = {
      listEvents: vi.fn(() => [staleEvent]),
      getAsset: vi.fn(() => ({
        id: 'skill:user-demo',
        kind: 'skill',
        name: 'user-demo',
        version: 1,
        status: 'active',
        sourceRef: '/tmp/user-demo',
        contentRef: '/tmp/user-demo',
        contentHash: 'hash',
        createdBy: 'user',
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-25T00:00:00.000Z',
      })),
    } as unknown as EvolutionAssetRegistry;
    const app = createWebApp({
      logger: createMockLogger(),
      runtime: { root, skillsManager: fakeSkills, evolutionAssetRegistry: fakeRegistry },
    });

    const response = await app.request('/api/v1/skills/user-demo/enable', { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.audit.status).toBe('missing');
    expect(body.data.audit).not.toHaveProperty('event');
  });
});

function skillSourceFile(directory: string): string {
  return join(directory, 'SKILL.md');
}
