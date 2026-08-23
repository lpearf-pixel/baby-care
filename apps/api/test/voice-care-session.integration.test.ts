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

describeDatabase('M5 pending Voice Care feeding state', () => {
  it('updates, ends and confirms typed state, while cancellation creates no additional care event', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      payload: { mode: 'bottle', startedAt: M2_TEST_NOW.toISOString() },
    }).raw);
    const sessionId = start.json().careSessionId as string;
    const update = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'feeding_update',
      careSessionId: sessionId,
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
      careSessionId: sessionId,
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
      proposalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      readback: { templateId: 'feeding_bottle_readback', liquidType: 'formula', amountMl: 90 },
    });
    const confirm = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'care_confirm',
      careSessionId: sessionId,
      payload: {
        expectedVersion: 3,
        proposalDigest: end.json().proposalDigest,
        warningDigest: null,
        confirmedWarningCodes: [],
      },
    }).raw);
    expect(confirm.json()).toMatchObject({ code: 'saved', sessionVersion: 4, careEventId: expect.any(String) });
    const state = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/state',
      headers: { cookie: context.cookie },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      devices: [{ id: fixture.deviceId }],
      activeLeases: [{ id: fixture.leaseId }],
      sessions: [{ id: sessionId, state: 'committed', canConfirm: false, canCancel: false }],
    });
    expect(state.body).not.toMatch(/signature|publicKey|modelVersion|requestId/);
    const cancellable = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      payload: { mode: 'bottle', startedAt: M2_TEST_NOW.toISOString() },
    }).raw);
    const cancellableId = cancellable.json().careSessionId as string;
    const cancel = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'care_cancel',
      careSessionId: cancellableId,
      payload: { expectedVersion: 1, reason: 'caregiver_cancelled' },
    }).raw);
    expect(cancel.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 2 });
    const rows = await context.database.pool.query<{ state: string; care_count: number }>(
      `select state, (select count(*)::int from care_events) care_count
         from voice_care_feeding_sessions where id = $1`,
      [cancellableId],
    );
    expect(rows.rows[0]).toEqual({ state: 'cancelled', care_count: 1 });
  });

  it('keeps replay and uncertain state reviewable, and mismatch creates no session', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const mismatch = await postVoiceIntent(context, signedVoiceIntent(fixture, { speakerState: 'mismatch' }).raw);
    expect(mismatch.json()).toMatchObject({ code: 'identity_mismatch', careSessionId: null });
    const replay = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      deliveryMode: 'replay',
      issuedAt: new Date(M2_TEST_NOW.getTime() - 24 * 60 * 60_000).toISOString(),
    }).raw);
    expect(replay.json()).toMatchObject({ code: 'needs_confirmation', careSessionId: expect.any(String) });
    for (const speakerState of ['uncertain', 'not_enrolled', 'unavailable'] as const) {
      const response = await postVoiceIntent(context, signedVoiceIntent(fixture, {
        requestId: randomUUID(),
        speakerState,
      }).raw);
      expect(response.json()).toMatchObject({ code: 'needs_confirmation', careSessionId: expect.any(String) });
    }
    const states = await context.database.pool.query<{ state: string }>(
      `select state from voice_care_feeding_sessions order by created_at, id`,
    );
    expect(states.rows).toEqual([
      { state: 'needs_review' },
      { state: 'needs_review' },
      { state: 'needs_review' },
      { state: 'needs_review' },
    ]);
  });

  it('rejects stale expectedVersion and leaves the session unchanged', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntent(fixture).raw);
    const sessionId = start.json().careSessionId as string;
    const stale = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      intentType: 'care_cancel',
      careSessionId: sessionId,
      payload: { expectedVersion: 2, reason: 'stale' },
    }).raw);
    expect(stale.json()).toMatchObject({ code: 'state_conflict' });
    const row = await context.database.pool.query<{ state: string; version: number }>(
      `select state, version from voice_care_feeding_sessions where id = $1`,
      [sessionId],
    );
    expect(row.rows[0]).toEqual({ state: 'pending', version: 1 });
  });

  it('opportunistically moves six-hour pending state to review without a care fact', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntent(fixture).raw);
    const sessionId = start.json().careSessionId as string;
    await context.database.pool.query(
      `update voice_care_feeding_sessions
          set started_at = $2::timestamptz - interval '7 hours',
              expires_at = $2::timestamptz - interval '1 hour'
        where id = $1`,
      [sessionId, M2_TEST_NOW],
    );
    await postVoiceIntent(context, signedVoiceIntent(fixture).raw);
    const row = await context.database.pool.query<{ state: string; version: number; care_count: number }>(
      `select state, version, (select count(*)::int from care_events) care_count
         from voice_care_feeding_sessions where id = $1`,
      [sessionId],
    );
    expect(row.rows[0]).toEqual({ state: 'needs_review', version: 2, care_count: 0 });
    const state = await context.app.inject({
      method: 'GET',
      url: '/api/voice-care/state',
      headers: { cookie: context.cookie },
    });
    expect(state.json().sessions.find((session: { id: string }) => session.id === sessionId)).toMatchObject({
      id: sessionId,
      state: 'needs_review',
      canConfirm: false,
      canCancel: true,
    });
  });
});
