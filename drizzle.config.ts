import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/schema.ts',
  out: process.env.DRIZZLE_OUT ?? './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://babycare:babycare@localhost:5432/babycare',
  },
});
