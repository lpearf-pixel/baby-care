import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createM2TestApp, M2_TEST_NOW, M2_TEST_ORIGIN, postFeeding } from './helpers/m2-family-app.js';
import {
  createVoiceCareDeviceFixture,
  postVoiceIntent,
  signedVoiceIntent,
  type VoiceCareDeviceFixture,
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

async function endedSession(
  fixture: VoiceCareDeviceFixture,
  proposal: Record<string, unknown>,
  speakerState: 'verified' | 'uncertain' = 'verified',
) {
  const mode = proposal.mode as 'bottle' | 'direct_breastfeeding';
  const start = await postVoiceIntent(context!, signedVoiceIntent(fixture, {
    speakerState,
    payload: { mode, startedAt: proposal.startedAt },
  }).raw);
  const sessionId = start.json().careSessionId as string;
  const end = await postVoiceIntent(context!, signedVoiceIntent(fixture, {
    speakerState,
    intentType: 'feeding_end',
    careSessionId: sessionId,
    payload: { expectedVersion: 1, finalProposal: proposal },
  }).raw);
  return {
    sessionId,
    version: end.json().sessionVersion as number,
    proposalDigest: end.json().proposalDigest as string,
  };
}

function confirm(fixture: VoiceCareDeviceFixture, pending: Awaited<ReturnType<typeof endedSession>>, fields = {}) {
  return postVoiceIntent(context!, signedVoiceIntent(fixture, {
    intentType: 'care_confirm',
    careSessionId: pending.sessionId,
    payload: {
      expectedVersion: pending.version,
      proposalDigest: pending.proposalDigest,
      warningDigest: null,
      confirmedWarningCodes: [],
      ...fields,
    },
  }).raw);
}

function browserConfirm(
  pending: Awaited<ReturnType<typeof endedSession>>,
  cookie = context!.cookie,
  fields: Record<string, unknown> = {},
) {
  return context!.app.inject({
    method: 'POST',
    url: `/api/voice-care/sessions/${pending.sessionId}/confirm`,
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload: {
      expectedVersion: pending.version,
      proposalDigest: pending.proposalDigest,
      warningDigest: null,
      confirmedWarningCodes: [],
      ...fields,
    },
  });
}

async function loginCookie(loginName: 'mom'): Promise<string> {
  const login = await context!.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: M2_TEST_ORIGIN },
    payload: { loginName, password: `${loginName}-test-password` },
  });
  expect(login.statusCode).toBe(200);
  const header = login.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error('expected session cookie');
  return raw.split(';', 1)[0]!;
}

