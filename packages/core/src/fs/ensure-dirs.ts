import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildHaroPaths, REQUIRED_HARO_SUBDIRS } from '../paths.js';

export interface EnsureDirsResult {
  root: string;
  created: string[];
  existed: string[];
}

export interface EnsureDirsOptions {
  skip?: readonly (typeof REQUIRED_HARO_SUBDIRS)[number][];
}

export function ensureHaroDirectories(
  root?: string,
  options: EnsureDirsOptions = {},
): EnsureDirsResult {
  const paths = buildHaroPaths(root);
  const created: string[] = [];
  const existed: string[] = [];
  const skipped = new Set(options.skip ?? []);

  mkdirSync(paths.root, { recursive: true });

  for (const name of REQUIRED_HARO_SUBDIRS) {
    if (skipped.has(name)) continue;
    const dir = join(paths.root, name);
    const res = mkdirSync(dir, { recursive: true });
    if (res === undefined) {
      existed.push(dir);
    } else {
      created.push(dir);
    }
  }

  return { root: paths.root, created, existed };
}

export { REQUIRED_HARO_SUBDIRS };
