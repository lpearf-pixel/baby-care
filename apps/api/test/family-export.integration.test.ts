import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseContext } from '../src/db.js';
import { createFamilyExportRepository } from '../src/family/family-export-repository.js';
import { createFamilyExportService } from '../src/family/family-export-service.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const generatedAt = new Date('2026-08-17T12:00:00.000Z');

interface SeededExport {
  familyId: string;
  babyId: string;
  dadUserId: string;
  dadMembershipId: string;
  momUserId: string;
  momMembershipId: string;
  nannyUserId: string;
  nannyMembershipId: string;
  disabledNannyMembershipId: string;
  feedingEventId: string;
  diaperEventId: string;
}

async function seedCompleteExport(database: DatabaseContext): Promise<SeededExport> {
  const household = await database.pool.query<{
    family_id: string;
    baby_id: string;
    dad_user_id: string;
    dad_membership_id: string;
    mom_user_id: string;
    mom_membership_id: string;
  }>(
    `select f.id as family_id, b.id as baby_id,
            (max(u.id::text) filter (where fm.relationship = 'dad'))::uuid as dad_user_id,
            (max(fm.id::text) filter (where fm.relationship = 'dad'))::uuid as dad_membership_id,
            (max(u.id::text) filter (where fm.relationship = 'mom'))::uuid as mom_user_id,
            (max(fm.id::text) filter (where fm.relationship = 'mom'))::uuid as mom_membership_id
       from families f
       join babies b on b.family_id = f.id
       join family_memberships fm on fm.family_id = f.id
       join users u on u.id = fm.user_id
      group by f.id, b.id`,
  );
  const family = household.rows[0];
  if (!family) throw new Error('synthetic family fixture missing');

  const nannyUserId = randomUUID();
  const nannyMembershipId = randomUUID();
  const disabledNannyUserId = randomUUID();
  const disabledNannyMembershipId = randomUUID();
  await database.pool.query(
    `insert into users (id, login_name, display_name, password_hash, status)
     values ($1, $2, 'Nanny', 'secret-hash-not-exported', 'active'),
            ($3, $4, 'Former Nanny', 'old-secret-hash-not-exported', 'disabled')`,
    [nannyUserId, `nanny-${nannyUserId}`, disabledNannyUserId, `former-nanny-${disabledNannyUserId}`],
  );
  await database.pool.query(
    `insert into family_memberships (
       id, family_id, user_id, relationship, permission_level, status,
       created_at, updated_at
     ) values
       ($1, $3, $4, 'nanny', 'caregiver', 'active', $6, $6),
       ($2, $3, $5, 'nanny', 'caregiver', 'disabled', $6, $6)`,
    [
      nannyMembershipId,
      disabledNannyMembershipId,
      family.family_id,
      nannyUserId,
      disabledNannyUserId,
      '2026-08-17T06:00:00.000Z',
    ],
  );

  const eventIds = {
    feeding: randomUUID(),
    diaper: randomUUID(),
    sleep: randomUUID(),
    burping: randomUUID(),
    spit_up: randomUUID(),
    crying: randomUUID(),
    bathing: randomUUID(),
    medication: randomUUID(),
    temperature: randomUUID(),
    weight: randomUUID(),
  } as const;
  const eventTypes = Object.keys(eventIds) as Array<keyof typeof eventIds>;
  for (const [index, eventType] of eventTypes.entries()) {
    const machine = eventType === 'weight';
    const actorUserId = machine
      ? null
      : index % 3 === 0
        ? family.dad_user_id
        : index % 3 === 1
          ? family.mom_user_id
          : nannyUserId;
    const actorMembershipId = machine
      ? null
      : index % 3 === 0
        ? family.dad_membership_id
        : index % 3 === 1
          ? family.mom_membership_id
          : nannyMembershipId;
    const occurredAt = `2026-08-17T${String(7 + index).padStart(2, '0')}:00:00.000Z`;
    const version = eventType === 'feeding' || eventType === 'diaper' ? 2 : 1;
    const status = eventType === 'diaper' ? 'voided' : 'active';
    await database.pool.query(
      `insert into care_events (
         id, family_id, baby_id, actor_user_id, actor_membership_id,
         source, event_type, occurred_at, created_at, updated_at,
         status, version, client_request_id, note, trace_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10,$11,$12,$13)`,
      [
        eventIds[eventType],
        family.family_id,
        family.baby_id,
        actorUserId,
        actorMembershipId,
        machine ? 'guardian' : 'manual',
        eventType,
        occurredAt,
        status,
        version,
        machine ? null : randomUUID(),
        `synthetic ${eventType} private note`,
        `private-trace-${eventType}`,
      ],
    );
  }

  await database.pool.query('insert into feeding_sessions (event_id) values ($1)', [eventIds.feeding]);
  await database.pool.query(
    `insert into feeding_components (
       id, session_event_id, component_type, liquid_type, amount_ml,
       duration_minutes, bottle_capacity_ml, occurred_at
     ) values
       ($1,$3,'direct_breastfeeding',null,null,18,null,'2026-08-17T07:00:00.000Z'),
       ($2,$3,'bottle','formula',65,null,150,'2026-08-17T07:01:00.000Z'),
       ($4,$3,'bottle','expressed_breast_milk',30,null,90,'2026-08-17T07:02:00.000Z')`,
    [randomUUID(), randomUUID(), eventIds.feeding, randomUUID()],
  );
  await database.pool.query(
    `insert into diaper_events (event_id, kind, stool_color, stool_consistency, stool_amount)
     values ($1, 'urine_stool', 'yellow', 'soft', 'medium')`,
    [eventIds.diaper],
  );
  await database.pool.query(
    `insert into sleep_intervals (event_id, started_at, ended_at)
     values ($1, '2026-08-17T09:00:00.000Z', '2026-08-17T10:30:00.000Z')`,
    [eventIds.sleep],
  );
  await database.pool.query(
    `insert into care_actions (
       event_id, action_type, feeding_session_event_id, spit_up_amount,
       crying_duration_minutes, medication_name, medication_dose, medication_dose_unit
     ) values
       ($1,'burping',$6,null,null,null,null,null),
       ($2,'spit_up',null,'small',null,null,null,null),
       ($3,'crying',null,null,6,null,null,null),
       ($4,'bathing',null,null,null,null,null,null),
       ($5,'medication',null,null,null,'Synthetic medicine',1.25,'mL')`,
    [eventIds.burping, eventIds.spit_up, eventIds.crying, eventIds.bathing, eventIds.medication, eventIds.feeding],
  );
  await database.pool.query(
    `insert into measurements (event_id, measurement_type, value, method)
     values ($1,'temperature',37.1,'axillary'), ($2,'weight',3.45,null)`,
    [eventIds.temperature, eventIds.weight],
  );

  await database.pool.query(
    `insert into care_event_revisions (
       id, event_id, edit_actor_user_id, edit_actor_membership_id,
       revision_action, from_version, to_version, before_json, after_json, trace_id, created_at
     ) values
       ($1,$3,$5,$6,'edit',1,2,$7::jsonb,$8::jsonb,'private-edit-trace','2026-08-17T07:30:00.000Z'),
       ($2,$4,$5,$6,'void',1,2,$9::jsonb,$10::jsonb,'private-void-trace','2026-08-17T08:30:00.000Z')`,
    [
      randomUUID(),
      randomUUID(),
      eventIds.feeding,
      eventIds.diaper,
      family.dad_user_id,
      family.dad_membership_id,
      JSON.stringify({
        eventType: 'feeding',
        occurredAt: '2026-08-17T07:00:00.000Z',
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
      }),
      JSON.stringify({
        eventType: 'feeding',
        occurredAt: '2026-08-17T07:00:00.000Z',
        note: 'synthetic feeding private note',
        components: [
          { kind: 'direct_breastfeeding', durationMinutes: 18 },
          { kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 },
          { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 30, bottleCapacityMl: 90 },
        ],
        relatedActions: [{ kind: 'burping' }],
      }),
      JSON.stringify({
        eventType: 'diaper',
        occurredAt: '2026-08-17T08:00:00.000Z',
        note: 'synthetic diaper private note',
        kind: 'urine_stool',
        stoolColor: 'yellow',
        stoolConsistency: 'soft',
        stoolAmount: 'medium',
      }),
      JSON.stringify({ status: 'voided' }),
    ],
  );

  await database.pool.query(
    `insert into care_handoff_checkpoints (
       id, family_id, baby_id, actor_user_id, actor_membership_id,
       source, occurred_at, created_at, client_request_id, trace_id
     ) values
       ($1,$3,$4,$5,$6,'manual','2026-08-17T10:00:00.000Z','2026-08-17T10:00:01.000Z',$7,'private-handoff-trace'),
       ($2,$3,$4,null,null,'device','2026-08-17T11:00:00.000Z','2026-08-17T11:00:01.000Z',null,'private-device-trace')`,
    [
      randomUUID(),
      randomUUID(),
      family.family_id,
      family.baby_id,
      nannyUserId,
      nannyMembershipId,
      randomUUID(),
    ],
  );
  await database.pool.query(
    `insert into care_handoff_reminder_rules (
       id, family_id, baby_id, actor_user_id, actor_membership_id,
       local_time, weekday_mask, enabled, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,'08:30',31,true,$6,$6)`,
    [
      randomUUID(),
      family.family_id,
      family.baby_id,
      nannyUserId,
      nannyMembershipId,
      '2026-08-17T06:30:00.000Z',
    ],
  );

  return {
    familyId: family.family_id,
    babyId: family.baby_id,
    dadUserId: family.dad_user_id,
    dadMembershipId: family.dad_membership_id,
    momUserId: family.mom_user_id,
    momMembershipId: family.mom_membership_id,
    nannyUserId,
    nannyMembershipId,
    disabledNannyMembershipId,
    feedingEventId: eventIds.feeding,
    diaperEventId: eventIds.diaper,
  };
}

