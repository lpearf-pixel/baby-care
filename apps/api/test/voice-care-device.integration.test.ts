import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type PairVoiceCareDeviceInput,
  type VoiceCarePairingChallengeDto,
  voiceCarePairingSigningBytesV1,
} from '@baby-care/contracts';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

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

function rawPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64url');
}

function signedPairing(
  challenge: VoiceCarePairingChallengeDto,
  deviceId: string,
  keyPair = generateKeyPairSync('ed25519'),
): { input: PairVoiceCareDeviceInput; keyPair: ReturnType<typeof generateKeyPairSync> } {
  const unsigned = {
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    deviceId,
    publicKey: rawPublicKey(keyPair.publicKey),
  };
  return {
    input: {
      ...unsigned,
      signature: sign(null, voiceCarePairingSigningBytesV1(unsigned), keyPair.privateKey).toString('base64url'),
    },
    keyPair,
  };
}

async function challenge(cookie: string) {
  const response = await context!.app.inject({
    method: 'POST',
    url: '/api/voice-care/pairing-challenges',
    headers: { origin: M2_TEST_ORIGIN, cookie },
  });
  return { response, body: response.json() as VoiceCarePairingChallengeDto };
}

async function pair(cookie: string, input: PairVoiceCareDeviceInput) {
  return context!.app.inject({
    method: 'POST',
    url: '/api/voice-care/devices',
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload: input,
  });
}

async function createNanny(): Promise<string> {
  const created = await context!.app.inject({
    method: 'POST',
    url: '/api/family/members',
    headers: { origin: M2_TEST_ORIGIN, cookie: context!.cookie },
    payload: { loginName: 'voice-nanny', displayName: 'Synthetic Nanny', password: 'voice-nanny-test-password' },
  });
  expect(created.statusCode).toBe(201);
  const login = await context!.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: M2_TEST_ORIGIN },
    payload: { loginName: 'voice-nanny', password: 'voice-nanny-test-password' },
  });
  expect(login.statusCode).toBe(200);
  const header = login.headers['set-cookie'];
  if (typeof header !== 'string') throw new Error('expected nanny cookie');
  const cookie = header.split(';', 1)[0];
  if (!cookie) throw new Error('expected nanny cookie pair');
  return cookie;
}

