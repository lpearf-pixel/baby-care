import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  splitting: false,
  target: 'es2022',
});
