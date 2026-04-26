import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryMemory, installSkill, listSkills, uninstallSkill } from '../src/api/client';
import { KnowledgePageView } from '../src/pages/KnowledgePage';
import { SkillsPageView } from '../src/pages/SkillsPage';
import type { MemorySearchResult, SkillSummary } from '../src/types';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('FEAT-024 Knowledge and Skills dashboard UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls Memory query contract with keyword, scope, layer, and verificationStatus filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/memory/query?keyword=dashboard&scope=shared&layer=persistent&verificationStatus=verified&limit=10')) {
        return jsonResponse({ success: true, data: { items: [memoryFixture], count: 1, limit: 10 } });
      }
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await queryMemory({ keyword: 'dashboard', scope: 'shared', layer: 'persistent', verificationStatus: 'verified', limit: 10 });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/memory/query?keyword=dashboard&scope=shared&layer=persistent&verificationStatus=verified&limit=10',
    ]);
  });

  it('renders KnowledgePage search results with sourceRef, verificationStatus, assetRef, timestamp, and no platform write option', () => {
    const html = renderToString(
      <KnowledgePageView
        results={[memoryFixture]}
        filters={{ keyword: 'dashboard', scope: 'shared', layer: 'persistent', verificationStatus: 'verified' }}
        onFiltersChange={() => undefined}
        onSearch={() => undefined}
        onWrite={() => undefined}
        onMaintenance={() => undefined}
      />,
    );

    expect(html).toContain('Knowledge');
    expect(html).toContain('Dashboard memory summary');
    expect(html).toContain('sourceRef:');
    expect(html).toContain('spec:FEAT-024');
    expect(html).toContain('verified');
    expect(html).toContain('asset:memory-demo');
    expect(html).toContain('2026-04-26T00:00:00.000Z');
    expect(html).toContain('platform (read-only)');
    expect(html).not.toContain('<option value="platform">platform</option>');
  });

  it('calls Skills list/install/uninstall contracts and renders audit result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/skills') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ success: true, data: { items: skillsFixture, count: skillsFixture.length } });
      }
      if (url.endsWith('/api/v1/skills/install')) {
        return jsonResponse({ success: true, data: { skill: skillsFixture[1], audit: auditFixture } }, { status: 201 });
      }
      if (url.endsWith('/api/v1/skills/user-demo') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: { skill: { ...skillsFixture[1], assetStatus: 'archived' }, audit: auditFixture } });
      }
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await listSkills();
    await installSkill('/tmp/user-demo');
    await uninstallSkill('user-demo');

    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`);
    expect(calls).toContain('GET /api/v1/skills');
    expect(calls).toContain('POST /api/v1/skills/install');
    expect(calls).toContain('DELETE /api/v1/skills/user-demo');

    const html = renderToString(
      <SkillsPageView
        skills={skillsFixture}
        onRefresh={() => undefined}
        onToggle={() => undefined}
        onInstall={() => undefined}
        onUninstall={() => undefined}
        audit={auditFixture}
      />,
    );

    expect(html).toContain('Preinstalled skills');
    expect(html).toContain('User skills');
    expect(html).toContain('eat');
    expect(html).toContain('user-demo');
    expect(html).toContain('preinstalled');
    expect(html).toContain('2026-04-20T00:00:00.000Z');
    expect(html).toContain('enabled');
    expect(html).toContain('2026-04-26T00:00:00.000Z');
    expect(html).toContain('active');
    expect(html).toContain('Preinstalled protected');
    expect(html).toContain('useCount:');
    expect(html).toContain('3');
    expect(html).toContain('Asset audit result');
    expect(html).toContain('archived');
    expect(html).toContain('haro shit');
  });
});

const memoryFixture: MemorySearchResult = {
  entry: {
    id: 'mem-1',
    layer: 'persistent',
    scope: 'shared',
    topic: 'dashboard knowledge',
    summary: 'Dashboard memory summary',
    content: 'Full memory content',
    sourceRef: 'spec:FEAT-024',
    assetRef: 'asset:memory-demo',
    verificationStatus: 'verified',
    tags: ['feat-024'],
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
  },
  score: 88,
  rank: 1,
  matchedBy: ['fts5'],
};

const skillsFixture: SkillSummary[] = [
  {
    id: 'eat',
    source: 'preinstalled',
    enabled: true,
    installedAt: '2026-04-20T00:00:00.000Z',
    isPreinstalled: true,
    originalSource: 'bundled',
    pinnedCommit: 'bundled',
    license: 'MIT',
    description: 'Capture knowledge',
    assetStatus: 'active',
    assetRef: 'skill:eat',
    useCount: 3,
    lastUsedAt: '2026-04-26T00:00:00.000Z',
  },
  {
    id: 'user-demo',
    source: 'user',
    enabled: true,
    installedAt: '2026-04-26T00:00:00.000Z',
    isPreinstalled: false,
    originalSource: '/tmp/user-demo',
    pinnedCommit: 'local-path',
    license: 'unknown',
    description: 'User demo',
    assetStatus: 'active',
    assetRef: 'skill:user-demo',
    useCount: 0,
  },
];

const auditFixture = {
  status: 'recorded' as const,
  event: {
    id: 'asset_evt_1',
    assetId: 'skill:user-demo',
    type: 'archived',
    createdAt: '2026-04-26T00:00:00.000Z',
  },
  asset: {
    id: 'skill:user-demo',
    status: 'archived' as const,
    updatedAt: '2026-04-26T00:00:00.000Z',
  },
};
