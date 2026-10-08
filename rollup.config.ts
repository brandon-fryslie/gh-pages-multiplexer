import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

// [LAW:one-source-of-truth] tsconfig.json is the sole source of TS compiler options.
// Two independent CJS bundles (D-08): Action consumer and CLI consumer both want a single
// self-contained CJS file. The ~50KB duplication is the deliberate cost of independent bundles.
const plugins = () => [
  resolve({ preferBuiltins: true }),
  commonjs(),
  typescript({ tsconfig: './tsconfig.json', outDir: './dist', declaration: false }),
];

// [LAW:one-source-of-truth] The root package.json is "type": "module", so node would load the
// CJS bundles as ESM. dist/package.json scopes dist/ back to commonjs; the build emits it so
// every file in dist/ is build output and check:dist covers it.
const commonjsScope = {
  name: 'commonjs-scope',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'package.json', source: '{\n  "type": "commonjs"\n}\n' });
  },
};

export default [
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.js', format: 'cjs', sourcemap: false },
    plugins: [...plugins(), commonjsScope],
  },
  {
    input: 'src/cli.ts',
    output: {
      file: 'dist/cli.js',
      format: 'cjs',
      sourcemap: false,
      // Banner ensures the shebang lands at byte-zero, before any CJS wrapper or 'use strict'.
      banner: '#!/usr/bin/env node',
    },
    plugins: plugins(),
  },
];
