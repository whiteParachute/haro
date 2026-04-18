import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(here, '../core/src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@haro\/core$/, replacement: resolve(coreSrc, 'index.ts') },
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
