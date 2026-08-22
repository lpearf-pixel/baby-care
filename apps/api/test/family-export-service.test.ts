import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  FamilyExportSchemaV1,
  type FamilyExportV1,
  type FeedingRelatedActionInput,
} from '@baby-care/contracts';
import type { AuthContext } from '../src/auth/auth-service.js';
import type { DatabaseContext } from '../src/db.js';
import {
  createFamilyExportService,
  FamilyExportTooLargeError,
} from '../src/family/family-export-service.js';
import type {
  FamilyExportRepository,
  FamilyExportRows,
} from '../src/family/family-export-repository.js';
import { createFamilyExportRepository } from '../src/family/family-export-repository.js';
import { StableExportCoordinator } from '../src/family/export-coordinator.js';

const ids = {
  family: '11111111-1111-4111-8111-111111111111',
  baby: '22222222-2222-4222-8222-222222222222',
  dadUser: '33333333-3333-4333-8333-333333333333',
  dadMembership: '44444444-4444-4444-8444-444444444444',
  momUser: '55555555-5555-4555-8555-555555555555',
  momMembership: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777',
  eventTwo: '88888888-8888-4888-8888-888888888888',
  revision: '99999999-9999-4999-8999-999999999999',
  revisionTwo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  checkpoint: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  checkpointTwo: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reminder: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  reminderTwo: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
} as const;

const firstTime = '2026-08-17T08:00:00.000Z';
const secondTime = '2026-08-17T09:00:00.000Z';
const generatedAt = '2026-08-17T10:00:00.000Z';

const actor: AuthContext = {
  familyId: ids.family,
  userId: ids.dadUser,
  membershipId: ids.dadMembership,
  relationship: 'dad',
  permissionLevel: 'family_admin',
};

function validRows(note = '宝宝的私密记录'): FamilyExportRows {
  return {
    family: {
      id: ids.family,
      name: 'Synthetic Family',
      timezone: 'Asia/Shanghai',
      status: 'active',
      createdAt: firstTime,
      updatedAt: firstTime,
    },
    baby: {
      id: ids.baby,
      familyId: ids.family,
      displayName: 'Synthetic Baby',
      birthDate: '2026-08-01',
      status: 'active',
      createdAt: firstTime,
      updatedAt: firstTime,
    },
    members: [{
      membershipId: ids.dadMembership,
      familyId: ids.family,
      userId: ids.dadUser,
      displayName: 'Dad',
      relationship: 'dad',
      permissionLevel: 'family_admin',
      status: 'active',
      createdAt: firstTime,
      updatedAt: firstTime,
    }],
    careEvents: [{
      id: ids.event,
      familyId: ids.family,
      babyId: ids.baby,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      source: 'manual',
      eventType: 'diaper',
      occurredAt: firstTime,
      createdAt: firstTime,
      updatedAt: firstTime,
      status: 'active',
      version: 1,
      note,
      payload: { kind: 'urine', stoolColor: null, stoolConsistency: null, stoolAmount: null },
    }],
    careRevisions: [],
    handoffCheckpoints: [{
      id: ids.checkpoint,
      familyId: ids.family,
      babyId: ids.baby,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      source: 'manual',
      occurredAt: firstTime,
      createdAt: firstTime,
    }],
    handoffReminderRules: [{
      id: ids.reminder,
      familyId: ids.family,
      babyId: ids.baby,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      localTime: '08:30',
      weekdayMask: 31,
      enabled: true,
      createdAt: firstTime,
      updatedAt: firstTime,
    }],
  };
}

