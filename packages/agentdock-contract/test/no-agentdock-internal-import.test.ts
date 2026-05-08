import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const srcRoot = resolve(packageRoot, 'src');

function listTypescriptFiles(dir: string): string[] {
  const entries = readdirSync(dir).map((entry) => resolve(dir, entry));
  const files: string[] = [];

  for (const entry of entries) {
    if (statSync(entry).isDirectory()) {
      files.push(...listTypescriptFiles(entry));
    } else if (entry.endsWith('.ts')) {
      files.push(entry);
    }
  }

  return files;
}

describe('AgentDock internal import guard [FEAT-043]', () => {
  it('does not import AgentDock internal src or dist modules', () => {
    const offenders = listTypescriptFiles(srcRoot).flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const forbidden = [
        /agent-dock\/src\//,
        /agent-dock\/dist\//,
        /from ['"][^'"]*\.\.\/\.\.\/\.\.\/agent-dock\/src\//,
        /from ['"][^'"]*\.\.\/\.\.\/\.\.\/agent-dock\/dist\//,
      ];
      return forbidden.some((pattern) => pattern.test(content)) ? [file] : [];
    });

    expect(offenders).toEqual([]);
  });
});
