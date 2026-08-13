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

async function migrateDatabase(): Promise<DatabaseContext> {
  const context = createDatabase(testDatabaseUrl!);
  await context.migrate();
  await context.pool.query(
    'truncate table audit_events, sessions, babies, family_memberships, users, families restart identity cascade',
  );
  return context;
}

describeDatabase('M1 database migrations', () => {
  it('migrates an empty database and creates the six M1 tables', async () => {
    database = await migrateDatabase();
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

  it('enforces one active family and one baby per family', async () => {
    database = await migrateDatabase();
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

  it('enforces one active relationship and unique session token hashes', async () => {
    database = await migrateDatabase();
    const familyId = '55555555-5555-4555-8555-555555555555';
    const dadId = '66666666-6666-4666-8666-666666666666';
    const otherDadId = '77777777-7777-4777-8777-777777777777';

    await database.pool.query(
      `insert into families (id, name, timezone, status) values ($1, 'Xiangxiang Family', 'Asia/Shanghai', 'active')`,
      [familyId],
    );
    await database.pool.query(
      `insert into users (id, login_name, display_name, password_hash, status) values ($1, 'dad', 'Dad', 'hash-1', 'active'), ($2, 'dad2', 'Dad 2', 'hash-2', 'active')`,
      [dadId, otherDadId],
    );
    await database.pool.query(
      `insert into family_memberships (id, family_id, user_id, relationship, permission_level, status) values ('88888888-8888-4888-8888-888888888888', $1, $2, 'dad', 'family_admin', 'active')`,
      [familyId, dadId],
    );

    await expect(
      database.pool.query(
        `insert into family_memberships (id, family_id, user_id, relationship, permission_level, status) values ('99999999-9999-4999-8999-999999999999', $1, $2, 'dad', 'family_admin', 'active')`,
        [familyId, otherDadId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await database.pool.query(
      `insert into sessions (id, family_id, user_id, token_hash, expires_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'same-token-hash', now() + interval '1 day')`,
      [familyId, dadId],
    );

    await expect(
      database.pool.query(
        `insert into sessions (id, family_id, user_id, token_hash, expires_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, $2, 'same-token-hash', now() + interval '1 day')`,
        [familyId, dadId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