describeDatabase('M5 Voice Care device pairing', () => {
  it('pairs one generated Ed25519 key, closes replay and exposes no security bytes', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const issued = await challenge(context.cookie);
    expect(issued.response.statusCode).toBe(201);
    const pairing = signedPairing(issued.body, randomUUID());

    const created = await pair(context.cookie, pairing.input);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: pairing.input.deviceId,
      capability: 'voice_care.intent.submit',
      status: 'active',
      revokedAt: null,
    });
    expect(created.json()).not.toHaveProperty('publicKey');
    expect((await pair(context.cookie, pairing.input)).statusCode).toBe(409);

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/devices',
      headers: { cookie: context.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([created.json()]);
    expect(JSON.stringify(list.json())).not.toContain(pairing.input.publicKey);
    expect(JSON.stringify(list.json())).not.toContain(pairing.input.signature);
    expect(JSON.stringify(list.json())).not.toContain(issued.body.challenge);

    const challengeRow = await context.database.pool.query<{ challenge_digest: Buffer }>(
      `select challenge_digest from voice_care_pairing_challenges where id = $1`,
      [issued.body.challengeId],
    );
    expect(challengeRow.rows[0]?.challenge_digest.equals(Buffer.from(issued.body.challenge, 'base64url'))).toBe(false);
    const audits = await context.database.pool.query<{ metadata_json: Record<string, unknown> | null }>(
      `select metadata_json from audit_events where action = 'voice_care.device_paired'`,
    );
    expect(audits.rows).toEqual([{ metadata_json: { capability: 'voice_care.intent.submit' } }]);

    const foreignFamilyId = randomUUID();
    const foreignDeviceId = randomUUID();
    await context.database.pool.query('drop index if exists families_single_active_idx');
    try {
      await context.database.pool.query(
        `insert into families (id, name, timezone)
         values ($1, 'Synthetic Foreign Family', 'UTC')`,
        [foreignFamilyId],
      );
      await context.database.pool.query(
        `insert into voice_care_devices
          (id, family_id, public_key, capability, status, created_at)
         values ($1,$2,$3,'voice_care.intent.submit','active','2026-08-13T08:00:00Z')`,
        [foreignDeviceId, foreignFamilyId, Buffer.alloc(32, 7)],
      );
      const isolatedList = await context.app.inject({
        method: 'GET',
        url: '/api/voice-care/devices',
        headers: { cookie: context.cookie },
      });
      expect(isolatedList.json()).toEqual([created.json()]);
      const foreignRevoke = await context.app.inject({
        method: 'DELETE',
        url: `/api/voice-care/devices/${foreignDeviceId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      });
      expect(foreignRevoke.statusCode).toBe(404);
    } finally {
      await context.database.pool.query(`delete from voice_care_devices where id = $1`, [foreignDeviceId]);
      await context.database.pool.query(`delete from families where id = $1`, [foreignFamilyId]);
      await context.database.pool.query(
        `create unique index if not exists families_single_active_idx
           on families ((1)) where status = 'active'`,
      );
    }
  });

  it('rejects expired, unknown, malformed and wrongly signed pairing inputs', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const issued = await challenge(context.cookie);
    const valid = signedPairing(issued.body, randomUUID());
    await context.database.pool.query(
      `update voice_care_pairing_challenges
          set created_at = created_at - interval '6 minutes',
              expires_at = expires_at - interval '6 minutes'
        where id = $1`,
      [issued.body.challengeId],
    );
    expect((await pair(context.cookie, valid.input)).json()).toMatchObject({ code: 'voice_care_pairing_invalid' });

    const unknown = signedPairing({ ...issued.body, challengeId: randomUUID() }, randomUUID());
    expect((await pair(context.cookie, unknown.input)).json()).toMatchObject({ code: 'voice_care_pairing_invalid' });

    const fresh = await challenge(context.cookie);
    const wrong = signedPairing(fresh.body, randomUUID());
    wrong.input.signature = Buffer.alloc(64).toString('base64url');
    expect((await pair(context.cookie, wrong.input)).json()).toMatchObject({ code: 'voice_care_pairing_invalid' });

    const malformed = await context.app.inject({
      method: 'POST',
      url: '/api/voice-care/devices',
      headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      payload: { ...wrong.input, publicKey: 'invalid' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects duplicate keys and revokes a device with every unrevoked lease idempotently', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const firstChallenge = await challenge(context.cookie);
    const first = signedPairing(firstChallenge.body, randomUUID());
    expect((await pair(context.cookie, first.input)).statusCode).toBe(201);

    const secondChallenge = await challenge(context.cookie);
    const duplicateKey = signedPairing(secondChallenge.body, randomUUID(), first.keyPair);
    const duplicate = await pair(context.cookie, duplicateKey.input);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'voice_care_state_conflict' });

    const owner = await context.database.pool.query<{
      family_id: string;
      baby_id: string;
      user_id: string;
      membership_id: string;
    }>(
      `select f.id family_id, b.id baby_id, u.id user_id, fm.id membership_id
         from families f join babies b on b.family_id = f.id
         join family_memberships fm on fm.family_id = f.id and fm.relationship = 'dad'
         join users u on u.id = fm.user_id`,
    );
    const row = owner.rows[0]!;
    const leaseId = randomUUID();
    await context.database.pool.query(
      `insert into voice_care_leases
        (id, family_id, baby_id, device_id, actor_user_id, actor_membership_id,
         client_request_id, issued_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,'2026-08-13T08:00:00Z','2026-08-13T16:00:00Z')`,
      [leaseId, row.family_id, row.baby_id, first.input.deviceId, row.user_id, row.membership_id, randomUUID()],
    );

    const revoke = () => context!.app.inject({
      method: 'DELETE',
      url: `/api/voice-care/devices/${first.input.deviceId}`,
      headers: { origin: M2_TEST_ORIGIN, cookie: context!.cookie },
    });
    const firstRevoke = await revoke();
    expect(firstRevoke.statusCode).toBe(200);
    expect(firstRevoke.json()).toMatchObject({ status: 'revoked', revokedAt: expect.any(String) });
    const secondRevoke = await revoke();
    expect(secondRevoke.statusCode).toBe(200);
    expect(secondRevoke.json()).toEqual(firstRevoke.json());
    const lease = await context.database.pool.query<{ revoked_at: Date | null }>(
      `select revoked_at from voice_care_leases where id = $1`,
      [leaseId],
    );
    expect(lease.rows[0]?.revoked_at?.toISOString()).toBe('2026-08-13T08:00:00.000Z');
    const auditCount = await context.database.pool.query<{ count: number }>(
      `select count(*)::int count from audit_events where action = 'voice_care.device_revoked'`,
    );
    expect(auditCount.rows[0]?.count).toBe(1);
  });

  it('requires an exact browser origin/session and denies Nanny pairing or revocation', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const noSession = await context.app.inject({
      method: 'POST',
      url: '/api/voice-care/pairing-challenges',
      headers: { origin: M2_TEST_ORIGIN },
    });
    expect(noSession.statusCode).toBe(401);
    const wrongOrigin = await context.app.inject({
      method: 'POST',
      url: '/api/voice-care/pairing-challenges',
      headers: { origin: 'http://127.0.0.1:8081', cookie: context.cookie },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toMatchObject({ code: 'origin_not_allowed' });

    const nannyCookie = await createNanny();
    const nannyChallenge = await challenge(nannyCookie);
    expect(nannyChallenge.response.statusCode).toBe(403);
    expect(nannyChallenge.response.json()).toMatchObject({ code: 'forbidden' });
    const nannyRevoke = await context.app.inject({
      method: 'DELETE',
      url: `/api/voice-care/devices/${randomUUID()}`,
      headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
    });
    expect(nannyRevoke.statusCode).toBe(403);
    expect(nannyRevoke.json()).toMatchObject({ code: 'forbidden' });
    const nannyList = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/devices',
      headers: { cookie: nannyCookie },
    });
    expect(nannyList.statusCode).toBe(403);
    expect(nannyList.json()).toMatchObject({ code: 'forbidden' });
  });
});
