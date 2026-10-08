import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    watch: false,
    // [LAW:one-source-of-truth] The test fixtures' git identity, and nothing from the developer's own global config.
    env: { GIT_CONFIG_GLOBAL: fileURLToPath(new URL('./__tests__/gitconfig', import.meta.url)) },
    // Use threads pool so jsdom (per-test env directive) resolves from this
    // project's node_modules rather than vitest's install directory.
    pool: 'threads',
    // Node >=25 defines its own globalThis.localStorage (undefined without
    // --localstorage-file); vitest's jsdom env never overwrites a key the
    // global already has, so Node's shadows jsdom's window.localStorage.
    execArgv: ['--no-experimental-webstorage'],
  },
});
