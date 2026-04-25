import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(here, '../core/src');
const providerCodexSrc = resolve(here, '../provider-codex/src');
const skillsSrc = resolve(here, '../skills/src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@haro\/core$/, replacement: resolve(coreSrc, 'index.ts') },
      { find: /^@haro\/provider-codex$/, replacement: resolve(providerCodexSrc, 'index.ts') },
      { find: /^@haro\/skills$/, replacement: resolve(skillsSrc, 'index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
