import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvolutionAssetRegistry, createMemoryFabric } from '@haro/core';
import { SkillsManager } from '../src/index.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Metabolism commands [FEAT-011]', () => {
  it('rejects generic knowledge, entertainment/one-off, conflicts, duplicates, inferable repo facts, and ambiguous short text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-eat-reject-'));
    roots.push(root);
    const manager = new SkillsManager({ root });

    const generic = await manager.invokeCommandSkill('eat', {
      input: 'Python 基础语法和 hello world 示例',
      as: 'text',
      yes: true,
    });
    expect(generic.output).toContain('rejected');
    expect(generic.output).toContain('not-generic-knowledge');

    const entertainment = await manager.invokeCommandSkill('eat', {
      input: '这是个搞笑段子合集，只图一乐，今天先这样。',
      as: 'text',
      yes: true,
    });
    expect(entertainment.output).toContain('not-entertainment');

    mkdirSync(join(root, 'rules'), { recursive: true });
    writeFileSync(join(root, 'rules', 'deploy.md'), '# deploy\n\nRule: Never deploy on Friday.\n', 'utf8');
    const conflict = await manager.invokeCommandSkill('eat', {
      input: 'Rule: Always deploy on Friday because it feels lucky.',
      as: 'text',
      yes: true,
    });
    expect(conflict.output).toContain('not-conflicting-with-existing');

    writeFileSync(join(root, 'rules', 'validation.md'), '# validation\n\nRule: Always validate inputs before side effects.\n', 'utf8');
    const equivalent = await manager.invokeCommandSkill('eat', {
      input: 'Rule: Always validate inputs before side effects.',
      as: 'text',
      yes: true,
    });
    expect(equivalent.output).toContain('not-equivalent-to-existing');

    writeFileSync(join(root, 'package.json'), '{"name":"tmp"}\n', 'utf8');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf8');
    mkdirSync(join(root, 'packages'), { recursive: true });
    const inferable = await manager.invokeCommandSkill('eat', {
      input: '这个仓库是 pnpm workspace monorepo，packages 目录里是 TypeScript 模块。',
      as: 'text',
      yes: true,
    });
    expect(inferable.output).toContain('not-inferable-from-codebase');

    await expect(
      manager.invokeCommandSkill('eat', {
        input: '短文本',
        yes: true,
      }),
    ).rejects.toThrow(/ambiguous/);
    manager.close();
  });

  it('writes memory plus proposal bundle and enforces anti-bloat limits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-eat-bundle-'));
    roots.push(root);
    const manager = new SkillsManager({ root });
    const inputFile = join(root, 'source.md');
    let preview = '';
    writeFileSync(
      inputFile,
      [
        'Principle: Keep interfaces narrow',
        'Rule: Always validate inputs before side effects because rollback is expensive.',
        'Workflow: When external input appears, 1. Inspect 2. Validate 3. Apply',
      ].join('\n'),
      'utf8',
    );
    const result = await manager.invokeCommandSkill('eat', {
      input: inputFile,
      yes: true,
      as: 'path',
      stdout: {
        write(chunk: string | Uint8Array) {
          preview += String(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
    });
    expect(result.output).toContain('proposal bundle');
    expect(preview).toContain('quality gate:');
    expect(preview).toContain('four questions:');
    expect(preview).toContain('Failure-backed?: pass');
    expect(preview).toContain('Decision-encoding?: pass');
    expect(preview).toContain('Triggerable?: pass');
    expect(preview).toContain('decision: accept');
    const archiveRoot = join(root, 'archive', 'eat-proposals');
    const bundle = readDirSingle(archiveRoot);
    expect(existsSync(join(bundle, 'memory-preview.md'))).toBe(true);
    expect(existsSync(join(bundle, 'rules'))).toBe(true);
    expect(existsSync(join(bundle, 'skills'))).toBe(true);
    expect(existsSync(join(root, 'memory', 'agents', 'haro-assistant', 'index.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as {
      memoryWrites: Array<{ assetRef: string }>;
      proposals: Array<{ type: string; assetId: string; eventType: string }>;
    };
    const registry = createEvolutionAssetRegistry({ root });
    const skillProposal = manifest.proposals.find((item) => item.type === 'skills');
    expect(skillProposal?.eventType).toBe('proposed');
    const skillAsset = registry.getAsset(skillProposal!.assetId, { includeEvents: true });
    expect(skillAsset?.status).toBe('proposed');
    expect(skillAsset?.events.map((event) => event.type)).toContain('proposed');
    const memoryHits = createMemoryFabric({ root: join(root, 'memory'), dbFile: join(root, 'haro.db') }).queryEntries({
      assetRef: manifest.memoryWrites[0]!.assetRef,
      keyword: 'Keep interfaces narrow',
      limit: 5,
    });
    expect(memoryHits.length).toBeGreaterThanOrEqual(1);
    registry.close();

    const largeInput = join(root, 'large.md');
    writeFileSync(
      largeInput,
      ['Rule: huge proposal', ...Array.from({ length: 180 }, (_, index) => `line ${index + 1}`)].join('\n'),
      'utf8',
    );
    await manager.invokeCommandSkill('eat', { input: largeInput, yes: true, as: 'path' });
    const secondBundle = newestDir(archiveRoot);
    const largeManifest = JSON.parse(readFileSync(join(secondBundle, 'manifest.json'), 'utf8')) as { suggestions: Array<{ reason: string }> };
    expect(largeManifest.suggestions.some((item) => item.reason.includes('too large'))).toBe(true);
    expect(existsSync(join(secondBundle, 'rules', 'rule-huge-proposal.md'))).toBe(false);
    manager.close();
  });

  it('archives stale user skills, skips preinstalled skills on dry-run, and rolls back archived items', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shit-archive-'));
    roots.push(root);
    const manager = new SkillsManager({ root });
    const userSkill = join(root, 'tmp-skill');
    mkdirSync(userSkill, { recursive: true });
    writeFileSync(join(userSkill, 'SKILL.md'), '---\nname: custom-skill\ndescription: "Custom"\n---\n\nBody\n', 'utf8');
    manager.installFromPath(userSkill);

    const dryRun = await manager.invokeCommandSkill('shit', { scope: 'skills', days: 0, dryRun: true });
    expect(dryRun.output).toContain('custom-skill');
    expect(dryRun.output).not.toContain('memory-wrapup');

    const archived = await manager.invokeCommandSkill('shit', { scope: 'skills', days: 0, confirmHigh: true });
    expect(archived.output).toContain('archived to');
    expect(existsSync(join(root, 'skills', 'user', 'custom-skill'))).toBe(false);
    const archiveId = readDirSingle(join(root, 'archive')).split('/').pop()!;
    const registry = createEvolutionAssetRegistry({ root });
    const archivedAsset = registry.getAsset('skill:custom-skill', { includeEvents: true });
    expect(archivedAsset?.status).toBe('archived');
    expect(archivedAsset?.events.map((event) => event.type)).toEqual(expect.arrayContaining(['promoted', 'archived']));
    expect(registry.getAsset(`archive:${archiveId}`)?.kind).toBe('archive');
    const rollback = await manager.invokeCommandSkill('shit', { archiveId });
    expect(rollback.output).toContain('restored');
    expect(existsSync(join(root, 'skills', 'user', 'custom-skill', 'SKILL.md'))).toBe(true);
    const rolledBackAsset = registry.getAsset('skill:custom-skill', { includeEvents: true });
    expect(rolledBackAsset?.status).toBe('active');
    expect(rolledBackAsset?.events.map((event) => event.type)).toContain('rollback');
    registry.close();
    manager.close();
  });
});

function readDirSingle(root: string): string {
  const entries = newestDir(root);
  return entries;
}

function newestDir(root: string): string {
  const entries = require('node:fs').readdirSync(root).sort();
  return join(root, entries[entries.length - 1]);
}
