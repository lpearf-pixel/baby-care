import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import type { CareActorContext } from '../src/care/care-auth.js';
import { findActiveVoiceCareLease } from '../src/voice-care/lease-repository.js';
import { createVoiceCareLeaseService } from '../src/voice-care/lease-service.js';
import { createM2TestApp, M2_TEST_ORIGIN, M2_TEST_NOW } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;
let context: TestContext | undefined;

afterEach(async () => {
  if (context) {
    await context.app.close();
    await context.database.close();
    context = undefined;
  }
});

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const cookie = header.split(';', 1)[0];
  if (!cookie) throw new Error('expected session cookie pair');
  return cookie;
}

async function login(loginName: string, password: string): Promise<string> {
  const response = await context!.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: M2_TEST_ORIGIN },
    payload: { loginName, password },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response as unknown as { headers: Record<string, unknown> });
}

async function createNanny(): Promise<string> {
  const created = await context!.app.inject({
    method: 'POST',
    url: '/api/family/members',
    headers: { origin: M2_TEST_ORIGIN, cookie: context!.cookie },
    payload: { loginName: 'voice-lease-nanny', displayName: 'Nanny', password: 'nanny-test-password' },
  });
  expect(created.statusCode).toBe(201);
  return login('voice-lease-nanny', 'nanny-test-password');
}

async function actor(loginName: string): Promise<CareActorContext> {
  const result = await context!.database.pool.query<{
    user_id: string;
    membership_id: string;
    family_id: string;
    baby_id: string;
    relationship: 'dad' | 'mom' | 'nanny';
    permission_level: 'family_admin' | 'caregiver';
  }>(
    `select u.id user_id, fm.id membership_id, fm.family_id, b.id baby_id,
            fm.relationship, fm.permission_level
       from users u
       join family_memberships fm on fm.user_id = u.id
       join babies b on b.family_id = fm.family_id
      where u.login_name = $1`,
    [loginName],
  );
  const row = result.rows[0];
  if (!row) throw new Error('expected synthetic actor');
  return {
    userId: row.user_id,
    membershipId: row.membership_id,
    familyId: row.family_id,
    babyId: row.baby_id,
    relationship: row.relationship,
    permissionLevel: row.permission_level,
  };
}

async function insertDevice(): Promise<string> {
  const owner = await actor('dad');
  const deviceId = randomUUID();
  await context!.database.pool.query(
    `insert into voice_care_devices
      (id, family_id, public_key, capability, status, created_at)
     values ($1,$2,$3,'voice_care.intent.submit','active',$4)`,
    [deviceId, owner.familyId, Buffer.from(randomUUID().replaceAll('-', '').padEnd(64, '0'), 'hex'), M2_TEST_NOW],
  );
  return deviceId;
}

function activate(cookie: string, deviceId: string, clientRequestId = randomUUID()) {
  return context!.app.inject({
    method: 'POST',
    url: `/api/voice-care/devices/${deviceId}/leases`,
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload: { clientRequestId, occurredAt: M2_TEST_NOW.toISOString() },
  });
}

function revoke(cookie: string, leaseId: string) {
  return context!.app.inject({
    method: 'DELETE',
    url: `/api/voice-care/leases/${leaseId}`,
    headers: { origin: M2_TEST_ORIGIN, cookie },
  });
}

