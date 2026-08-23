import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/operations/verify-restored-database.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  target: 'es2022',
  noExternal: ['@baby-care/contracts', '@baby-care/domain', '@baby-care/observability'],
});
