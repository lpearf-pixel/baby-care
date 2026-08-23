import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createM2TestApp, M2_TEST_NOW } from './helpers/m2-family-app.js';
import {
  createVoiceCareDeviceFixture,
  postVoiceIntent,
  signedVoiceIntent,
} from './helpers/voice-care.js';

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

async function counts() {
  const result = await context!.database.pool.query<{ sessions: number; receipts: number; care: number }>(
    `select
       (select count(*)::int from voice_care_feeding_sessions) sessions,
       (select count(*)::int from voice_care_intent_receipts) receipts,
       (select count(*)::int from care_events) care`,
  );
  return result.rows[0];
}

describeDatabase('M5 signed Voice Care endpoint', () => {
  it('does not register the device endpoint unless centrally enabled', async () => {
    context = await createM2TestApp(testDatabaseUrl!);
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/voice-care/intents',
      headers: { 'content-type': 'application/vnd.baby-care.voice-intent+json' },
      payload: Buffer.from('{}'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('accepts one canonical signed live start and creates no care fact', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const signed = signedVoiceIntent(fixture);
    const response = await postVoiceIntent(context, signed.raw);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      code: 'accepted_pending',
      careSessionId: expect.any(String),
      careEventId: null,
      sessionVersion: 1,
    });
    expect(await counts()).toEqual({ sessions: 1, receipts: 1, care: 0 });
    expect((await postVoiceIntent(context, signed.raw)).json()).toEqual(response.json());
    expect(await counts()).toEqual({ sessions: 1, receipts: 1, care: 0 });
  });

  it('uses one indistinguishable rejection for invalid device, signature, lease and time', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const cases = [
      signedVoiceIntent(fixture, { deviceId: randomUUID() }),
      signedVoiceIntent(fixture, { signature: Buffer.alloc(64, 1).toString('base64url') }),
      signedVoiceIntent(fixture, { leaseId: randomUUID() }),
      signedVoiceIntent(fixture, { issuedAt: new Date(M2_TEST_NOW.getTime() - 120_001).toISOString() }),
    ];
    for (const item of cases) {
      const response = await postVoiceIntent(context, item.raw);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 'rejected' });
    }
    expect(await counts()).toEqual({ sessions: 0, receipts: 0, care: 0 });
  });

  it('fails before state for noncanonical, wrong-media and over-bound bodies', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const signed = signedVoiceIntent(fixture);
    const pretty = Buffer.from(JSON.stringify(signed.intent, null, 2));
    expect((await postVoiceIntent(context, pretty)).statusCode).toBe(400);
    expect((await context.app.inject({
      method: 'POST',
      url: '/api/voice-care/intents',
      headers: { 'content-type': 'application/json' },
      payload: signed.intent,
    })).statusCode).toBe(415);
    expect((await postVoiceIntent(context, Buffer.alloc(16_385, 65))).statusCode).toBe(413);
    expect(await counts()).toEqual({ sessions: 0, receipts: 0, care: 0 });
  });

  it('returns the stored result for the same digest and rejects request-id reuse with a new digest', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const first = signedVoiceIntent(fixture);
    const accepted = await postVoiceIntent(context, first.raw);
    const changed = signedVoiceIntent(fixture, {
      requestId: first.intent.requestId,
      modelVersion: 'synthetic-v2',
    });
    expect((await postVoiceIntent(context, changed.raw)).json()).toMatchObject({ code: 'rejected' });
    expect((await postVoiceIntent(context, first.raw)).json()).toEqual(accepted.json());
    expect(await counts()).toEqual({ sessions: 1, receipts: 1, care: 0 });
  });

  it('creates no state for a revoked device, expired lease or disabled membership', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    await context.database.pool.query(
      `update voice_care_devices set status = 'revoked', revoked_at = $2 where id = $1`,
      [fixture.deviceId, M2_TEST_NOW],
    );
    expect((await postVoiceIntent(context, signedVoiceIntent(fixture).raw)).json()).toMatchObject({ code: 'rejected' });
    await context.database.pool.query(
      `update voice_care_devices set status = 'active', revoked_at = null where id = $1`,
      [fixture.deviceId],
    );
    await context.database.pool.query(
      `update voice_care_leases
          set issued_at = $2::timestamptz - interval '2 hours',
              expires_at = $2::timestamptz - interval '1 hour'
        where id = $1`,
      [fixture.leaseId, M2_TEST_NOW],
    );
    expect((await postVoiceIntent(context, signedVoiceIntent(fixture).raw)).json()).toMatchObject({ code: 'rejected' });
    await context.database.pool.query(
      `update voice_care_leases
          set issued_at = $2::timestamptz - interval '1 hour',
              expires_at = $2::timestamptz + interval '7 hours'
        where id = $1`,
      [fixture.leaseId, M2_TEST_NOW],
    );
    await context.database.pool.query(
      `update family_memberships set status = 'disabled' where user_id = $1`,
      [fixture.actorUserId],
    );
    expect((await postVoiceIntent(context, signedVoiceIntent(fixture).raw)).json()).toMatchObject({ code: 'rejected' });
    expect(await counts()).toEqual({ sessions: 0, receipts: 0, care: 0 });
  });
});
