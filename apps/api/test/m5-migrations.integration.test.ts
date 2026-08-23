import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
let database: DatabaseContext | undefined;

const FAMILY_ID = '10000000-0000-4000-8000-000000000001';
const BABY_ID = '20000000-0000-4000-8000-000000000002';
const USER_ID = '30000000-0000-4000-8000-000000000003';
const MEMBERSHIP_ID = '40000000-0000-4000-8000-000000000004';
const OTHER_USER_ID = '31000000-0000-4000-8000-000000000013';
const OTHER_MEMBERSHIP_ID = '41000000-0000-4000-8000-000000000014';
const DEVICE_ID = '50000000-0000-4000-8000-000000000005';
const LEASE_ID = '60000000-0000-4000-8000-000000000006';
const SESSION_ID = '70000000-0000-4000-8000-000000000007';
const REQUEST_ID = '80000000-0000-4000-8000-000000000008';

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

async function migratedDatabase(): Promise<DatabaseContext> {
  const context = createDatabase(testDatabaseUrl!);
  try {
    await context.migrate();
    await context.pool.query(`truncate table
      voice_care_intent_receipts, voice_care_feeding_sessions, voice_care_leases,
      voice_care_pairing_challenges, voice_care_devices,
      care_handoff_reminder_rules, care_handoff_checkpoints, care_event_revisions, measurements,
      care_actions, sleep_intervals, diaper_events, feeding_components, feeding_sessions, care_events,
      audit_events, sessions, babies, family_memberships, users, families restart identity cascade`);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function seedOwnership(context: DatabaseContext): Promise<void> {
  await context.pool.query(
    `insert into families (id, name, timezone) values ($1, 'Synthetic Family', 'UTC')`,
    [FAMILY_ID],
  );
  await context.pool.query(
    `insert into babies (id, family_id, display_name) values ($1, $2, 'Synthetic Baby')`,
    [BABY_ID, FAMILY_ID],
  );
  await context.pool.query(
    `insert into users (id, login_name, display_name, password_hash)
     values ($1, 'synthetic-dad', 'Synthetic Dad', 'synthetic-hash'),
            ($2, 'synthetic-nanny', 'Synthetic Nanny', 'synthetic-hash')`,
    [USER_ID, OTHER_USER_ID],
  );
  await context.pool.query(
    `insert into family_memberships
      (id, family_id, user_id, relationship, permission_level)
     values ($1, $3, $4, 'dad', 'family_admin'),
            ($2, $3, $5, 'nanny', 'caregiver')`,
    [MEMBERSHIP_ID, OTHER_MEMBERSHIP_ID, FAMILY_ID, USER_ID, OTHER_USER_ID],
  );
}

async function seedDevice(context: DatabaseContext): Promise<void> {
  await context.pool.query(
    `insert into voice_care_devices (id, family_id, public_key, capability, status)
     values ($1, $2, decode(repeat('aa', 32), 'hex'), 'voice_care.intent.submit', 'active')`,
    [DEVICE_ID, FAMILY_ID],
  );
}

async function seedLease(context: DatabaseContext): Promise<void> {
  await context.pool.query(
    `insert into voice_care_leases
      (id, family_id, baby_id, device_id, actor_user_id, actor_membership_id,
       client_request_id, issued_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, '2026-08-23T08:00:00Z', '2026-08-23T16:00:00Z')`,
    [LEASE_ID, FAMILY_ID, BABY_ID, DEVICE_ID, USER_ID, MEMBERSHIP_ID, REQUEST_ID],
  );
}

describeDatabase('M5 Voice Care migrations', () => {
  it('creates the five M5 tables and adds the closed voice care source', async () => {
    database = await migratedDatabase();
    const names = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    expect(new Set(names.rows.map((row) => row.table_name))).toEqual(expect.objectContaining({
      size: expect.any(Number),
    }));
    for (const expected of [
      'voice_care_devices',
      'voice_care_pairing_challenges',
      'voice_care_leases',
      'voice_care_intent_receipts',
      'voice_care_feeding_sessions',
    ]) {
      expect(names.rows.some((row) => row.table_name === expected), `missing table ${expected}`).toBe(true);
    }
    const labels = await database.pool.query<{ enumlabel: string }>(
      `select enumlabel from pg_enum where enumtypid = 'care_source'::regtype order by enumsortorder`,
    );
    expect(labels.rows.map((row) => row.enumlabel)).toContain('voice');
  });

  it('enforces device key shape, fixed capability/status and coherent revocation', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    await expect(database.pool.query(
      `insert into voice_care_devices (family_id, public_key, capability, status)
       values ($1, decode('aa', 'hex'), 'voice_care.intent.submit', 'active')`,
      [FAMILY_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into voice_care_devices (family_id, public_key, capability, status)
       values ($1, decode(repeat('aa', 32), 'hex'), 'voice_care.admin', 'active')`,
      [FAMILY_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into voice_care_devices (family_id, public_key, capability, status, revoked_at)
       values ($1, decode(repeat('bb', 32), 'hex'), 'voice_care.intent.submit', 'active', now())`,
      [FAMILY_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await seedDevice(database);
    await expect(seedDevice(database)).rejects.toMatchObject({ code: '23505' });
  });

  it('bounds one-time pairing challenges to five minutes and coherent consumption', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    await seedDevice(database);
    await expect(database.pool.query(
      `insert into voice_care_pairing_challenges
        (family_id, created_by_user_id, created_by_membership_id, challenge_digest,
         created_at, expires_at)
       values ($1, $2, $3, decode('cc', 'hex'),
         '2026-08-23T08:00:00Z', '2026-08-23T08:05:00Z')`,
      [FAMILY_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into voice_care_pairing_challenges
        (family_id, created_by_user_id, created_by_membership_id, challenge_digest,
         created_at, expires_at)
       values ($1, $2, $3, decode(repeat('cc', 32), 'hex'),
         '2026-08-23T08:00:00Z', '2026-08-23T08:05:01Z')`,
      [FAMILY_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into voice_care_pairing_challenges
        (family_id, created_by_user_id, created_by_membership_id, challenge_digest,
         created_at, expires_at, consumed_at)
       values ($1, $2, $3, decode(repeat('dd', 32), 'hex'),
         '2026-08-23T08:00:00Z', '2026-08-23T08:05:00Z', '2026-08-23T08:01:00Z')`,
      [FAMILY_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await database.pool.query(
      `insert into voice_care_pairing_challenges
        (family_id, created_by_user_id, created_by_membership_id, challenge_digest,
         created_at, expires_at, consumed_at, consumed_by_device_id)
       values ($1, $2, $3, decode(repeat('ee', 32), 'hex'),
         '2026-08-23T08:00:00Z', '2026-08-23T08:05:00Z', '2026-08-23T08:01:00Z', $4)`,
      [FAMILY_ID, USER_ID, MEMBERSHIP_ID, DEVICE_ID],
    );
  });

  it('binds leases to family ownership and permits only one unrevoked device lease', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    await seedDevice(database);
    await seedLease(database);
    await expect(database.pool.query(
      `insert into voice_care_leases
        (family_id, baby_id, device_id, actor_user_id, actor_membership_id,
         client_request_id, issued_at, expires_at)
       values ($1, $2, $3, $4, $5, '90000000-0000-4000-8000-000000000009',
         '2026-08-23T08:01:00Z', '2026-08-23T16:01:00Z')`,
      [FAMILY_ID, BABY_ID, DEVICE_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23505', constraint: 'voice_care_leases_one_active_device_idx' });
    await database.pool.query(`update voice_care_leases set revoked_at = '2026-08-23T09:00:00Z' where id = $1`, [LEASE_ID]);
    await expect(database.pool.query(
      `insert into voice_care_leases
        (family_id, baby_id, device_id, actor_user_id, actor_membership_id,
         client_request_id, issued_at, expires_at)
       values ($1, $2, $3, $4, $5, '91000000-0000-4000-8000-000000000019',
         '2026-08-23T09:00:00Z', '2026-08-23T17:00:00Z')`,
      [FAMILY_ID, BABY_ID, DEVICE_ID, USER_ID, OTHER_MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23503', constraint: 'voice_care_leases_actor_membership_fk' });
    await expect(database.pool.query(
      `insert into voice_care_leases
        (family_id, baby_id, device_id, actor_user_id, actor_membership_id,
         client_request_id, issued_at, expires_at)
       values ($1, $2, 'a0000000-0000-4000-8000-00000000000a', $3, $4,
         'b0000000-0000-4000-8000-00000000000b',
         '2026-08-23T09:00:00Z', '2026-08-23T17:00:00Z')`,
      [FAMILY_ID, BABY_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23503', constraint: 'voice_care_leases_family_device_fk' });
  });

  it('enforces receipt digests and legal session ownership/state combinations', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    await seedDevice(database);
    await seedLease(database);
    await expect(database.pool.query(
      `insert into voice_care_intent_receipts
        (family_id, device_id, request_id, request_digest, result_json)
       values ($1, $2, $3, decode('aa', 'hex'), '{}'::jsonb)`,
      [FAMILY_ID, DEVICE_ID, REQUEST_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await database.pool.query(
      `insert into voice_care_intent_receipts
        (family_id, device_id, request_id, request_digest, result_json)
       values ($1, $2, $3, decode(repeat('aa', 32), 'hex'), '{"code":"rejected"}'::jsonb)`,
      [FAMILY_ID, DEVICE_ID, REQUEST_ID],
    );
    await expect(database.pool.query(
      `insert into voice_care_intent_receipts
        (family_id, device_id, request_id, request_digest, result_json)
       values ($1, $2, $3, decode(repeat('bb', 32), 'hex'), '{"code":"rejected"}'::jsonb)`,
      [FAMILY_ID, DEVICE_ID, REQUEST_ID],
    )).rejects.toMatchObject({ code: '23505', constraint: 'voice_care_intent_receipts_device_request_idx' });
    await expect(database.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, started_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', '{}'::jsonb, 0,
         '2026-08-23T08:00:00Z', '2026-08-23T14:00:00Z')`,
      [SESSION_ID, FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, USER_ID, MEMBERSHIP_ID, REQUEST_ID],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(database.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, proposal_digest,
         started_at, expires_at, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'committed', '{}'::jsonb, 1,
         decode(repeat('aa', 32), 'hex'), '2026-08-23T08:00:00Z',
         '2026-08-23T14:00:00Z', '2026-08-23T09:00:00Z')`,
      [SESSION_ID, FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, USER_ID, MEMBERSHIP_ID, REQUEST_ID],
    )).rejects.toMatchObject({ code: '23514', constraint: 'voice_care_feeding_sessions_state_shape' });
    await expect(database.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, started_at, expires_at)
       values ('71000000-0000-4000-8000-000000000017', $1, $2, $3, $4, $5, $6,
         '81000000-0000-4000-8000-000000000018', 'cancelled', '{}'::jsonb, 1,
         '2026-08-23T08:00:00Z', '2026-08-23T14:00:00Z')`,
      [FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, USER_ID, MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23514', constraint: 'voice_care_feeding_sessions_state_shape' });
    await expect(database.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, started_at, expires_at)
       values ('72000000-0000-4000-8000-000000000027', $1, $2, $3, $4, $5, $6,
         '82000000-0000-4000-8000-000000000028', 'pending', '{}'::jsonb, 1,
         '2026-08-23T08:00:00Z', '2026-08-23T14:00:00Z')`,
      [FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, OTHER_USER_ID, OTHER_MEMBERSHIP_ID],
    )).rejects.toMatchObject({ code: '23503', constraint: 'voice_care_feeding_sessions_lease_owner_fk' });
    await database.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, started_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', '{}'::jsonb, 1,
         '2026-08-23T08:00:00Z', '2026-08-23T14:00:00Z')`,
      [SESSION_ID, FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, USER_ID, MEMBERSHIP_ID, REQUEST_ID],
    );
  });

  it('links one committed Voice Care session to one family-owned final care event', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    await seedDevice(database);
    await seedLease(database);
    const finalEventId = 'a1000000-0000-4000-8000-000000000001';
    await database.pool.query(
      `insert into care_events
        (id, family_id, baby_id, actor_user_id, actor_membership_id, source,
         event_type, occurred_at, client_request_id, trace_id)
       values ($1, $2, $3, $4, $5, 'voice', 'feeding', '2026-08-23T09:00:00Z',
         'a2000000-0000-4000-8000-000000000002', 'synthetic-trace')`,
      [finalEventId, FAMILY_ID, BABY_ID, USER_ID, MEMBERSHIP_ID],
    );
    const insertCommitted = (sessionId: string, startRequestId: string) => database!.pool.query(
      `insert into voice_care_feeding_sessions
        (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
         start_request_id, state, proposal_json, version, proposal_digest,
         final_care_event_id, started_at, expires_at, ended_at, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'committed', '{}'::jsonb, 2,
         decode(repeat('aa', 32), 'hex'), $9, '2026-08-23T08:00:00Z',
         '2026-08-23T14:00:00Z', '2026-08-23T09:00:00Z', '2026-08-23T09:01:00Z')`,
      [sessionId, FAMILY_ID, BABY_ID, DEVICE_ID, LEASE_ID, USER_ID, MEMBERSHIP_ID, startRequestId, finalEventId],
    );
    await insertCommitted(SESSION_ID, 'a3000000-0000-4000-8000-000000000003');
    await expect(insertCommitted(
      'a4000000-0000-4000-8000-000000000004',
      'a5000000-0000-4000-8000-000000000005',
    )).rejects.toMatchObject({ code: '23505', constraint: 'voice_care_feeding_sessions_final_event_idx' });
  });

  it('requires server-owned actor provenance for manual and voice care/checkpoint rows', async () => {
    database = await migratedDatabase();
    await seedOwnership(database);
    for (const source of ['manual', 'voice']) {
      await expect(database.pool.query(
        `insert into care_events
          (family_id, baby_id, source, event_type, occurred_at, trace_id)
         values ($1, $2, $3, 'burping', now(), 'synthetic-trace')`,
        [FAMILY_ID, BABY_ID, source],
      )).rejects.toMatchObject({ code: '23514', constraint: 'care_events_manual_actor_required' });
      await expect(database.pool.query(
        `insert into care_handoff_checkpoints
          (family_id, baby_id, source, occurred_at, trace_id)
         values ($1, $2, $3, now(), 'synthetic-trace')`,
        [FAMILY_ID, BABY_ID, source],
      )).rejects.toMatchObject({ code: '23514', constraint: 'care_handoff_checkpoints_manual_actor_required' });
      await database.pool.query(
        `insert into care_handoff_checkpoints
          (family_id, baby_id, actor_user_id, actor_membership_id, source,
           occurred_at, client_request_id, trace_id)
         values ($1, $2, $3, $4, $5, now(), $6, 'synthetic-trace')`,
        [FAMILY_ID, BABY_ID, USER_ID, MEMBERSHIP_ID, source, crypto.randomUUID()],
      );
    }
  });
});
