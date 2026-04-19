import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SolutionTsconfig {
  references?: Array<{ path?: string }>;
}

const repoRoot = resolve(__dirname, '..', '..', '..');
const solutionTsconfigPath = resolve(repoRoot, 'tsconfig.json');

describe('workspace tsconfig references', () => {
  it('only reference package projects that exist on disk', () => {
    const parsed = JSON.parse(
      readFileSync(solutionTsconfigPath, 'utf8'),
    ) as SolutionTsconfig;

    const references = parsed.references ?? [];
    expect(references.length).toBeGreaterThan(0);

    const missing = references
      .map((ref) => ref.path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .filter((path) => {
        const projectRoot = resolve(repoRoot, path);
        return !existsSync(projectRoot) || !existsSync(resolve(projectRoot, 'tsconfig.json'));
      });

    expect(missing).toEqual([]);
  });
});
