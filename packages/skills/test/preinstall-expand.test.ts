import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsManager } from '../src/index.js';
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
});