describeDatabase('M5 Voice Care caregiver leases', () => {
  it('atomically activates one eight-hour lease and voice handoff without a reusable credential', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const deviceId = await insertDevice();
    const clientRequestId = randomUUID();
    const response = await activate(context.cookie, deviceId, clientRequestId);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      deviceId,
      issuedAt: '2026-08-13T08:00:00.000Z',
      expiresAt: '2026-08-13T16:00:00.000Z',
      revokedAt: null,
      actorDisplayName: 'Dad',
    });
    expect(Object.keys(response.json()).sort()).toEqual([
      'actorDisplayName', 'actorUserId', 'deviceId', 'expiresAt', 'id', 'issuedAt', 'revokedAt',
    ]);
    const replay = await activate(context.cookie, deviceId, clientRequestId);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(response.json());

    const persisted = await context.database.pool.query<{
      lease_count: number;
      handoff_count: number;
      source: string;
    }>(
      `select
         (select count(*)::int from voice_care_leases where client_request_id = $1) lease_count,
         (select count(*)::int from care_handoff_checkpoints where client_request_id = $1) handoff_count,
         (select source::text from care_handoff_checkpoints where client_request_id = $1) source`,
      [clientRequestId],
    );
    expect(persisted.rows[0]).toEqual({ lease_count: 1, handoff_count: 1, source: 'voice' });
    const audits = await context.database.pool.query<{
      action: string;
      metadata_json: Record<string, unknown> | null;
    }>(
      `select action, metadata_json from audit_events
        where action in ('care.handoff_created', 'voice_care.lease_activated')
        order by action`,
    );
    expect(audits.rows).toEqual([
      {
        action: 'care.handoff_created',
        metadata_json: {
          checkpointId: expect.any(String),
          source: 'voice',
          traceId: expect.any(String),
        },
      },
      {
        action: 'voice_care.lease_activated',
        metadata_json: {
          checkpointId: expect.any(String),
          deviceId,
        },
      },
    ]);
  });

  it('serializes replacement leases and leaves one active family/device lease', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const deviceId = await insertDevice();
    const momCookie = await login('mom', 'mom-test-password');
    const [dadResponse, momResponse] = await Promise.all([
      activate(context.cookie, deviceId),
      activate(momCookie, deviceId),
    ]);
    expect([dadResponse.statusCode, momResponse.statusCode]).toEqual([201, 201]);
    const rows = await context.database.pool.query<{ active: number; revoked: number; handoffs: number }>(
      `select
         count(*) filter (where revoked_at is null)::int active,
         count(*) filter (where revoked_at is not null)::int revoked,
         (select count(*)::int from care_handoff_checkpoints where source::text = 'voice') handoffs
       from voice_care_leases where device_id = $1`,
      [deviceId],
    );
    expect(rows.rows[0]).toEqual({ active: 1, revoked: 1, handoffs: 2 });
  });

  it('allows Nanny to activate and revoke only their own lease while Dad may revoke any family lease', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const firstDevice = await insertDevice();
    const secondDevice = await insertDevice();
    const nannyCookie = await createNanny();
    const nannyState = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/state',
      headers: { cookie: nannyCookie },
    });
    expect(nannyState.statusCode).toBe(200);
    expect(nannyState.json().devices.map((device: { id: string }) => device.id).sort())
      .toEqual([firstDevice, secondDevice].sort());
    expect(nannyState.body).not.toMatch(/publicKey|signature|challenge/);
    const dadLease = await activate(context.cookie, firstDevice);
    expect(dadLease.statusCode).toBe(201);
    const nannyStateWithDadLease = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/state',
      headers: { cookie: nannyCookie },
    });
    expect(nannyStateWithDadLease.statusCode).toBe(200);
    expect(nannyStateWithDadLease.json().activeLeases).toEqual([
      expect.objectContaining({
        id: dadLease.json().id,
        actorDisplayName: 'Dad',
        revokedAt: null,
      }),
    ]);
    const denied = await revoke(nannyCookie, dadLease.json().id as string);
    expect(denied.statusCode).toBe(403);

    const nannyLease = await activate(nannyCookie, secondDevice);
    expect(nannyLease.statusCode).toBe(201);
    const nannyLeaseId = nannyLease.json().id as string;
    expect((await revoke(nannyCookie, nannyLeaseId)).statusCode).toBe(204);
    expect((await revoke(nannyCookie, nannyLeaseId)).statusCode).toBe(204);
    const revokeAudits = await context.database.pool.query<{ count: number }>(
      `select count(*)::int count from audit_events
        where action = 'voice_care.lease_revoked' and target_id = $1`,
      [nannyLeaseId],
    );
    expect(revokeAudits.rows[0]?.count).toBe(1);
    const replacement = await activate(nannyCookie, secondDevice);
    expect(replacement.statusCode).toBe(201);
    expect((await revoke(context.cookie, replacement.json().id as string)).statusCode).toBe(204);
  });

  it('treats expired, disabled, revoked and cross-family authority as inactive', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const deviceId = await insertDevice();
    const dad = await actor('dad');
    const created = await activate(context.cookie, deviceId);
    expect(created.statusCode).toBe(201);
    await context.database.pool.query(
      `update voice_care_leases
          set issued_at = $2::timestamptz - interval '2 hours',
              expires_at = $2::timestamptz - interval '1 hour'
        where id = $1`,
      [created.json().id, M2_TEST_NOW],
    );
    expect(await findActiveVoiceCareLease(context.database.pool, dad.familyId, deviceId, M2_TEST_NOW)).toBeNull();

    await context.database.pool.query(
      `update family_memberships set status = 'disabled' where id = $1`,
      [dad.membershipId],
    );
    await expect(
      createVoiceCareLeaseService(context.database, () => M2_TEST_NOW)
        .activate(dad, deviceId, { clientRequestId: randomUUID(), occurredAt: M2_TEST_NOW.toISOString() }, 'trace-disabled'),
    ).rejects.toMatchObject({ name: 'VoiceCareForbiddenError' });
    await context.database.pool.query(
      `update family_memberships set status = 'active' where id = $1`,
      [dad.membershipId],
    );
    await context.database.pool.query(
      `update voice_care_devices set status = 'revoked', revoked_at = $2 where id = $1`,
      [deviceId, M2_TEST_NOW],
    );
    expect((await activate(context.cookie, deviceId)).statusCode).toBe(404);

    const foreignActor = { ...dad, familyId: randomUUID() };
    await expect(
      createVoiceCareLeaseService(context.database, () => M2_TEST_NOW)
        .activate(foreignActor, deviceId, { clientRequestId: randomUUID(), occurredAt: M2_TEST_NOW.toISOString() }, 'trace-foreign'),
    ).rejects.toMatchObject({ name: 'VoiceCareNotFoundError' });
  });

  it('rolls back lease replacement when the atomic handoff cannot be inserted', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const deviceId = await insertDevice();
    const clientRequestId = randomUUID();
    const manual = await context.app.inject({
      method: 'POST',
      url: '/api/care/handoffs',
      headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      payload: { clientRequestId, occurredAt: M2_TEST_NOW.toISOString() },
    });
    expect(manual.statusCode).toBe(201);
    const response = await activate(context.cookie, deviceId, clientRequestId);
    expect(response.statusCode).toBe(409);
    const leases = await context.database.pool.query<{ count: number }>(
      `select count(*)::int count from voice_care_leases where device_id = $1`,
      [deviceId],
    );
    expect(leases.rows[0]?.count).toBe(0);
  });

  it('preserves the existing handoff future-skew validation contract', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const deviceId = await insertDevice();
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/voice-care/devices/${deviceId}/leases`,
      headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      payload: { clientRequestId: randomUUID(), occurredAt: '2026-08-13T08:05:00.001Z' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
  });
});
