import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  dialect: 'postgresql',
  schema: resolve(repoRoot, 'apps/api/src/schema.ts'),
  out: process.env.DRIZZLE_OUT ?? resolve(repoRoot, 'migrations'),
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://babycare:babycare@localhost:5432/babycare',
  },
});
