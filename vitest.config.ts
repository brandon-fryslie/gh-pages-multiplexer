import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    watch: false,
    // Use threads pool so jsdom (per-test env directive) resolves from this
    // project's node_modules rather than vitest's install directory.
    pool: 'threads',
  },
});
