import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    hookTimeout: 20000,
    testTimeout: 20000,
    // @live tests hit the real SDK + subscription auth; skipped by default.
    exclude: ['**/*.live.test.ts'],
  },
});