function exportActor(seed: SeededExport) {
  return {
    familyId: seed.familyId,
    userId: seed.dadUserId,
    membershipId: seed.dadMembershipId,
    relationship: 'dad' as const,
    permissionLevel: 'family_admin' as const,
  };
}

function trackedSnapshotDatabase(
  database: DatabaseContext,
  afterEventEnvelope?: () => Promise<void>,
): { context: DatabaseContext; applicationQueries: () => number } {
  let queryCount = 0;
  return {
    context: {
      pool: {
        async connect() {
          const client = await database.pool.connect();
          return {
            async query(statement: string, values?: unknown[]) {
              const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
              const transactionStatement = normalized === 'begin isolation level repeatable read read only'
                || normalized === 'commit'
                || normalized === 'rollback';
              if (!transactionStatement) queryCount += 1;
              const result = await client.query(statement, values);
              if (afterEventEnvelope && normalized.includes('from care_events ce')
                && normalized.includes('actor_display_name') && normalized.includes('ce.event_type')) {
                await afterEventEnvelope();
              }
              return result;
            },
            release() {
              client.release();
            },
          } as unknown as pg.PoolClient;
        },
        async query() {
          throw new Error('family export escaped its injected snapshot client');
        },
      } as unknown as pg.Pool,
    } as DatabaseContext,
    applicationQueries: () => queryCount,
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describeDatabase('family export PostgreSQL snapshot', () => {
  it('serves one audited private attachment from the authenticated family scope', async () => {
    const fixture = await createM2TestApp(testDatabaseUrl!);
    try {
      const seed = await seedCompleteExport(fixture.database);
      const response = await fixture.app.inject({
        method: 'POST',
        url: '/api/family/export',
        headers: { origin: M2_TEST_ORIGIN, cookie: fixture.cookie },
        payload: { familyId: 'foreign', babyId: 'foreign' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="baby-care-export-[0-9TZ]+\.json"$/);
      expect(response.json().family.id).toBe(seed.familyId);

      const audits = await fixture.database.pool.query<{
        family_id: string;
        actor_user_id: string;
        actor_membership_id: string;
        action: string;
        target_type: string;
        target_id: string;
        source: string;
        trace_id: string;
        occurred_at: Date;
        metadata_json: unknown;
      }>(
        `select family_id, actor_user_id, actor_membership_id, action, target_type,
        target_id, source, trace_id, occurred_at, metadata_json
           from audit_events where action = 'family.export'`,
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]).toMatchObject({
        family_id: seed.familyId,
        actor_user_id: seed.dadUserId,
        actor_membership_id: seed.dadMembershipId,
        action: 'family.export',
        target_type: 'family',
        target_id: seed.familyId,
        source: 'web',
        metadata_json: null,
      });
      expect(audits.rows[0]?.occurred_at.toISOString()).toBe('2026-08-13T08:00:00.000Z');
      expect(audits.rows[0]?.trace_id).toBeTruthy();
    } finally {
      await fixture.app.close();
      await fixture.database.close();
    }
  });

  it('exports complete typed family data with fixed set-oriented reads and no private internals', async () => {
    const fixture = await createM2TestApp(testDatabaseUrl!);
    try {
      const seed = await seedCompleteExport(fixture.database);
      const tracked = trackedSnapshotDatabase(fixture.database);
      const result = await createFamilyExportService(
        tracked.context,
        createFamilyExportRepository(),
        4 * 1024 * 1024,
      ).exportFamily(exportActor(seed), generatedAt);

      expect(tracked.applicationQueries()).toBeLessThanOrEqual(10);
      expect(result.document.generatedAt).toBe(generatedAt.toISOString());
      expect(result.document.family.id).toBe(seed.familyId);
      expect(result.document.baby.id).toBe(seed.babyId);
      expect(result.document.members.slice(0, 2).map((member) => [member.relationship, member.status])).toEqual([
        ['dad', 'active'],
        ['mom', 'active'],
      ]);
      expect(new Set(result.document.members.slice(2).map((member) => `${member.relationship}:${member.status}`)))
        .toEqual(new Set(['nanny:active', 'nanny:disabled']));
      expect(result.document.members.find((member) => member.membershipId === seed.nannyMembershipId))
        .toMatchObject({ displayName: 'Nanny', permissionLevel: 'caregiver' });
      expect(result.document.members.find((member) => member.membershipId === seed.disabledNannyMembershipId))
        .toMatchObject({ displayName: 'Former Nanny', status: 'disabled' });
      expect(new Set(result.document.careEvents.map((event) => event.eventType))).toEqual(new Set([
        'feeding', 'diaper', 'sleep', 'burping', 'spit_up',
        'crying', 'bathing', 'medication', 'temperature', 'weight',
      ]));
      const feeding = result.document.careEvents.find((event) => event.eventType === 'feeding');
      expect(feeding).toMatchObject({
        id: seed.feedingEventId,
        status: 'active',
        version: 2,
        note: 'synthetic feeding private note',
        payload: {
          components: [
            { kind: 'direct_breastfeeding', durationMinutes: 18 },
            { kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 },
            { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 30, bottleCapacityMl: 90 },
          ],
          relatedActions: [{ kind: 'burping' }],
        },
      });
      expect(result.document.careEvents.find((event) => event.id === seed.diaperEventId))
        .toMatchObject({ status: 'voided', version: 2 });
      expect(result.document.careEvents.find((event) => event.eventType === 'medication'))
        .toMatchObject({ payload: { action: { kind: 'medication', medicationName: 'Synthetic medicine', dose: 1.25, doseUnit: 'mL' } } });
      expect(result.document.careEvents.find((event) => event.eventType === 'weight'))
        .toMatchObject({ source: 'guardian', actorUserId: null, actorMembershipId: null, actorDisplayName: null });
      expect(new Set(result.document.careRevisions.map((revision) => revision.action))).toEqual(new Set(['edit', 'void']));
      expect(result.document.handoffCheckpoints.map((checkpoint) => checkpoint.source)).toEqual(['manual', 'device']);
      expect(result.document.handoffReminderRules).toHaveLength(1);
      expect(result.document.handoffReminderRules[0]).toMatchObject({
        actorMembershipId: seed.nannyMembershipId,
        actorDisplayName: 'Nanny',
        localTime: '08:30',
      });

      const forbidden = [
        'passwordHash', 'password_hash', 'loginName', 'login_name', 'tokenHash', 'token_hash',
        'traceId', 'trace_id', 'clientRequestId', 'client_request_id', 'databaseUrl',
        'evidenceUrl', 'mediaUrl', 'modelOutput',
      ];
      const keys = collectKeys(result.document);
      for (const key of forbidden) expect(keys.has(key), key).toBe(false);
      expect(result.serialized.equals(Buffer.from(JSON.stringify(result.document), 'utf8'))).toBe(true);
    } finally {
      await fixture.app.close();
      await fixture.database.close();
    }
  });

  it('keeps event envelopes and typed payloads wholly pre-edit under a concurrent commit', async () => {
    const fixture = await createM2TestApp(testDatabaseUrl!);
    try {
      const seed = await seedCompleteExport(fixture.database);
      let pauseExport!: () => void;
      let resumeExport!: () => void;
      const paused = new Promise<void>((resolve) => { pauseExport = resolve; });
      const resume = new Promise<void>((resolve) => { resumeExport = resolve; });
      let pausedOnce = false;
      const tracked = trackedSnapshotDatabase(fixture.database, async () => {
        if (pausedOnce) return;
        pausedOnce = true;
        pauseExport();
        await resume;
      });
      const exporting = createFamilyExportService(
        tracked.context,
        createFamilyExportRepository(),
        4 * 1024 * 1024,
      ).exportFamily(exportActor(seed), generatedAt);

      await paused;
      try {
        const edited = await fixture.app.inject({
          method: 'PATCH',
          url: `/api/care/events/${seed.feedingEventId}`,
          headers: { origin: M2_TEST_ORIGIN, cookie: fixture.cookie },
          payload: {
            expectedVersion: 2,
            event: {
              eventType: 'feeding',
              occurredAt: '2026-08-13T07:00:00.000Z',
              note: 'concurrent complete edit',
              components: [
                { kind: 'direct_breastfeeding', durationMinutes: 18 },
                { kind: 'bottle', liquidType: 'formula', amountMl: 70, bottleCapacityMl: 150 },
                { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 30, bottleCapacityMl: 90 },
              ],
              relatedActions: [],
            },
          },
        });
        expect(edited.statusCode).toBe(200);
        expect(edited.json()).toMatchObject({ id: seed.feedingEventId, status: 'active', version: 3 });
      } finally {
        resumeExport();
      }

      const result = await exporting;
      const feeding = result.document.careEvents.find((event) => event.id === seed.feedingEventId);
      expect(feeding).toMatchObject({
        version: 2,
        note: 'synthetic feeding private note',
        payload: {
          components: expect.arrayContaining([
            { kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 },
          ]),
          relatedActions: [{ kind: 'burping' }],
        },
      });
      const exportedFeedingRevisions = result.document.careRevisions
        .filter((revision) => revision.eventId === seed.feedingEventId);
      expect(exportedFeedingRevisions).toHaveLength(1);
      expect(exportedFeedingRevisions[0]).toMatchObject({ fromVersion: 1, toVersion: 2, action: 'edit' });
      expect(exportedFeedingRevisions[0]?.after).toMatchObject({
        eventType: 'feeding',
        components: expect.arrayContaining([
          { kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 },
        ]),
        relatedActions: [{ kind: 'burping' }],
      });
      const committed = await fixture.database.pool.query<{
        amount_ml: number;
        version: number;
        note: string | null;
        revision_count: number;
      }>(
        `select fc.amount_ml, ce.version, ce.note,
                (select count(*)::int from care_event_revisions cr where cr.event_id = ce.id) as revision_count
           from feeding_components fc
           join care_events ce on ce.id = fc.session_event_id
          where fc.session_event_id = $1 and fc.component_type = 'bottle' and fc.liquid_type = 'formula'`,
        [seed.feedingEventId],
      );
      expect(committed.rows[0]).toEqual({
        amount_ml: 70,
        version: 3,
        note: 'concurrent complete edit',
        revision_count: 2,
      });
      expect(tracked.applicationQueries()).toBeLessThanOrEqual(10);
    } finally {
      await fixture.app.close();
      await fixture.database.close();
    }
  });
});
