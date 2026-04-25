import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillText = readFileSync(join(process.cwd(), 'resources', 'preinstalled', 'shit', 'SKILL.md'), 'utf8');

describe('shit SKILL.md Codex runtime contract [FEAT-020]', () => {
  it('has Codex-compatible frontmatter for the shit skill', () => {
    expect(skillText).toMatch(/^---\nname: shit\n/m);
    expect(skillText).toMatch(/description: "Counterpart to eat: dry-run-first archival\/rollback workflow/);
  });

  it('is dry-run-first and never documents direct destructive cleanup commands', () => {
    expect(skillText).toContain('dry-run-first');
    expect(skillText).toContain('haro shit --dry-run');
    expect(skillText).toMatch(/Start with `haro shit --dry-run`/);
    expect(skillText).not.toMatch(/(^|\s)(rm|unlink|mv)(\s|$)|rm -rf|fs\.unlink|fs\.rm|fs\.rename|mv /);
  });

  it('routes state changes through Haro archive and rollback only', () => {
    expect(skillText).toContain('Perform all archive and rollback state changes through `haro shit`, `haro shit rollback`, or Haro APIs only.');
    expect(skillText).toContain('do not invent a parallel cleanup algorithm');
  });

  it('requires explicit high-risk confirmation', () => {
    expect(skillText).toContain('--confirm-high');
    expect(skillText).toContain('Keep high-risk candidates excluded unless the user explicitly requests the high-risk path.');
  });

  it('has a no-Haro fallback that refuses destructive execution', () => {
    expect(skillText).toContain('## No-Haro fallback');
    expect(skillText).toContain('Do not execute cleanup.');
    expect(skillText).toContain('Do not modify files.');
    expect(skillText).toContain('manual review checklist');
  });

  it('treats rollback as a first-class flow', () => {
    expect(skillText).toContain('haro shit rollback <archive-id>');
    expect(skillText).toContain('haro shit rollback <archive-id> --item <path>');
    expect(skillText).toContain('Show the archive id and manifest summary.');
  });
});
