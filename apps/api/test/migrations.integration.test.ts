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

describeDatabase('M1 database migrations', () => {
  it('migrates an empty database and creates the six M1 tables', async () => {
    database = createDatabase(testDatabaseUrl!);
    const migrate = (database as DatabaseContext & { migrate?: () => Promise<void> }).migrate;

    expect(migrate).toBeTypeOf('function');
    await migrate!.call(database);

    const result = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tableNames = new Set(result.rows.map((row) => row.table_name));

    for (const expected of [
      'families',
      'users',
      'family_memberships',
      'babies',
      'sessions',
      'audit_events',
    ]) {
      expect(tableNames.has(expected), `missing table ${expected}`).toBe(true);
    }
  });

  it('enforces the active-family singleton and one baby per family', async () => {
    database = createDatabase(testDatabaseUrl!);
    const migrate = (database as DatabaseContext & { migrate?: () => Promise<void> }).migrate;

    expect(migrate).toBeTypeOf('function');
    await migrate!.call(database);

    const familyId = '11111111-1111-4111-8111-111111111111';
    await database.pool.query(
      `insert into families (id, name, timezone, status) values ($1, 'Xiangxiang Family', 'Asia/Shanghai', 'active')`,
      [familyId],
    );

    await expect(
      database.pool.query(
        `insert into families (id, name, timezone, status) values ('22222222-2222-4222-8222-222222222222', 'Other Family', 'Asia/Shanghai', 'active')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await database.pool.query(
      `insert into babies (id, family_id, display_name, status) values ('33333333-3333-4333-8333-333333333333', $1, 'xiangxiang', 'active')`,
      [familyId],
    );

    await expect(
      database.pool.query(
        `insert into babies (id, family_id, display_name, status) values ('44444444-4444-4444-8444-444444444444', $1, 'another baby', 'active')`,
        [familyId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