describeDatabase('M5 Voice Care feeding promotion', () => {
  it('commits one exact bottle fact with consumed ml separate from capacity', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'bottle',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      liquidType: 'formula',
      amountMl: 90,
      bottleCapacityMl: 150,
    });
    const saved = await confirm(fixture, pending);
    expect(saved.json()).toMatchObject({
      code: 'saved',
      careSessionId: pending.sessionId,
      careEventId: expect.any(String),
      proposalDigest: pending.proposalDigest,
    });
    const stored = await context.database.pool.query<{
      source: string;
      amount_ml: number;
      bottle_capacity_ml: number;
      state: string;
      linked_id: string;
    }>(
      `select ce.source::text source, fc.amount_ml, fc.bottle_capacity_ml,
              vcs.state, vcs.final_care_event_id linked_id
         from voice_care_feeding_sessions vcs
         join care_events ce on ce.id = vcs.final_care_event_id
         join feeding_components fc on fc.session_event_id = ce.id
        where vcs.id = $1`,
      [pending.sessionId],
    );
    expect(stored.rows).toEqual([{
      source: 'voice',
      amount_ml: 90,
      bottle_capacity_ml: 150,
      state: 'committed',
      linked_id: saved.json().careEventId,
    }]);
    expect((await confirm(fixture, pending)).json()).toEqual(saved.json());
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(1);
  });

  it('commits direct breastfeeding minutes without inferred ml', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'direct_breastfeeding',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      durationMinutes: 18,
    });
    expect((await confirm(fixture, pending)).json()).toMatchObject({ code: 'saved' });
    const component = await context.database.pool.query(
      `select duration_minutes, amount_ml from feeding_components`,
    );
    expect(component.rows).toEqual([{ duration_minutes: 18, amount_ml: null }]);
  });

  it('binds the exact warning digest and version before saving', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    for (const [time, amount] of [
      ['2026-08-13T07:20:00.000Z', 60],
      ['2026-08-13T07:00:00.000Z', 60],
      ['2026-08-13T06:40:00.000Z', 70],
    ] as const) {
      expect((await postFeeding(context.app, context.cookie, {
        occurredAt: time,
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: amount }],
      })).statusCode).toBe(201);
    }
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'bottle',
      startedAt: '2026-08-13T07:50:00.000Z',
      endedAt: '2026-08-13T07:50:00.000Z',
      liquidType: 'formula',
      amountMl: 190,
      bottleCapacityMl: null,
    });
    const warning = await confirm(fixture, pending);
    expect(warning.json()).toMatchObject({
      code: 'needs_confirmation',
      sessionVersion: pending.version + 1,
      warningDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      warningCodes: ['unusual_value'],
    });
    const saved = await confirm(fixture, {
      ...pending,
      version: warning.json().sessionVersion,
    }, {
      warningDigest: warning.json().warningDigest,
      confirmedWarningCodes: warning.json().warningCodes,
    });
    expect(saved.json()).toMatchObject({ code: 'saved' });
    const changedRetry = await confirm(fixture, {
      ...pending,
      version: warning.json().sessionVersion,
    });
    expect(changedRetry.json()).toMatchObject({ code: 'state_conflict' });
  });

  it('requires the same browser actor to confirm uncertain state and promotes once under a concurrent retry', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'bottle',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      liquidType: 'expressed_breast_milk',
      amountMl: 60,
      bottleCapacityMl: null,
    }, 'uncertain');
    expect((await confirm(fixture, pending)).json()).toMatchObject({ code: 'needs_confirmation' });
    expect((await confirm(fixture, pending, { proposalDigest: '0'.repeat(64) })).json())
      .toMatchObject({ code: 'state_conflict' });
    const momCookie = await loginCookie('mom');
    expect((await browserConfirm(pending, momCookie)).json()).toMatchObject({ code: 'state_conflict' });
    const saved = await Promise.all([browserConfirm(pending), browserConfirm(pending)]);
    expect(saved.map((response) => response.json().code)).toEqual(['saved', 'saved']);
    expect(saved[0]!.json().careEventId).toBe(saved[1]!.json().careEventId);
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(1);
  });

  it('allows Dad or Mom to cancel a stale session without creating a care event', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const start = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      payload: { mode: 'bottle', startedAt: M2_TEST_NOW.toISOString() },
    }).raw);
    const momCookie = await loginCookie('mom');
    const cancelled = await context.app.inject({
      method: 'POST',
      url: `/api/voice-care/sessions/${start.json().careSessionId}/cancel`,
      headers: { origin: M2_TEST_ORIGIN, cookie: momCookie },
      payload: { expectedVersion: 1, reason: 'stale' },
    });
    expect(cancelled.json()).toMatchObject({ code: 'accepted_pending', sessionVersion: 2 });
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(0);
  });

  it('blocks device confirmation after lease revocation', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'bottle',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      liquidType: 'formula',
      amountMl: 75,
      bottleCapacityMl: null,
    });
    await context.database.pool.query(
      `update voice_care_leases set revoked_at = $2 where id = $1`,
      [fixture.leaseId, M2_TEST_NOW],
    );
    expect((await confirm(fixture, pending)).json()).toMatchObject({ code: 'rejected' });
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(0);
  });

  it('rolls back the final event and never returns saved when its audit write fails', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'direct_breastfeeding',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      durationMinutes: 12,
    });
    await context.database.pool.query(
      `alter table audit_events add constraint voice_care_test_audit_failure
       check (action <> 'voice_care.session_committed')`,
    );
    try {
      expect((await confirm(fixture, pending)).json()).toMatchObject({ code: 'temporarily_unavailable' });
    } finally {
      await context.database.pool.query(
        `alter table audit_events drop constraint voice_care_test_audit_failure`,
      );
    }
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(0);
    const session = await context.database.pool.query<{ state: string; final_care_event_id: string | null }>(
      `select state, final_care_event_id from voice_care_feeding_sessions where id = $1`,
      [pending.sessionId],
    );
    expect(session.rows).toEqual([{ state: 'needs_confirmation', final_care_event_id: null }]);
  });

  it('fails closed when a device request id collides with an existing manual care write', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const collisionId = randomUUID();
    expect((await postFeeding(context.app, context.cookie, {
      occurredAt: M2_TEST_NOW.toISOString(),
      clientRequestId: collisionId,
      components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 30 }],
    })).statusCode).toBe(201);
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'bottle',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      liquidType: 'formula',
      amountMl: 75,
      bottleCapacityMl: null,
    });
    const response = await postVoiceIntent(context, signedVoiceIntent(fixture, {
      requestId: collisionId,
      intentType: 'care_confirm',
      careSessionId: pending.sessionId,
      payload: {
        expectedVersion: pending.version,
        proposalDigest: pending.proposalDigest,
        warningDigest: null,
        confirmedWarningCodes: [],
      },
    }).raw);
    expect(response.json()).toMatchObject({ code: 'temporarily_unavailable' });
    const rows = await context.database.pool.query<{ source: string; amount_ml: number }>(
      `select ce.source::text source, fc.amount_ml
         from care_events ce join feeding_components fc on fc.session_event_id = ce.id`,
    );
    expect(rows.rows).toEqual([{ source: 'manual', amount_ml: 30 }]);
    const session = await context.database.pool.query<{ state: string; final_care_event_id: string | null }>(
      `select state, final_care_event_id from voice_care_feeding_sessions where id = $1`,
      [pending.sessionId],
    );
    expect(session.rows).toEqual([{ state: 'needs_confirmation', final_care_event_id: null }]);
  });

  it('does not expose saved when PostgreSQL rejects the outer commit', async () => {
    context = await createM2TestApp(testDatabaseUrl!, { voiceCareEnabled: true });
    const fixture = await createVoiceCareDeviceFixture(context);
    const pending = await endedSession(fixture, {
      mode: 'direct_breastfeeding',
      startedAt: M2_TEST_NOW.toISOString(),
      endedAt: M2_TEST_NOW.toISOString(),
      durationMinutes: 9,
    });
    await context.database.pool.query(`
      create function voice_care_test_reject_commit() returns trigger
      language plpgsql as 'begin raise exception ''synthetic deferred failure''; end';
      create constraint trigger voice_care_test_reject_commit
      after update on voice_care_feeding_sessions
      deferrable initially deferred for each row
      when (new.state = 'committed')
      execute function voice_care_test_reject_commit()
    `);
    try {
      expect((await confirm(fixture, pending)).json()).toMatchObject({ code: 'temporarily_unavailable' });
    } finally {
      await context.database.pool.query(`
        drop trigger voice_care_test_reject_commit on voice_care_feeding_sessions;
        drop function voice_care_test_reject_commit()
      `);
    }
    expect((await context.database.pool.query(`select 1 from care_events`)).rowCount).toBe(0);
    const session = await context.database.pool.query<{ state: string; final_care_event_id: string | null }>(
      `select state, final_care_event_id from voice_care_feeding_sessions where id = $1`,
      [pending.sessionId],
    );
    expect(session.rows).toEqual([{ state: 'needs_confirmation', final_care_event_id: null }]);
  });
});
