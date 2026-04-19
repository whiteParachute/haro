/** AC11 — only MemoryFabric itself may touch ~/.haro/memory directly. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');
const RESTRICTED_ROOTS = [
  join(repoRoot, 'packages/core/src'),
  join(repoRoot, 'packages/cli/src'),
  join(repoRoot, 'packages/providers/src'),
  join(repoRoot, 'packages/provider-codex/src'),
];
const MEMORY_FABRIC_DIR = join(repoRoot, 'packages/core/src/memory');
// AC11 regex from the spec — lifted almost verbatim but broadened a bit so
// that future helpers (fs.appendFile, fs.promises.writeFile, etc.) still get
// caught.
const FORBIDDEN = /fs\.(?:promises\.)?(?:write|read|append|unlink|mkdir)\w*\(.*\.haro\/memory/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && full.endsWith('.ts')) yield full;
  }
}

describe('FEAT-007 R11 memory-fs boundary', () => {
  it('AC11 no package outside MemoryFabric touches ~/.haro/memory via node:fs', () => {
    const offenders: string[] = [];
    for (const rootDir of RESTRICTED_ROOTS) {
      for (const file of walk(rootDir)) {
        if (file.startsWith(MEMORY_FABRIC_DIR)) continue;
        const text = readFileSync(file, 'utf8');
        if (FORBIDDEN.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
