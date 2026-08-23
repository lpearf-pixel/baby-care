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
  await context.pool.query(`truncate table
    care_handoff_reminder_rules, care_handoff_checkpoints, care_event_revisions, measurements,
    care_actions, sleep_intervals, diaper_events, feeding_components, feeding_sessions, care_events,
    audit_events, sessions, babies, family_memberships, users, families restart identity cascade`);
  return context;
}

async function seedOwnership(context: DatabaseContext) {
  const familyA = '10000000-0000-4000-8000-000000000001';
  const babyA = '30000000-0000-4000-8000-000000000003';
  const missingBaby = '40000000-0000-4000-8000-000000000004';
  const userA = '50000000-0000-4000-8000-000000000005';
  const membershipA = '60000000-0000-4000-8000-000000000006';
  const userB = '70000000-0000-4000-8000-000000000007';
  const membershipB = '80000000-0000-4000-8000-000000000008';
  await context.pool.query(
    `insert into families (id, name, timezone) values ($1, 'A', 'Asia/Shanghai')`,
    [familyA],
  );
  await context.pool.query(
    `insert into babies (id, family_id, display_name) values ($1, $2, 'a')`,
    [babyA, familyA],
  );
  await context.pool.query(
    `insert into users (id, login_name, display_name, password_hash)
     values ($1, 'dad', 'Dad', 'hash'), ($2, 'mom', 'Mom', 'hash')`,
    [userA, userB],
  );
  await context.pool.query(
    `insert into family_memberships (id, family_id, user_id, relationship, permission_level)
     values ($1, $2, $3, 'dad', 'family_admin'), ($4, $2, $5, 'mom', 'family_admin')`,
    [membershipA, familyA, userA, membershipB, userB],
  );
  return { familyA, babyA, missingBaby, userA, membershipA, userB, membershipB };
}

describeDatabase('M3 care workspace migrations', () => {
  it('migrates an empty database through the M3 handoff tables', async () => {
    database = await migratedDatabase();

    const result = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = new Set(result.rows.map((row) => row.table_name));
    expect(tables.has('care_handoff_checkpoints')).toBe(true);
    expect(tables.has('care_handoff_reminder_rules')).toBe(true);

    const revisionColumns = await database.pool.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'care_event_revisions'
          and column_name in ('from_version', 'to_version')
        order by column_name`,
    );
    expect(revisionColumns.rows).toEqual([
      { column_name: 'from_version', is_nullable: 'NO' },
      { column_name: 'to_version', is_nullable: 'NO' },
    ]);
  });

  it('rejects mismatched family/baby and membership/user identities for checkpoints', async () => {
    database = await migratedDatabase();
    const ids = await seedOwnership(database);

    await expect(database.pool.query(
      `insert into care_handoff_checkpoints
        (family_id, baby_id, actor_user_id, actor_membership_id, source, occurred_at, client_request_id, trace_id)
       values ($1, $2, $3, $4, 'manual', now(), '70000000-0000-4000-8000-000000000007', 'trace')`,
      [ids.familyA, ids.missingBaby, ids.userA, ids.membershipA],
    )).rejects.toMatchObject({ code: '23503', constraint: 'care_handoff_checkpoints_family_baby_fk' });

    await expect(database.pool.query(
      `insert into care_handoff_checkpoints
        (family_id, baby_id, actor_user_id, actor_membership_id, source, occurred_at, client_request_id, trace_id)
       values ($1, $2, $3, $4, 'manual', now(), '80000000-0000-4000-8000-000000000008', 'trace')`,
      [ids.familyA, ids.babyA, ids.userA, ids.membershipB],
    )).rejects.toMatchObject({ code: '23503', constraint: 'care_handoff_checkpoints_actor_membership_fk' });
  });

  it('enforces checkpoint idempotency and reminder bounds while preserving a valid local time', async () => {
    database = await migratedDatabase();
    const ids = await seedOwnership(database);
    const checkpoint = [
      ids.familyA, ids.babyA, ids.userA, ids.membershipA, '90000000-0000-4000-8000-000000000009',
    ];
    await database.pool.query(
      `insert into care_handoff_checkpoints
        (family_id, baby_id, actor_user_id, actor_membership_id, source, occurred_at, client_request_id, trace_id)
       values ($1, $2, $3, $4, 'manual', now(), $5, 'trace')`,
      checkpoint,
    );
    await expect(database.pool.query(
      `insert into care_handoff_checkpoints
        (family_id, baby_id, actor_user_id, actor_membership_id, source, occurred_at, client_request_id, trace_id)
       values ($1, $2, $3, $4, 'manual', now(), $5, 'trace')`,
      checkpoint,
    )).rejects.toMatchObject({ code: '23505' });

    const reminder = [ids.familyA, ids.babyA, ids.userA, ids.membershipA];
    await expect(database.pool.query(
      `insert into care_handoff_reminder_rules
        (family_id, baby_id, actor_user_id, actor_membership_id, local_time, weekday_mask, enabled)
       values ($1, $2, $3, $4, '08:30', 0, true)`,
      reminder,
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into care_handoff_reminder_rules
        (family_id, baby_id, actor_user_id, actor_membership_id, local_time, weekday_mask, enabled)
       values ($1, $2, $3, $4, '08:30', 128, true)`,
      reminder,
    )).rejects.toMatchObject({ code: '23514' });
    const stored = await database.pool.query<{ local_time: string }>(
      `insert into care_handoff_reminder_rules
        (family_id, baby_id, actor_user_id, actor_membership_id, local_time, weekday_mask, enabled)
       values ($1, $2, $3, $4, '08:30', 31, true)
       returning local_time`,
      reminder,
    );
    expect(stored.rows).toEqual([{ local_time: '08:30' }]);
  });
});
