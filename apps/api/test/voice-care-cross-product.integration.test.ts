import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createM2TestApp, M2_TEST_NOW, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';
import {
  postVoiceIntent,
  signedVoiceIntent,
  type VoiceCareDeviceFixture,
} from './helpers/voice-care.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;
let context: TestContext | undefined;

function rawPublicKey(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

async function createActivatedDeviceFixture(): Promise<VoiceCareDeviceFixture> {
  const keyPair = generateKeyPairSync('ed25519');
  const deviceId = randomUUID();
  const owner = await context!.database.pool.query<{
    family_id: string;
    user_id: string;
  }>(
    `select fm.family_id, fm.user_id
       from family_memberships fm
       join users u on u.id = fm.user_id and u.login_name = 'dad'`,
  );
  const row = owner.rows[0];
  if (!row) throw new Error('expected synthetic Voice Care owner');
  await context!.database.pool.query(
    `insert into voice_care_devices
      (id, family_id, public_key, capability, status, created_at)
     values ($1,$2,$3,'voice_care.intent.submit','active',$4)`,
    [deviceId, row.family_id, rawPublicKey(keyPair.publicKey), M2_TEST_NOW],
  );
  const lease = await context!.app.inject({
    method: 'POST',
    url: `/api/voice-care/devices/${deviceId}/leases`,
    headers: { origin: M2_TEST_ORIGIN, cookie: context!.cookie },
    payload: { clientRequestId: randomUUID(), occurredAt: M2_TEST_NOW.toISOString() },
  });
  expect(lease.statusCode).toBe(201);
  return {
    deviceId,
    leaseId: lease.json().id as string,
    privateKey: keyPair.privateKey,
    actorUserId: row.user_id,
    familyId: row.family_id,
  };
}

afterEach(async () => {
  if (context) {
    await context.app.close();
    await context.database.close();
    context = undefined;
  }
});

async function endFeeding(
  fixture: VoiceCareDeviceFixture,
  proposal: Record<string, unknown>,
) {
  const start = await postVoiceIntent(context!, signedVoiceIntent(fixture, {
    payload: { mode: proposal.mode, startedAt: proposal.startedAt },
  }).raw);
  expect(start.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 1 });
  const careSessionId = start.json().careSessionId as string;
  const end = await postVoiceIntent(context!, signedVoiceIntent(fixture, {
    intentType: 'feeding_end',
    careSessionId,
    payload: { expectedVersion: 1, finalProposal: proposal },
  }).raw);
  expect(end.json()).toMatchObject({
    code: 'needs_confirmation',
    careSessionId,
    sessionVersion: 2,
    proposalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  return { careSessionId, end };
}

function confirmFeeding(
  fixture: VoiceCareDeviceFixture,
  careSessionId: string,
  end: Awaited<ReturnType<typeof postVoiceIntent>>,
) {
  return signedVoiceIntent(fixture, {
    intentType: 'care_confirm',
    careSessionId,
    payload: {
      expectedVersion: end.json().sessionVersion,
      proposalDigest: end.json().proposalDigest,
      warningDigest: null,
      confirmedWarningCodes: [],
    },
  });
}

describeDatabase('M5 cross-product Voice Care synthetic Gate V1', () => {
  it('commits one bottle fact, replays idempotently and corrects through the authenticated route', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createActivatedDeviceFixture();
    const takeover = await context.database.pool.query(
      `select count(*)::int count from care_handoff_checkpoints where source::text = 'voice'`,
    );
    expect(takeover.rows).toEqual([{ count: 1 }]);
    const start = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      payload: { mode: 'bottle', startedAt: M2_TEST_NOW.toISOString() },
    }).raw);
    const careSessionId = start.json().careSessionId as string;
    const update = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'feeding_update',
      careSessionId,
      payload: {
        expectedVersion: 1,
        proposal: {
          mode: 'bottle',
          startedAt: M2_TEST_NOW.toISOString(),
          endedAt: null,
          liquidType: 'formula',
          amountMl: 90,
          bottleCapacityMl: 150,
        },
      },
    }).raw);
    expect(update.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 2 });
    const end = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'feeding_end',
      careSessionId,
      payload: {
        expectedVersion: 2,
        finalProposal: {
          mode: 'bottle',
          startedAt: M2_TEST_NOW.toISOString(),
          endedAt: M2_TEST_NOW.toISOString(),
          liquidType: 'formula',
          amountMl: 90,
          bottleCapacityMl: 150,
        },
      },
    }).raw);
    expect(end.json()).toMatchObject({
      code: 'needs_confirmation',
      sessionVersion: 3,
      readback: {
        templateId: 'feeding_bottle_readback',
        liquidType: 'formula',
        amountMl: 90,
        bottleCapacityMl: 150,
      },
    });
    const signedConfirm = confirmFeeding(fixture, careSessionId, end);
    const saved = await postVoiceIntent(context, signedConfirm.raw);
    expect(saved.json()).toMatchObject({ code: 'saved', careEventId: expect.any(String) });
    expect((await postVoiceIntent(context, signedConfirm.raw)).json()).toEqual(saved.json());

    const careEventId = saved.json().careEventId as string;
    const stored = await context.database.pool.query(
      `select ce.source::text source, ce.version, fc.amount_ml, fc.bottle_capacity_ml
         from care_events ce join feeding_components fc on fc.session_event_id = ce.id
        where ce.id = $1`,
      [careEventId],
    );
    expect(stored.rows).toEqual([{
      source: 'voice',
      version: 1,
      amount_ml: 90,
      bottle_capacity_ml: 150,
    }]);

    const corrected = await context.app.inject({
      method: 'PATCH',
      url: `/api/care/events/${careEventId}`,
      headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      payload: {
        expectedVersion: 1,
        event: {
          eventType: 'feeding',
          occurredAt: M2_TEST_NOW.toISOString(),
          note: 'synthetic correction',
          components: [{
            kind: 'bottle',
            liquidType: 'formula',
            amountMl: 75,
            bottleCapacityMl: 150,
          }],
          relatedActions: [],
        },
      },
    });
    expect(corrected.statusCode).toBe(200);
    const correctedRows = await context.database.pool.query(
      `select ce.version, fc.amount_ml,
              (select count(*)::int from care_event_revisions where event_id = ce.id) revisions
         from care_events ce join feeding_components fc on fc.session_event_id = ce.id
        where ce.id = $1`,
      [careEventId],
    );
    expect(correctedRows.rows).toEqual([{ version: 2, amount_ml: 75, revisions: 1 }]);
  });

  it('commits direct feeding and fails closed for cancel, identity mismatch and outage', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createActivatedDeviceFixture();
    const direct = await endFeeding(fixture, {
      mode: 'direct_breastfeeding',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      durationMinutes: 18,
    });
    expect(direct.end.json()).toMatchObject({
      readback: { templateId: 'feeding_direct_readback', durationMinutes: 18 },
    });
    const directConfirm = confirmFeeding(fixture, direct.careSessionId, direct.end);
    expect((await postVoiceIntent(context, directConfirm.raw)).json()).toMatchObject({ code: 'saved' });

    const cancellable = await postVoiceIntent(context, signedVoiceIntent(fixture).raw);
    const cancelled = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'care_cancel',
      careSessionId: cancellable.json().careSessionId,
      payload: { expectedVersion: 1, reason: 'caregiver_cancelled' },
    }).raw);
    expect(cancelled.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 2 });
    expect((await postVoiceIntent(context, signedVoiceIntent(fixture, {
      speakerState: 'mismatch',
    }).raw)).json()).toMatchObject({ code: 'identity_mismatch', careSessionId: null });

    const outage = await endFeeding(fixture, {
      mode: 'bottle',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      liquidType: 'formula',
      amountMl: 60,
      bottleCapacityMl: null,
    });
    await context.database.pool.query(
      `alter table audit_events add constraint voice_care_cross_product_outage
       check (action <> 'voice_care.session_committed') not valid`,
    );
    try {
      const outageConfirm = confirmFeeding(fixture, outage.careSessionId, outage.end);
      expect((await postVoiceIntent(context, outageConfirm.raw)).json())
        .toMatchObject({ code: 'temporarily_unavailable' });
    } finally {
      await context.database.pool.query(
        `alter table audit_events drop constraint voice_care_cross_product_outage`,
      );
    }
    const facts = await context.database.pool.query(
      `select ce.source::text source, fc.duration_minutes, fc.amount_ml
         from care_events ce join feeding_components fc on fc.session_event_id = ce.id
        order by ce.created_at, ce.id`,
    );
    expect(facts.rows).toEqual([{ source: 'voice', duration_minutes: 18, amount_ml: null }]);
    const states = await context.database.pool.query<{ state: string }>(
      `select state from voice_care_feeding_sessions order by created_at, id`,
    );
    expect(states.rows.map((row) => row.state).sort()).toEqual([
      'cancelled',
      'committed',
      'needs_confirmation',
    ]);
  });
});
