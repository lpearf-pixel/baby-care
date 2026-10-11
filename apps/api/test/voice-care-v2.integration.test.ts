import { afterEach, describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_NOW } from './helpers/m2-family-app.js';
import { createVoiceCareDeviceFixture, postVoiceIntent, signedVoiceIntentV2 } from './helpers/voice-care.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
let context: Awaited<ReturnType<typeof createM2TestApp>> | undefined;

afterEach(async () => {
  if (context) {
    await context.app.close();
    await context.database.close();
    context = undefined;
  }
});

describeDatabase('Voice Care v2 multi-component feeding', () => {
  it('commits breast milk 60 ml plus formula 30 ml only after confirmation', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntentV2(fixture).raw);
    expect(start.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 1 });
    const careSessionId = start.json().careSessionId as string;

    const update = await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      intentType: 'feeding_update',
      careSessionId,
      payload: {
        expectedVersion: 1,
        components: [
          { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 60 },
          { kind: 'bottle', liquidType: 'formula', amountMl: 30 },
        ],
      },
    }).raw);
    expect(update.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 2 });

    const end = await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      intentType: 'feeding_end',
      careSessionId,
      payload: {
        expectedVersion: 2,
        finalProposal: {
          schemaVersion: 2,
          startedAt: M2_TEST_NOW.toISOString(),
          endedAt: M2_TEST_NOW.toISOString(),
          components: [
            { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 60 },
            { kind: 'bottle', liquidType: 'formula', amountMl: 30 },
          ],
        },
      },
    }).raw);
    expect(end.json()).toMatchObject({ code: 'needs_confirmation', sessionVersion: 3 });
    const beforeConfirm = await context.database.pool.query(
      `select count(*)::int count from care_events where source::text = 'voice'`,
    );
    expect(beforeConfirm.rows).toEqual([{ count: 0 }]);

    const confirmRaw = signedVoiceIntentV2(fixture, {
      intentType: 'care_confirm',
      careSessionId,
      payload: {
        expectedVersion: 3,
        proposalDigest: end.json().proposalDigest,
        warningDigest: null,
        confirmedWarningCodes: [],
      },
    }).raw;
    const confirm = await postVoiceIntent(context, confirmRaw);
    expect(confirm.json()).toMatchObject({ code: 'saved', sessionVersion: 4 });
    const stored = await context.database.pool.query(
      `select fc.liquid_type, fc.amount_ml, fc.duration_minutes
         from care_events ce join feeding_components fc on fc.session_event_id = ce.id
        where ce.source::text = 'voice' order by fc.liquid_type`,
    );
    expect(stored.rows).toEqual([
      { liquid_type: 'expressed_breast_milk', amount_ml: 60, duration_minutes: null },
      { liquid_type: 'formula', amount_ml: 30, duration_minutes: null },
    ]);
    expect((await postVoiceIntent(context, confirmRaw)).json()).toEqual(confirm.json());
  });

  it('commits direct breastfeeding duration without an inferred amount', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      payload: { mode: 'direct_breastfeeding', startedAt: M2_TEST_NOW.toISOString() },
    }).raw);
    const careSessionId = start.json().careSessionId as string;
    await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      intentType: 'feeding_update',
      careSessionId,
      payload: { expectedVersion: 1, components: [{ kind: 'direct_breastfeeding', durationMinutes: 10 }] },
    }).raw);
    const end = await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      intentType: 'feeding_end',
      careSessionId,
      payload: {
        expectedVersion: 2,
        finalProposal: {
          schemaVersion: 2,
          startedAt: M2_TEST_NOW.toISOString(),
          endedAt: M2_TEST_NOW.toISOString(),
          components: [{ kind: 'direct_breastfeeding', durationMinutes: 10 }],
        },
      },
    }).raw);
    const saved = await postVoiceIntent(context, signedVoiceIntentV2(fixture, {
      intentType: 'care_confirm', careSessionId,
      payload: {
        expectedVersion: 3,
        proposalDigest: end.json().proposalDigest,
        warningDigest: null,
        confirmedWarningCodes: [],
      },
    }).raw);
    expect(saved.json()).toMatchObject({ code: 'saved' });
    const stored = await context.database.pool.query(
      `select liquid_type, amount_ml, duration_minutes
         from feeding_components where session_event_id = $1`,
      [saved.json().careEventId],
    );
    expect(stored.rows).toEqual([{ liquid_type: null, amount_ml: null, duration_minutes: 10 }]);
  });
});
