import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    watch: false,
    // Use threads pool so jsdom (per-test env directive) resolves from this
    // project's node_modules rather than vitest's install directory.
    pool: 'threads',
    // Node >=25 defines its own globalThis.localStorage (undefined without
    // --localstorage-file); vitest's jsdom env never overwrites a key the
    // global already has, so Node's shadows jsdom's window.localStorage.
    execArgv: ['--no-experimental-webstorage'],
  },
});
