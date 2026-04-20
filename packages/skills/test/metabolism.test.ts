import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsManager } from '../src/index.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Metabolism commands [FEAT-011]', () => {
  it('rejects generic knowledge and ambiguous short text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-eat-reject-'));
    roots.push(root);
    const manager = new SkillsManager({ root });
    const generic = await manager.invokeCommandSkill('eat', {
      input: 'Python 基础语法和 hello world 示例',
      as: 'text',
      yes: true,
    });
    expect(generic.output).toContain('rejected');
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
    writeFileSync(
      inputFile,
      [
        'Principle: Keep interfaces narrow',
        'Rule: Always validate inputs before side effects.',
        'Workflow: 1. Inspect 2. Validate 3. Apply',
      ].join('\n'),
      'utf8',
    );
    const result = await manager.invokeCommandSkill('eat', {
      input: inputFile,
      yes: true,
      as: 'path',
    });
    expect(result.output).toContain('proposal bundle');
    const archiveRoot = join(root, 'archive', 'eat-proposals');
    const bundle = readDirSingle(archiveRoot);
    expect(existsSync(join(bundle, 'memory-preview.md'))).toBe(true);
    expect(existsSync(join(bundle, 'rules'))).toBe(true);
    expect(existsSync(join(bundle, 'skills'))).toBe(true);
    expect(existsSync(join(root, 'memory', 'agents', 'haro-assistant', 'index.md'))).toBe(true);

    const largeInput = join(root, 'large.md');
    writeFileSync(
      largeInput,
      ['Rule: huge proposal', ...Array.from({ length: 180 }, (_, index) => `line ${index + 1}`)].join('\n'),
      'utf8',
    );
    await manager.invokeCommandSkill('eat', { input: largeInput, yes: true, as: 'path' });
    const secondBundle = newestDir(archiveRoot);
    const manifest = JSON.parse(readFileSync(join(secondBundle, 'manifest.json'), 'utf8')) as { suggestions: Array<{ reason: string }> };
    expect(manifest.suggestions.some((item) => item.reason.includes('too large'))).toBe(true);
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
    const rollback = await manager.invokeCommandSkill('shit', { archiveId });
    expect(rollback.output).toContain('restored');
    expect(existsSync(join(root, 'skills', 'user', 'custom-skill', 'SKILL.md'))).toBe(true);
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
