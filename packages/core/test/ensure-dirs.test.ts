/** AC5 — first run creates all required subdirectories under the Haro root. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureHaroDirectories,
  REQUIRED_HARO_SUBDIRS,
} from '../src/fs/ensure-dirs.js';

describe('ensureHaroDirectories [FEAT-001]', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'haro-dirs-'));
    // Use a nested non-existent path so mkdir recursion is exercised
    root = join(root, 'haro-home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC5 creates all required subdirectories on first run', () => {
    const result = ensureHaroDirectories(root);
    expect(result.created.length).toBe(REQUIRED_HARO_SUBDIRS.length);
    expect(result.existed).toEqual([]);
    for (const name of REQUIRED_HARO_SUBDIRS) {
      const dir = join(root, name);
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('AC5 second invocation is idempotent (no creations, all existed)', () => {
    ensureHaroDirectories(root);
    const again = ensureHaroDirectories(root);
    expect(again.created).toEqual([]);
    expect(again.existed.length).toBe(REQUIRED_HARO_SUBDIRS.length);
  });

  it('AC5 exposes exactly the documented subdirectories', () => {
    expect([...REQUIRED_HARO_SUBDIRS].sort()).toEqual(
      ['agents', 'archive', 'assets', 'channels', 'evolution-context', 'logs', 'memory', 'skills'].sort(),
    );
  });
});
