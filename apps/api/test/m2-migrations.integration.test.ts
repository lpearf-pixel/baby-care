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

async function migratedDatabase(): Promise<DatabaseContext> {
  const context = createDatabase(testDatabaseUrl!);
  await context.migrate();
  return context;
}

describeDatabase('M2 care migrations', () => {
  it('creates the M2 care event envelope and typed child tables', async () => {
    database = await migratedDatabase();

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

  it('installs ownership, positive-value, and interval constraints', async () => {
    database = await migratedDatabase();

    const result = await database.pool.query<{ conname: string }>(
      `select conname from pg_constraint where connamespace = 'public'::regnamespace`,
    );
    const constraints = new Set(result.rows.map((row) => row.conname));

    for (const expected of [
      'care_events_family_baby_fk',
      'care_events_actor_membership_fk',
      'care_events_version_positive',
      'care_events_manual_actor_required',
      'feeding_components_shape_check',
      'sleep_intervals_order_check',
      'care_actions_crying_duration_positive',
      'care_actions_medication_fields_check',
      'measurements_value_positive',
    ]) {
      expect(constraints.has(expected), `missing M2 constraint ${expected}`).toBe(true);
    }
  });
});
