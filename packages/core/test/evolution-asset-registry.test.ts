/** FEAT-022 — Evolution Asset Registry lifecycle, audit log, dedupe, and manifest export. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvolutionAssetRegistry, hashEvolutionAssetContent } from '../src/evolution/index.js';
import type { EvolutionAssetDraft } from '../src/evolution/index.js';
import { createMemoryFabric } from '../src/memory/index.js';

function assetDraft(content: string, overrides: Partial<EvolutionAssetDraft> = {}): EvolutionAssetDraft {
  return {
    kind: 'skill' as const,
    name: 'narrow-interface-helper',
    sourceRef: 'eat-proposal:test',
    contentRef: 'archive/eat-proposals/test/skills/narrow-interface-helper/SKILL.md',
    contentHash: hashEvolutionAssetContent(content),
    createdBy: 'eat' as const,
    ...overrides,
  };
}

describe('EvolutionAssetRegistry [FEAT-022]', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'haro-asset-registry-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1/AC5 creates proposed assets, appends events, and dedupes repeated contentHash proposals', () => {
    const registry = createEvolutionAssetRegistry({ root, now: () => new Date('2026-04-25T00:00:00.000Z') });
    const content = 'Workflow: validate inputs because rollback is expensive.';

    const proposed = registry.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: assetDraft(content),
      evidenceRefs: ['archive/eat-proposals/test/manifest.json'],
      metadata: { qualityGate: 'pass' },
    });
    const asset = registry.getAsset(proposed.assetId, { includeEvents: true });
    expect(asset).toMatchObject({
      kind: 'skill',
      status: 'proposed',
      version: 1,
      contentHash: hashEvolutionAssetContent(content),
    });
    expect(asset?.events.map((event) => event.type)).toEqual(['proposed']);

    const duplicate = registry.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: assetDraft(content),
      evidenceRefs: ['archive/eat-proposals/test-2/manifest.json'],
    });
    expect(duplicate.assetId).toBe(proposed.assetId);
    expect(duplicate.type).toBe('conflict');
    const afterDuplicate = registry.getAsset(proposed.assetId, { includeEvents: true });
    expect(afterDuplicate?.events.map((event) => event.type)).toEqual(['proposed', 'conflict']);
    expect(registry.resolveByContentHash(hashEvolutionAssetContent(content), { kind: 'skill', includeArchived: true })).toHaveLength(1);
    registry.close();
  });

  it('AC2/AC4 applies lifecycle transitions without deleting historical events', () => {
    const registry = createEvolutionAssetRegistry({ root, now: () => new Date('2026-04-25T00:00:00.000Z') });
    const proposed = registry.recordEvent({ type: 'proposed', asset: assetDraft('Skill v1'), actor: 'agent' });
    registry.recordEvent({
      assetId: proposed.assetId,
      type: 'promoted',
      actor: 'user',
      contentRef: 'skills/user/narrow-interface-helper',
      evidenceRefs: ['haro skills install'],
    });
    registry.recordEvent({
      assetId: proposed.assetId,
      type: 'archived',
      actor: 'system',
      evidenceRefs: ['archive/shit-test/manifest.json'],
      metadata: { archiveId: 'shit-test', rollbackStep: 'restore skill' },
    });
    registry.recordEvent({
      assetId: proposed.assetId,
      type: 'rollback',
      actor: 'user',
      evidenceRefs: ['haro shit rollback shit-test'],
    });

    const asset = registry.getAsset(proposed.assetId, { includeEvents: true });
    expect(asset?.status).toBe('active');
    expect(asset?.version).toBe(3);
    expect(asset?.events.map((event) => event.type)).toEqual(['proposed', 'promoted', 'archived', 'rollback']);
    expect(asset?.events.some((event) => event.metadata && 'before' in event.metadata)).toBe(true);
    registry.close();
  });

  it('AC6 links memory assetRef to Memory Fabric reverse lookup', async () => {
    const registry = createEvolutionAssetRegistry({ root });
    const event = registry.recordEvent({
      type: 'promoted',
      actor: 'agent',
      asset: {
        id: 'memory:eat:asset-ref-demo',
        kind: 'memory',
        name: 'assetRef demo memory',
        status: 'active',
        sourceRef: 'skill:eat',
        contentRef: 'memory/agents/haro-assistant/knowledge/asset-ref-demo.md',
        contentHash: hashEvolutionAssetContent('assetRef reverse lookup content'),
        createdBy: 'eat',
      },
    });
    const memory = createMemoryFabric({ root: join(root, 'memory'), dbFile: join(root, 'haro.db') });
    const entry = await memory.writeEntry({
      layer: 'skill',
      scope: 'shared',
      topic: 'assetRef reverse lookup',
      content: 'assetRef reverse lookup content',
      sourceRef: 'skill:eat',
      assetRef: event.assetId,
    });

    const hits = memory.queryEntries({ assetRef: event.assetId, keyword: 'reverse lookup', limit: 5 });
    expect(hits.map((hit) => hit.entry.id)).toContain(entry.id);
    registry.close();
  });

  it('AC7/AC8 registers prompt and routing-rule assets without required GEP metadata', () => {
    const registry = createEvolutionAssetRegistry({ root });
    const prompt = registry.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: {
        kind: 'prompt',
        name: 'haro-assistant systemPrompt',
        sourceRef: 'agents/haro-assistant.yaml#systemPrompt',
        contentRef: 'agents/haro-assistant.yaml#systemPrompt',
        contentHash: hashEvolutionAssetContent('whole system prompt text'),
        createdBy: 'migration',
      },
    });
    const routing = registry.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: {
        kind: 'routing-rule',
        name: 'project override: review tasks',
        sourceRef: '.haro/selection-rules.yaml',
        contentRef: '.haro/selection-rules.yaml#review',
        contentHash: hashEvolutionAssetContent('project override rule'),
        createdBy: 'user',
      },
    });

    expect(registry.getAsset(prompt.assetId)?.gep).toBeUndefined();
    expect(registry.listAssets({ includeArchived: true }).map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(['prompt', 'routing-rule']),
    );
    expect(registry.getAsset(routing.assetId)?.sourceRef).toContain('selection-rules.yaml');
    registry.close();
  });

  it('exports a manifest containing assets and events', () => {
    const registry = createEvolutionAssetRegistry({ root, now: () => new Date('2026-04-25T12:00:00.000Z') });
    const event = registry.recordEvent({ type: 'proposed', actor: 'agent', asset: assetDraft('manifest export') });
    const outputFile = join(root, 'assets', 'manifest-exports', 'assets.json');

    const manifest = registry.exportManifest({ outputFile });

    expect(manifest.exportedAt).toBe('2026-04-25T12:00:00.000Z');
    expect(manifest.assets.map((asset) => asset.id)).toContain(event.assetId);
    expect(manifest.events?.map((item) => item.assetId)).toContain(event.assetId);
    expect(existsSync(outputFile)).toBe(true);
    expect(readFileSync(outputFile, 'utf8')).toContain(event.assetId);
    registry.close();
  });
});
