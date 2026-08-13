import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? it : it.skip;

describe('PostgreSQL integration', () => {
  integration('checks a real PostgreSQL connection', async () => {
    const database = createDatabase(databaseUrl!);
    try {
      await expect(database.checkDatabase()).resolves.toBe(true);
      const result = await database.pool.query<{ answer: number }>('select 42::int as answer');
      expect(result.rows[0]?.answer).toBe(42);
    } finally {
      await database.close();
    }
  });
});
