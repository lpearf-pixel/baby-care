import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import {
  VoiceCareIntentV1Schema,
  voiceCareSigningBytesV1,
  type VoiceCareIntentV1,
} from '@baby-care/contracts';
import { M2_TEST_NOW, type createM2TestApp } from './m2-family-app.js';

type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;
const PLACEHOLDER_SIGNATURE = Buffer.alloc(64).toString('base64url');

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function rawPublicKey(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

export interface VoiceCareDeviceFixture {
  deviceId: string;
  leaseId: string;
  privateKey: KeyObject;
  actorUserId: string;
  familyId: string;
}

export async function createVoiceCareDeviceFixture(context: TestContext): Promise<VoiceCareDeviceFixture> {
  const keyPair = generateKeyPairSync('ed25519');
  const deviceId = randomUUID();
  const leaseId = randomUUID();
  const owner = await context.database.pool.query<{
    family_id: string;
    baby_id: string;
    user_id: string;
    membership_id: string;
  }>(
    `select fm.family_id, b.id baby_id, fm.user_id, fm.id membership_id
       from family_memberships fm
       join users u on u.id = fm.user_id and u.login_name = 'dad'
       join babies b on b.family_id = fm.family_id`,
  );
  const row = owner.rows[0];
  if (!row) throw new Error('expected synthetic Voice Care owner');
  await context.database.pool.query(
    `insert into voice_care_devices
      (id, family_id, public_key, capability, status, created_at)
     values ($1,$2,$3,'voice_care.intent.submit','active',$4)`,
    [deviceId, row.family_id, rawPublicKey(keyPair.publicKey), M2_TEST_NOW],
  );
  await context.database.pool.query(
    `insert into voice_care_leases
      (id, family_id, baby_id, device_id, actor_user_id, actor_membership_id,
       client_request_id, issued_at, expires_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz - interval '1 hour',$8::timestamptz + interval '7 hours',$8)`,
    [
      leaseId,
      row.family_id,
      row.baby_id,
      deviceId,
      row.user_id,
      row.membership_id,
      randomUUID(),
      M2_TEST_NOW,
    ],
  );
  return {
    deviceId,
    leaseId,
    privateKey: keyPair.privateKey,
    actorUserId: row.user_id,
    familyId: row.family_id,
  };
}

export function signedVoiceIntent(
  fixture: VoiceCareDeviceFixture,
  fields: Record<string, unknown> = {},
): { intent: VoiceCareIntentV1; raw: Buffer } {
  const candidate = VoiceCareIntentV1Schema.parse({
    schemaVersion: 1,
    requestId: randomUUID(),
    deviceId: fixture.deviceId,
    leaseId: fixture.leaseId,
    issuedAt: M2_TEST_NOW.toISOString(),
    occurredAt: M2_TEST_NOW.toISOString(),
    deliveryMode: 'live',
    intentType: 'feeding_start',
    careSessionId: null,
    speakerState: 'verified',
    payload: { mode: 'unknown', startedAt: M2_TEST_NOW.toISOString() },
    source: 'voice',
    modelVersion: 'synthetic-v1',
    signature: PLACEHOLDER_SIGNATURE,
    ...fields,
  });
  const intent = VoiceCareIntentV1Schema.parse({
    ...candidate,
    signature: typeof fields.signature === 'string'
      ? fields.signature
      : sign(null, voiceCareSigningBytesV1(candidate), fixture.privateKey).toString('base64url'),
  });
  return { intent, raw: Buffer.from(canonicalJson(intent)) };
}

export function postVoiceIntent(context: TestContext, raw: Buffer) {
  return context.app.inject({
    method: 'POST',
    url: '/api/voice-care/intents',
    headers: { 'content-type': 'application/vnd.baby-care.voice-intent+json' },
    payload: raw,
  });
}
