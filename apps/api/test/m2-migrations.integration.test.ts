import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
let database: DatabaseContext | undefined;

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

describeDatabase('M2 care migrations', () => {
  it('creates the M2 care event envelope and typed child tables', async () => {
    database = createDatabase(testDatabaseUrl!);
    await database.migrate();

    const result = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = new Set(result.rows.map((row) => row.table_name));

    for (const expected of [
      'care_events',
      'feeding_sessions',
      'feeding_components',
      'diaper_events',
      'sleep_intervals',
      'care_actions',
      'measurements',
      'care_event_revisions',
    ]) {
      expect(tables.has(expected), `missing M2 table ${expected}`).toBe(true);
    }
  });
});
