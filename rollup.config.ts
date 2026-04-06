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

export default [
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.js', format: 'cjs', sourcemap: false },
    plugins: plugins(),
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
