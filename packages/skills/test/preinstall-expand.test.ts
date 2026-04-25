import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillFile, SkillsManager } from '../src/index.js';
import { execFileSync } from 'node:child_process';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('SkillsManager [FEAT-010]', () => {
  it('expands 15 preinstalled skills on first launch and exposes source metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-skills-expand-'));
    roots.push(root);
    const manager = new SkillsManager({ root });

    const entries = manager.list();
    expect(entries).toHaveLength(15);
    expect(entries.every((entry) => entry.isPreinstalled)).toBe(true);
    expect(existsSync(join(root, 'skills', 'preinstalled', 'memory', 'SKILL.md'))).toBe(true);
    const info = manager.info('memory');
    expect(info.pinnedCommit).toHaveLength(40);
    expect(info.license.length).toBeGreaterThan(0);
    manager.close();
  });

  it('rejects uninstalling preinstalled skills', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-skills-uninstall-'));
    roots.push(root);
    const manager = new SkillsManager({ root });
    expect(() => manager.uninstall('memory')).toThrow(/预装 skill 不可卸载/);
    manager.close();
  });

  it('tracks usage and routes remember before eat on description match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-skills-trigger-'));
    roots.push(root);
    const manager = new SkillsManager({ root });
    const result = await manager.prepareTask('记住这个偏好：以后默认中文回答', { agentId: 'haro-assistant' });
    expect(result.matchedSkillId).toBe('remember');
    const usage = manager.getUsage('remember');
    expect(usage?.useCount).toBe(1);
    const memoryIndex = readFileSync(join(root, 'memory', 'agents', 'haro-assistant', 'index.md'), 'utf8');
    expect(memoryIndex).toContain('以后默认中文回答');
    manager.close();
  });

  it('installs from symlinked local paths by copying resolved content and records resolvedFrom', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-skills-symlink-'));
    roots.push(root);
    const sourceRoot = mkdtempSync(join(tmpdir(), 'skill-source-'));
    roots.push(sourceRoot);
    writeFileSync(join(sourceRoot, 'SKILL.md'), '---\nname: local-skill\ndescription: "Local"\n---\n\nBody\n', 'utf8');
    const linkPath = join(tmpdir(), `skill-link-${Date.now()}`);
    symlinkSync(sourceRoot, linkPath, 'dir');

    const manager = new SkillsManager({ root });
    const entry = manager.install(linkPath);
    expect(entry.id).toBe('local-skill');
    expect(entry.resolvedFrom).toBe(sourceRoot);
    expect(existsSync(join(root, 'skills', 'user', 'local-skill', 'SKILL.md'))).toBe(true);
    manager.close();
    rmSync(linkPath, { force: true, recursive: true });
  });

  it('installs from git urls into user skills and updates installed.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-skills-git-'));
    roots.push(root);
    const repo = mkdtempSync(join(tmpdir(), 'skill-git-'));
    roots.push(repo);
    writeFileSync(join(repo, 'SKILL.md'), '---\nname: git-skill\ndescription: "Git skill"\n---\n\nBody\n', 'utf8');
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'bot@example.com'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Bot'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });

    const manager = new SkillsManager({ root });
    const entry = manager.install(`file://${repo}`);
    expect(entry.id).toBe('git-skill');
    expect(entry.originalSource).toBe(`file://${repo}`);
    const installed = JSON.parse(readFileSync(join(root, 'skills', 'installed.json'), 'utf8')) as { skills: Record<string, { pinnedCommit: string }> };
    expect(installed.skills['git-skill']?.pinnedCommit).toHaveLength(40);
    manager.close();
  });

  it('FEAT-020 AC1: bundled shit skill has cross-runtime frontmatter', () => {
    const content = readFileSync(join(__dirname, '..', 'resources', 'preinstalled', 'shit', 'SKILL.md'), 'utf8');
    const descriptor = parseSkillFile(content, 'fallback');

    expect(descriptor.id).toBe('shit');
    expect(descriptor.description).toContain('Review');
    expect(descriptor.description.length).toBeGreaterThan(0);
  });

  it('FEAT-020 AC1a/AC4: syncs eat and shit to temp Codex and Claude homes by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runtime-sync-'));
    const codexHome = mkdtempSync(join(tmpdir(), 'haro-codex-home-'));
    const claudeHome = mkdtempSync(join(tmpdir(), 'haro-claude-home-'));
    roots.push(root, codexHome, claudeHome);
    const manager = new SkillsManager({ root });

    const result = manager.syncRuntimeSkills({ homes: { codex: codexHome, claude: claudeHome } });

    expect(result.hasConflicts).toBe(false);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: 'codex', skillId: 'eat', status: 'synced' }),
        expect.objectContaining({ runtime: 'codex', skillId: 'shit', status: 'synced' }),
        expect.objectContaining({ runtime: 'claude', skillId: 'eat', status: 'synced' }),
        expect.objectContaining({ runtime: 'claude', skillId: 'shit', status: 'synced' }),
      ]),
    );
    for (const home of [codexHome, claudeHome]) {
      for (const skillId of ['eat', 'shit']) {
        for (const file of ['SKILL.md', 'LICENSE', 'NOTICE']) {
          const target = join(home, 'skills', skillId, file);
          const canonical = join(__dirname, '..', 'resources', 'preinstalled', skillId, file);
          expect(readFileSync(target, 'utf8')).toBe(readFileSync(canonical, 'utf8'));
        }
      }
    }
    manager.close();
  });

  it('FEAT-020 AC4: supports explicit runtime selection and CODEX_HOME/CLAUDE_HOME env homes', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runtime-env-'));
    const codexHome = mkdtempSync(join(tmpdir(), 'haro-codex-env-'));
    const claudeHome = mkdtempSync(join(tmpdir(), 'haro-claude-env-'));
    roots.push(root, codexHome, claudeHome);
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeHome = process.env.CLAUDE_HOME;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    try {
      const manager = new SkillsManager({ root });
      const result = manager.syncRuntimeSkills({ skill: 'shit', runtimes: ['claude'] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ runtime: 'claude', skillId: 'shit', status: 'synced' });
      expect(existsSync(join(claudeHome, 'skills', 'shit', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(codexHome, 'skills', 'shit', 'SKILL.md'))).toBe(false);
      manager.close();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      if (previousClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = previousClaudeHome;
      }
    }
  });

  it('FEAT-020 AC5: fails fast instead of silently overwriting a different runtime skill', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-runtime-conflict-'));
    const codexHome = mkdtempSync(join(tmpdir(), 'haro-codex-conflict-'));
    roots.push(root, codexHome);
    const target = join(codexHome, 'skills', 'shit');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), '---\nname: shit\ndescription: other\n---\n\nOther implementation\n', 'utf8');
    const manager = new SkillsManager({ root, now: () => new Date('2026-04-25T00:00:00.000Z') });

    const conflict = manager.syncRuntimeSkills({ skill: 'shit', runtimes: ['codex'], homes: { codex: codexHome } });

    expect(conflict.hasConflicts).toBe(true);
    expect(conflict.items).toEqual([
      expect.objectContaining({
        runtime: 'codex',
        skillId: 'shit',
        status: 'conflict',
        targetPath: target,
      }),
    ]);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('Other implementation');

    const overwritten = manager.syncRuntimeSkills({ skill: 'shit', runtimes: ['codex'], homes: { codex: codexHome }, overwrite: true });
    expect(overwritten.hasConflicts).toBe(false);
    expect(overwritten.items[0]).toMatchObject({ status: 'synced', backupPath: `${target}.backup-2026-04-25T00-00-00-000Z` });
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(__dirname, '..', 'resources', 'preinstalled', 'shit', 'SKILL.md'), 'utf8'));
    expect(readFileSync(join(`${target}.backup-2026-04-25T00-00-00-000Z`, 'SKILL.md'), 'utf8')).toContain('Other implementation');
    manager.close();
  });
});