function recordingDatabase() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (statement: string) => {
      statements.push(statement.replace(/\s+/g, ' ').trim());
      return { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as pg.PoolClient;
  const poolQuery = vi.fn(async () => {
    throw new Error('family export escaped to database.pool.query');
  });
  const connect = vi.fn(async () => client);
  const database = {
    pool: { connect, query: poolQuery },
  } as unknown as DatabaseContext;
  return { database, client, connect, poolQuery, statements };
}

function repositoryReturning(rows: FamilyExportRows): FamilyExportRepository {
  return { readFamilyExport: vi.fn(async () => rows) };
}

function expectedDocument(rows: FamilyExportRows): FamilyExportV1 {
  return {
    schemaVersion: 1,
    generatedAt,
    ...rows,
  };
}

describe('family export snapshot service', () => {
  it('uses exactly one repeatable-read read-only client and releases it after commit', async () => {
    const fixture = recordingDatabase();
    const repository = repositoryReturning(validRows());
    let generatedAtCalls = 0;
    const callerTime = new Date(generatedAt);
    callerTime.toISOString = () => {
      generatedAtCalls += 1;
      return generatedAt;
    };

    const result = await createFamilyExportService(fixture.database, repository, 1_000_000)
      .exportFamily(actor, callerTime);

    expect(result.document).toEqual(expectedDocument(validRows()));
    expect(result.serialized.equals(Buffer.from(JSON.stringify(result.document), 'utf8'))).toBe(true);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(repository.readFamilyExport).toHaveBeenCalledOnce();
    expect(repository.readFamilyExport).toHaveBeenCalledWith(fixture.client, ids.family);
    expect(fixture.poolQuery).not.toHaveBeenCalled();
    expect(fixture.statements).toEqual([
      'begin isolation level repeatable read read only',
      'set local statement_timeout = 30000',
      'commit',
    ]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
    expect(generatedAtCalls).toBe(1);
  });

  it('rolls back repository query failures and releases the client once', async () => {
    const fixture = recordingDatabase();
    const repository: FamilyExportRepository = {
      readFamilyExport: vi.fn(async () => {
        throw new Error('synthetic repository failure');
      }),
    };

    await expect(createFamilyExportService(fixture.database, repository, 1_000_000)
      .exportFamily(actor, new Date(generatedAt))).rejects.toThrow('synthetic repository failure');

    expect(fixture.statements).toEqual([
      'begin isolation level repeatable read read only',
      'set local statement_timeout = 30000',
      'rollback',
    ]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it('settles rollback and release after the fixed deadline before the actor can retry', async () => {
    vi.useFakeTimers();
    try {
      const fixture = recordingDatabase();
      const repository: FamilyExportRepository = {
        readFamilyExport: vi.fn()
          .mockImplementationOnce(() => new Promise<FamilyExportRows>(() => undefined))
          .mockResolvedValueOnce(validRows()),
      };
      const service = createFamilyExportService(fixture.database, repository, 1_000_000);
      const coordinator = new StableExportCoordinator();
      const operation = coordinator.run(actor.userId, () => (
        service.exportFamily(actor, new Date(generatedAt), new AbortController().signal)
      ));
      const outcome = operation.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(30_000);

      expect(fixture.statements).toEqual([
        'begin isolation level repeatable read read only',
        'set local statement_timeout = 30000',
        'rollback',
      ]);
      expect(fixture.client.release).toHaveBeenCalledOnce();
      expect(await outcome).toMatchObject({ code: 'export_cancelled' });
      await expect(coordinator.run(actor.userId, () => (
        service.exportFamily(actor, new Date(generatedAt), new AbortController().signal)
      ))).resolves.toMatchObject({ serialized: expect.any(Buffer) });
      expect(fixture.client.release).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back strict schema failures and releases the client once', async () => {
    const fixture = recordingDatabase();
    const malformed = validRows() as FamilyExportRows & { family: FamilyExportRows['family'] & { passwordHash?: string } };
    malformed.family.passwordHash = 'must-never-export';

    await expect(createFamilyExportService(fixture.database, repositoryReturning(malformed), 1_000_000)
      .exportFamily(actor, new Date(generatedAt))).rejects.toThrow();

    expect(fixture.statements).toEqual([
      'begin isolation level repeatable read read only',
      'set local statement_timeout = 30000',
      'rollback',
    ]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back serialization failures and releases the client once', async () => {
    const fixture = recordingDatabase();
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('synthetic serialization failure');
    });
    try {
      await expect(createFamilyExportService(fixture.database, repositoryReturning(validRows()), 1_000_000)
        .exportFamily(actor, new Date(generatedAt))).rejects.toThrow('synthetic serialization failure');
    } finally {
      stringify.mockRestore();
    }

    expect(fixture.statements).toEqual([
      'begin isolation level repeatable read read only',
      'set local statement_timeout = 30000',
      'rollback',
    ]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it('measures UTF-8 bytes, accepts the exact bound, and rejects one byte over without truncation', async () => {
    const rows = validRows('宝宝');
    const expected = FamilyExportSchemaV1.parse(expectedDocument(rows));
    const exactBytes = Buffer.byteLength(JSON.stringify(expected), 'utf8');
    expect(JSON.stringify(expected).length).toBeLessThan(exactBytes);

    const exactFixture = recordingDatabase();
    const accepted = await createFamilyExportService(exactFixture.database, repositoryReturning(rows), exactBytes)
      .exportFamily(actor, new Date(generatedAt));
    expect(accepted.serialized.byteLength).toBe(exactBytes);
    expect(accepted.serialized.toString('utf8')).toBe(JSON.stringify(expected));
    expect(exactFixture.statements.at(-1)).toBe('commit');

    const overflowFixture = recordingDatabase();
    await expect(createFamilyExportService(overflowFixture.database, repositoryReturning(rows), exactBytes - 1)
      .exportFamily(actor, new Date(generatedAt))).rejects.toBeInstanceOf(FamilyExportTooLargeError);
    expect(overflowFixture.statements).toEqual([
      'begin isolation level repeatable read read only',
      'set local statement_timeout = 30000',
      'rollback',
    ]);
    expect(overflowFixture.client.release).toHaveBeenCalledOnce();
  });

  it('serializes every collection stably when repository row order changes', async () => {
    const rows = validRows();
    const secondMember: FamilyExportRows['members'][number] = {
      ...rows.members[0]!,
      membershipId: ids.momMembership,
      userId: ids.momUser,
      displayName: 'Mom',
      relationship: 'mom',
    };
    const secondEvent: FamilyExportRows['careEvents'][number] = {
      ...rows.careEvents[0]!,
      id: ids.eventTwo,
      occurredAt: secondTime,
      createdAt: secondTime,
      updatedAt: secondTime,
    };
    const revisions: FamilyExportRows['careRevisions'] = [{
      id: ids.revision,
      eventId: ids.event,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      action: 'edit',
      fromVersion: 1,
      toVersion: 2,
      before: { eventType: 'diaper', occurredAt: firstTime, kind: 'urine' },
      after: { eventType: 'diaper', occurredAt: firstTime, kind: 'stool' },
      createdAt: firstTime,
    }, {
      id: ids.revisionTwo,
      eventId: ids.eventTwo,
      actorUserId: ids.momUser,
      actorMembershipId: ids.momMembership,
      actorDisplayName: 'Mom',
      action: 'void',
      fromVersion: 1,
      toVersion: 2,
      before: { status: 'active' },
      after: { status: 'voided' },
      createdAt: secondTime,
    }];
    const secondCheckpoint: FamilyExportRows['handoffCheckpoints'][number] = {
      ...rows.handoffCheckpoints[0]!,
      id: ids.checkpointTwo,
      actorUserId: ids.momUser,
      actorMembershipId: ids.momMembership,
      actorDisplayName: 'Mom',
      occurredAt: secondTime,
      createdAt: secondTime,
    };
    const secondReminder: FamilyExportRows['handoffReminderRules'][number] = {
      ...rows.handoffReminderRules[0]!,
      id: ids.reminderTwo,
      actorUserId: ids.momUser,
      actorMembershipId: ids.momMembership,
      actorDisplayName: 'Mom',
      localTime: '09:30',
    };
    const ordered: FamilyExportRows = {
      ...rows,
      members: [rows.members[0]!, secondMember],
      careEvents: [rows.careEvents[0]!, secondEvent],
      careRevisions: revisions,
      handoffCheckpoints: [rows.handoffCheckpoints[0]!, secondCheckpoint],
      handoffReminderRules: [rows.handoffReminderRules[0]!, secondReminder],
    };
    const shuffled: FamilyExportRows = {
      ...rows,
      members: [...ordered.members].reverse(),
      careEvents: [...ordered.careEvents].reverse(),
      careRevisions: [...ordered.careRevisions].reverse(),
      handoffCheckpoints: [...ordered.handoffCheckpoints].reverse(),
      handoffReminderRules: [...ordered.handoffReminderRules].reverse(),
    };
    const firstFixture = recordingDatabase();
    const secondFixture = recordingDatabase();

    const first = await createFamilyExportService(firstFixture.database, repositoryReturning(ordered), 1_000_000)
      .exportFamily(actor, new Date(generatedAt));
    const second = await createFamilyExportService(secondFixture.database, repositoryReturning(shuffled), 1_000_000)
      .exportFamily(actor, new Date(generatedAt));

    expect(first.serialized.equals(second.serialized)).toBe(true);
    expect(first.document.members.map((item) => item.relationship)).toEqual(['dad', 'mom']);
    expect(first.document.careEvents.map((item) => item.id)).toEqual([ids.event, ids.eventTwo]);
    expect(first.document.careRevisions.map((item) => item.id)).toEqual([ids.revision, ids.revisionTwo]);
    expect(first.document.handoffCheckpoints.map((item) => item.id)).toEqual([ids.checkpoint, ids.checkpointTwo]);
    expect(first.document.handoffReminderRules.map((item) => item.id)).toEqual([ids.reminder, ids.reminderTwo]);
  });
});

interface RepositoryScenario {
  events: Array<Record<string, unknown>>;
  feeding?: Array<Record<string, unknown>>;
  diapers?: Array<Record<string, unknown>>;
  sleeps?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  revisions?: Array<Record<string, unknown>>;
}

function repositoryClient(scenario: RepositoryScenario): pg.PoolClient {
  const timestamp = new Date(firstTime);
  const household = [{
    family_id: ids.family,
    family_name: 'Synthetic Family',
    family_timezone: 'UTC',
    family_status: 'active',
    family_created_at: timestamp,
    family_updated_at: timestamp,
    baby_id: ids.baby,
    baby_family_id: ids.family,
    baby_display_name: 'Synthetic Baby',
    baby_birth_date: '2026-08-01',
    baby_status: 'active',
    baby_created_at: timestamp,
    baby_updated_at: timestamp,
    membership_id: ids.dadMembership,
    membership_family_id: ids.family,
    member_user_id: ids.dadUser,
    member_display_name: 'Dad',
    relationship: 'dad',
    permission_level: 'family_admin',
    membership_status: 'active',
    membership_created_at: timestamp,
    membership_updated_at: timestamp,
  }];
  const query = vi.fn(async (statement: string) => {
    const sql = statement.replace(/\s+/g, ' ').trim();
    if (sql.includes('from families f')) return { rows: household };
    if (sql.includes('from care_events ce') && sql.includes('ce.event_type::text as event_type')) {
      return { rows: scenario.events };
    }
    if (sql.includes('from feeding_sessions fs')) return { rows: scenario.feeding ?? [] };
    if (sql.includes('from diaper_events de')) return { rows: scenario.diapers ?? [] };
    if (sql.includes('from sleep_intervals si')) return { rows: scenario.sleeps ?? [] };
    if (sql.includes('from care_actions ca') && !sql.includes('union all')) return { rows: scenario.actions ?? [] };
    if (sql.includes('from measurements m')) return { rows: [] };
    if (sql.includes('from care_event_revisions cr')) return { rows: scenario.revisions ?? [] };
    if (sql.includes('from care_handoff_checkpoints hc')) return { rows: [] };
    if (sql.includes('from care_handoff_reminder_rules hr')) return { rows: [] };
    throw new Error(`Unexpected family export repository query: ${sql}`);
  });
  return { query } as unknown as pg.PoolClient;
}

function eventRow(input: {
  id?: string;
  eventType?: string;
  status?: string;
  version?: number;
  occurredAt?: string;
  note?: string | null;
}) {
  return {
    id: input.id ?? ids.event,
    family_id: ids.family,
    baby_id: ids.baby,
    actor_user_id: ids.dadUser,
    actor_membership_id: ids.dadMembership,
    actor_display_name: 'Dad',
    actor_membership_family_id: ids.family,
    actor_membership_user_id: ids.dadUser,
    source: 'manual',
    event_type: input.eventType ?? 'diaper',
    occurred_at: new Date(input.occurredAt ?? secondTime),
    created_at: new Date(firstTime),
    updated_at: new Date(secondTime),
    status: input.status ?? 'active',
    version: input.version ?? 1,
    note: input.note ?? null,
  };
}

function diaperRow(kind: 'urine' | 'stool' = 'stool') {
  return {
    event_id: ids.event,
    event_type: 'diaper',
    kind,
    stool_color: kind === 'stool' ? 'yellow' : null,
    stool_consistency: null,
    stool_amount: null,
  };
}

const feedingUndoIds = {
  spitUpEvent: '10101010-1010-4010-8010-101010101010',
  historicalBurpingEvent: '11111111-1010-4010-8010-101010101010',
  feedingEditRevision: '20202020-2020-4020-8020-202020202020',
  feedingVoidRevision: '30303030-3030-4030-8030-303030303030',
  burpingVoidRevision: '40404040-4040-4040-8040-404040404040',
  spitUpVoidRevision: '50505050-5050-4050-8050-505050505050',
  historicalBurpingVoidRevision: '60606060-6060-4060-8060-606060606060',
} as const;

const feedingUndoTrace = 'family-export-feeding-undo-trace';
const feedingUndoOperationAt = '2026-08-17 09:00:00.123456+00';
const historicalOperationAt = '2026-08-17 08:00:00.654321+00';

function feedingUndoScenario(overrides: {
  note?: string | null;
  amountMl?: number;
  occurredAt?: string;
  parentRelatedActions?: FeedingRelatedActionInput[];
  historicalOperation?: 'different_trace' | 'different_time' | 'different_actor';
} = {}): RepositoryScenario {
  const note = 'latest feeding note';
  const amountMl = 65;
  const preUndo = {
    eventType: 'feeding',
    occurredAt: secondTime,
    note,
    components: [{ kind: 'bottle', liquidType: 'formula', amountMl, bottleCapacityMl: 150 }],
    relatedActions: overrides.parentRelatedActions
      ?? [{ kind: 'burping' }, { kind: 'spit_up', amount: 'medium' }],
  };
  const feedingBase = {
    event_id: ids.event,
    event_type: 'feeding',
    sort_at: null,
    sort_id: ids.event,
    component_type: null,
    liquid_type: null,
    amount_ml: null,
    duration_minutes: null,
    bottle_capacity_ml: null,
    related_event_id: null,
    related_family_id: null,
    related_baby_id: null,
    related_status: null,
    related_event_type: null,
    action_type: null,
    spit_up_amount: null,
  };
  return {
    events: [
      eventRow({
        id: ids.event,
        eventType: 'feeding',
        status: 'voided',
        version: 3,
        note: overrides.note === undefined ? note : overrides.note,
        ...(overrides.occurredAt === undefined ? {} : { occurredAt: overrides.occurredAt }),
      }),
      eventRow({ id: ids.eventTwo, eventType: 'burping', status: 'voided', version: 2 }),
      eventRow({ id: feedingUndoIds.spitUpEvent, eventType: 'spit_up', status: 'voided', version: 2 }),
      eventRow({
        id: feedingUndoIds.historicalBurpingEvent,
        eventType: 'burping',
        status: 'voided',
        version: 2,
        occurredAt: firstTime,
      }),
    ],
    feeding: [
      { ...feedingBase, row_kind: 'session' },
      {
        ...feedingBase,
        row_kind: 'component',
        sort_at: new Date(secondTime),
        component_type: 'bottle',
        liquid_type: 'formula',
        amount_ml: overrides.amountMl ?? amountMl,
        bottle_capacity_ml: 150,
      },
      {
        ...feedingBase,
        row_kind: 'related_action',
        sort_at: new Date(secondTime),
        sort_id: ids.eventTwo,
        related_event_id: ids.eventTwo,
        related_family_id: ids.family,
        related_baby_id: ids.baby,
        related_status: 'voided',
        related_event_type: 'burping',
        action_type: 'burping',
      },
      {
        ...feedingBase,
        row_kind: 'related_action',
        sort_at: new Date(secondTime),
        sort_id: feedingUndoIds.spitUpEvent,
        related_event_id: feedingUndoIds.spitUpEvent,
        related_family_id: ids.family,
        related_baby_id: ids.baby,
        related_status: 'voided',
        related_event_type: 'spit_up',
        action_type: 'spit_up',
        spit_up_amount: 'medium',
      },
      {
        ...feedingBase,
        row_kind: 'related_action',
        sort_at: new Date(firstTime),
        sort_id: feedingUndoIds.historicalBurpingEvent,
        related_event_id: feedingUndoIds.historicalBurpingEvent,
        related_family_id: ids.family,
        related_baby_id: ids.baby,
        related_status: 'voided',
        related_event_type: 'burping',
        action_type: 'burping',
      },
    ],
    actions: [{
      event_id: ids.eventTwo,
      event_type: 'burping',
      action_type: 'burping',
      feeding_session_event_id: ids.event,
      spit_up_amount: null,
      crying_duration_minutes: null,
      medication_name: null,
      medication_dose: null,
      medication_dose_unit: null,
    }, {
      event_id: feedingUndoIds.spitUpEvent,
      event_type: 'spit_up',
      action_type: 'spit_up',
      feeding_session_event_id: ids.event,
      spit_up_amount: 'medium',
      crying_duration_minutes: null,
      medication_name: null,
      medication_dose: null,
      medication_dose_unit: null,
    }, {
      event_id: feedingUndoIds.historicalBurpingEvent,
      event_type: 'burping',
      action_type: 'burping',
      feeding_session_event_id: ids.event,
      spit_up_amount: null,
      crying_duration_minutes: null,
      medication_name: null,
      medication_dose: null,
      medication_dose_unit: null,
    }],
    revisions: [
      revisionRow({
        id: feedingUndoIds.feedingEditRevision,
        action: 'edit',
        fromVersion: 1,
        before: {
          eventType: 'feeding',
          occurredAt: firstTime,
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60 }],
          relatedActions: [],
        },
        after: preUndo,
        traceId: 'family-export-feeding-edit-trace',
      }),
      revisionRow({
        id: feedingUndoIds.feedingVoidRevision,
        action: 'void',
        fromVersion: 2,
        before: preUndo,
        after: { status: 'voided' },
        traceId: feedingUndoTrace,
        operationCreatedAt: feedingUndoOperationAt,
      }),
      revisionRow({
        id: feedingUndoIds.burpingVoidRevision,
        eventId: ids.eventTwo,
        action: 'void',
        fromVersion: 1,
        before: { eventType: 'burping', occurredAt: secondTime, action: { kind: 'burping' } },
        after: { status: 'voided' },
        traceId: feedingUndoTrace,
        operationCreatedAt: feedingUndoOperationAt,
      }),
      revisionRow({
        id: feedingUndoIds.spitUpVoidRevision,
        eventId: feedingUndoIds.spitUpEvent,
        action: 'void',
        fromVersion: 1,
        before: { eventType: 'spit_up', occurredAt: secondTime, action: { kind: 'spit_up', amount: 'medium' } },
        after: { status: 'voided' },
        traceId: feedingUndoTrace,
        operationCreatedAt: feedingUndoOperationAt,
      }),
      revisionRow({
        id: feedingUndoIds.historicalBurpingVoidRevision,
        eventId: feedingUndoIds.historicalBurpingEvent,
        action: 'void',
        fromVersion: 1,
        before: { eventType: 'burping', occurredAt: firstTime, action: { kind: 'burping' } },
        after: { status: 'voided' },
        traceId: overrides.historicalOperation === 'different_trace'
          || overrides.historicalOperation === undefined
          ? 'family-export-older-child-undo-trace'
          : feedingUndoTrace,
        operationCreatedAt: overrides.historicalOperation === 'different_time'
          ? historicalOperationAt
          : feedingUndoOperationAt,
        actor: overrides.historicalOperation === 'different_actor' ? 'mom' : 'dad',
      }),
    ],
  };
}

function feedingUndoWithActiveChildScenario(): RepositoryScenario {
  const scenario = feedingUndoScenario({ parentRelatedActions: [] });
  return {
    ...scenario,
    events: [
      ...scenario.events.filter((row) => row.id === ids.event),
      eventRow({ id: ids.eventTwo, eventType: 'burping', status: 'active', version: 1 }),
    ],
    feeding: (scenario.feeding ?? [])
      .filter((row) => row.row_kind !== 'related_action' || row.related_event_id === ids.eventTwo)
      .map((row) => row.row_kind === 'related_action' ? { ...row, related_status: 'active' } : row),
    actions: (scenario.actions ?? []).filter((row) => row.event_id === ids.eventTwo),
    revisions: (scenario.revisions ?? []).filter((row) => row.event_id === ids.event),
  };
}

function revisionRow(input: {
  id: string;
  eventId?: string;
  action: 'edit' | 'void';
  fromVersion: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  traceId?: string;
  operationCreatedAt?: string;
  actor?: 'dad' | 'mom';
}) {
  const actorUserId = input.actor === 'mom' ? ids.momUser : ids.dadUser;
  const actorMembershipId = input.actor === 'mom' ? ids.momMembership : ids.dadMembership;
  return {
    id: input.id,
    event_id: input.eventId ?? ids.event,
    actor_user_id: actorUserId,
    actor_membership_id: actorMembershipId,
    actor_display_name: input.actor === 'mom' ? 'Mom' : 'Dad',
    actor_membership_family_id: ids.family,
    actor_membership_user_id: actorUserId,
    revision_action: input.action,
    from_version: input.fromVersion,
    to_version: input.fromVersion + 1,
    before_json: input.before,
    after_json: input.after,
    trace_id: input.traceId ?? 'family-export-default-revision-trace',
    operation_created_at: input.operationCreatedAt
      ?? (input.fromVersion === 1 ? '2026-08-17 08:00:00+00' : '2026-08-17 09:00:00+00'),
    created_at: new Date(input.operationCreatedAt ?? (input.fromVersion === 1 ? firstTime : secondTime)),
  };
}

const diaperBefore = {
  eventType: 'diaper',
  occurredAt: firstTime,
  kind: 'urine',
};
const diaperAfter = {
  eventType: 'diaper',
  occurredAt: secondTime,
  note: 'latest note',
  kind: 'stool',
  stoolColor: 'yellow',
};

describe('family export repository revision and relation closure', () => {
  it('accepts feeding undo after its active burping and spit-up relations are cascade-voided', async () => {
    const client = repositoryClient(feedingUndoScenario());

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: expect.arrayContaining([
        expect.objectContaining({
          id: ids.event,
          status: 'voided',
          version: 3,
          note: 'latest feeding note',
          payload: {
            components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 }],
            relatedActions: [],
          },
        }),
        expect.objectContaining({ id: ids.eventTwo, eventType: 'burping', status: 'voided', version: 2 }),
        expect.objectContaining({
          id: feedingUndoIds.spitUpEvent,
          eventType: 'spit_up',
          status: 'voided',
          version: 2,
        }),
        expect.objectContaining({
          id: feedingUndoIds.historicalBurpingEvent,
          eventType: 'burping',
          status: 'voided',
          version: 2,
        }),
      ]),
    });
  });

  it.each([
    ['an earlier operation timestamp', 'different_time'],
    ['a different actor', 'different_actor'],
  ] as const)('excludes a same-trace historical linked child identified by %s', async (_difference, historicalOperation) => {
    const client = repositoryClient(feedingUndoScenario({ historicalOperation }));

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: expect.arrayContaining([
        expect.objectContaining({ id: ids.event, status: 'voided', version: 3 }),
        expect.objectContaining({ id: feedingUndoIds.historicalBurpingEvent, status: 'voided', version: 2 }),
      ]),
    });
  });

  it('rejects a voided feeding that still has an active linked child', async () => {
    const client = repositoryClient(feedingUndoWithActiveChildScenario());

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });

  it.each([
    ['missing spit-up', [{ kind: 'burping' }] as FeedingRelatedActionInput[]],
    ['extra burping', [
      { kind: 'burping' },
      { kind: 'burping' },
      { kind: 'spit_up', amount: 'medium' },
    ] as FeedingRelatedActionInput[]],
    ['wrong spit-up amount', [
      { kind: 'burping' },
      { kind: 'spit_up', amount: 'small' },
    ] as FeedingRelatedActionInput[]],
  ])('rejects feeding undo whose parent void-before has %s relative to same-trace child voids', async (
    _difference,
    parentRelatedActions,
  ) => {
    const client = repositoryClient(feedingUndoScenario({ parentRelatedActions }));

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });

  it.each([
    ['components', { amountMl: 70 }],
    ['note', { note: 'different stored note' }],
    ['occurredAt', { occurredAt: firstTime }],
  ])('still rejects feeding undo when stored %s differ from its void-before snapshot', async (_field, overrides) => {
    const client = repositoryClient(feedingUndoScenario(overrides));

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });

  it('treats offset and UTC revision times for the same instant as causally equal', async () => {
    const offsetSecondTime = '2026-08-17T17:00:00.000+08:00';
    const client = repositoryClient({
      events: [eventRow({ status: 'voided', version: 3, note: 'latest note' })],
      diapers: [diaperRow()],
      revisions: [
        revisionRow({
          id: ids.revision,
          action: 'edit',
          fromVersion: 1,
          before: diaperBefore,
          after: { ...diaperAfter, occurredAt: offsetSecondTime },
        }),
        revisionRow({
          id: ids.revisionTwo,
          action: 'void',
          fromVersion: 2,
          before: { ...diaperAfter, occurredAt: secondTime },
          after: { status: 'voided' },
        }),
      ],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: [{ occurredAt: secondTime, status: 'voided' }],
    });
  });

  it('treats offset and UTC sleep start/end values for the same instants as equal', async () => {
    const endedAt = '2026-08-17T10:00:00.000Z';
    const client = repositoryClient({
      events: [eventRow({ eventType: 'sleep', status: 'active', version: 2, note: null })],
      sleeps: [{
        event_id: ids.event,
        event_type: 'sleep',
        started_at: new Date(secondTime),
        ended_at: new Date(endedAt),
      }],
      revisions: [revisionRow({
        id: ids.revision,
        action: 'edit',
        fromVersion: 1,
        before: { eventType: 'sleep', startedAt: firstTime },
        after: {
          eventType: 'sleep',
          startedAt: '2026-08-17T17:00:00.000+08:00',
          endedAt: '2026-08-17T18:00:00.000+08:00',
        },
      })],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: [{ occurredAt: secondTime, payload: { startedAt: secondTime, endedAt } }],
    });
  });

  it('treats omitted feeding related actions and note as equal to empty and null current values', async () => {
    const direct = {
      event_id: ids.event,
      event_type: 'feeding',
      row_kind: 'component',
      sort_at: new Date(firstTime),
      sort_id: ids.revision,
      component_type: 'direct_breastfeeding',
      liquid_type: null,
      amount_ml: null,
      duration_minutes: 18,
      bottle_capacity_ml: null,
      related_event_id: null,
      related_family_id: null,
      related_baby_id: null,
      related_status: null,
      related_event_type: null,
      action_type: null,
      spit_up_amount: null,
    };
    const bottle = {
      ...direct,
      sort_id: ids.revisionTwo,
      component_type: 'bottle',
      liquid_type: 'formula',
      amount_ml: 65,
      duration_minutes: null,
      bottle_capacity_ml: 150,
    };
    const client = repositoryClient({
      events: [eventRow({ eventType: 'feeding', status: 'active', version: 2, note: null })],
      feeding: [{
        ...direct,
        row_kind: 'session',
        sort_at: null,
        sort_id: ids.event,
        component_type: null,
        duration_minutes: null,
      }, direct, bottle],
      revisions: [revisionRow({
        id: ids.revision,
        action: 'edit',
        fromVersion: 1,
        before: {
          eventType: 'feeding',
          occurredAt: secondTime,
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60 }],
        },
        after: {
          eventType: 'feeding',
          occurredAt: secondTime,
          components: [
            { kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 },
            { kind: 'direct_breastfeeding', durationMinutes: 18 },
          ],
        },
      })],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: [{ note: null, payload: { relatedActions: [] } }],
    });
  });

  it('treats an omitted sleep end and note as equal to null current values', async () => {
    const client = repositoryClient({
      events: [eventRow({ eventType: 'sleep', status: 'active', version: 2, note: null })],
      sleeps: [{
        event_id: ids.event,
        event_type: 'sleep',
        started_at: new Date(secondTime),
        ended_at: null,
      }],
      revisions: [revisionRow({
        id: ids.revision,
        action: 'edit',
        fromVersion: 1,
        before: { eventType: 'sleep', startedAt: firstTime },
        after: { eventType: 'sleep', startedAt: secondTime },
      })],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: [{ note: null, payload: { startedAt: secondTime, endedAt: null } }],
    });
  });

  it('accepts a normalized multi-step edit then void chain whose void-before equals the current typed fact', async () => {
    const client = repositoryClient({
      events: [eventRow({ status: 'voided', version: 3, note: 'latest note' })],
      diapers: [diaperRow()],
      revisions: [
        revisionRow({ id: ids.revision, action: 'edit', fromVersion: 1, before: diaperBefore, after: diaperAfter }),
        revisionRow({
          id: ids.revisionTwo,
          action: 'void',
          fromVersion: 2,
          before: { ...diaperAfter },
          after: { status: 'voided' },
        }),
      ],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family)).resolves.toMatchObject({
      careEvents: [{ id: ids.event, status: 'voided', version: 3 }],
      careRevisions: [{ fromVersion: 1 }, { fromVersion: 2 }],
    });
  });

  it('rejects a revision chain whose normalized edit-after and next void-before snapshots disconnect', async () => {
    const client = repositoryClient({
      events: [eventRow({ status: 'voided', version: 3, note: 'latest note' })],
      diapers: [diaperRow()],
      revisions: [
        revisionRow({ id: ids.revision, action: 'edit', fromVersion: 1, before: diaperBefore, after: diaperAfter }),
        revisionRow({
          id: ids.revisionTwo,
          action: 'void',
          fromVersion: 2,
          before: { ...diaperBefore, occurredAt: secondTime },
          after: { status: 'voided' },
        }),
      ],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });

  it('rejects an active event whose latest normalized edit-after snapshot differs from the current typed fact', async () => {
    const client = repositoryClient({
      events: [eventRow({ status: 'active', version: 2, note: 'current note' })],
      diapers: [diaperRow('urine')],
      revisions: [
        revisionRow({ id: ids.revision, action: 'edit', fromVersion: 1, before: diaperBefore, after: diaperAfter }),
      ],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });

  it('rejects a voided crying action linked to a feeding before omitting it from related actions', async () => {
    const cryingId = ids.eventTwo;
    const cryingSnapshot = {
      eventType: 'crying',
      occurredAt: secondTime,
      action: { kind: 'crying', durationMinutes: 5 },
    };
    const client = repositoryClient({
      events: [
        eventRow({ id: ids.event, eventType: 'feeding', occurredAt: firstTime }),
        eventRow({ id: cryingId, eventType: 'crying', status: 'voided', version: 2 }),
      ],
      feeding: [{
        event_id: ids.event,
        event_type: 'feeding',
        row_kind: 'session',
        sort_at: null,
        sort_id: ids.event,
        component_type: null,
        liquid_type: null,
        amount_ml: null,
        duration_minutes: null,
        bottle_capacity_ml: null,
        related_event_id: null,
        related_family_id: null,
        related_baby_id: null,
        related_status: null,
        related_event_type: null,
        action_type: null,
        spit_up_amount: null,
      }, {
        event_id: ids.event,
        event_type: 'feeding',
        row_kind: 'component',
        sort_at: new Date(firstTime),
        sort_id: ids.event,
        component_type: 'bottle',
        liquid_type: 'formula',
        amount_ml: 60,
        duration_minutes: null,
        bottle_capacity_ml: 120,
        related_event_id: null,
        related_family_id: null,
        related_baby_id: null,
        related_status: null,
        related_event_type: null,
        action_type: null,
        spit_up_amount: null,
      }, {
        event_id: ids.event,
        event_type: 'feeding',
        row_kind: 'related_action',
        sort_at: new Date(secondTime),
        sort_id: cryingId,
        component_type: null,
        liquid_type: null,
        amount_ml: null,
        duration_minutes: null,
        bottle_capacity_ml: null,
        related_event_id: cryingId,
        related_family_id: ids.family,
        related_baby_id: ids.baby,
        related_status: 'voided',
        related_event_type: 'crying',
        action_type: 'crying',
        spit_up_amount: null,
      }],
      actions: [{
        event_id: cryingId,
        event_type: 'crying',
        action_type: 'crying',
        feeding_session_event_id: ids.event,
        spit_up_amount: null,
        crying_duration_minutes: 5,
        medication_name: null,
        medication_dose: null,
        medication_dose_unit: null,
      }],
      revisions: [revisionRow({
        id: ids.revision,
        eventId: cryingId,
        action: 'void',
        fromVersion: 1,
        before: cryingSnapshot,
        after: { status: 'voided' },
      })],
    });

    await expect(createFamilyExportRepository().readFamilyExport(client, ids.family))
      .rejects.toThrow('Family export validation failed');
  });
});
