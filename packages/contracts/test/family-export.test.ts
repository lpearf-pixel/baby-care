import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  compareFamilyExportCareEvents,
  compareFamilyExportCareRevisions,
  compareFamilyExportHandoffCheckpoints,
  compareFamilyExportHandoffReminderRules,
  compareFamilyExportMembers,
  FAMILY_EXPORT_SCHEMA_VERSION,
  FamilyExportSchemaV1,
  familyExportFilename,
} from '../src/index.js';
import type {
  FamilyExportCareEvent,
  FamilyExportCareRevision,
  FamilyExportHandoffCheckpoint,
  FamilyExportHandoffReminderRule,
  FamilyExportMember,
} from '../src/index.js';

const ids = {
  family: '11111111-1111-4111-8111-111111111111',
  baby: '22222222-2222-4222-8222-222222222222',
  dadUser: '33333333-3333-4333-8333-333333333333',
  dadMembership: '44444444-4444-4444-8444-444444444444',
  momUser: '55555555-5555-4555-8555-555555555555',
  momMembership: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777',
  revision: '88888888-8888-4888-8888-888888888888',
  checkpoint: '99999999-9999-4999-8999-999999999999',
  reminder: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const occurredAt = '2026-08-17T23:59:59.000Z';
const createdAt = '2026-08-18T00:00:00.000Z';

function event(eventType: string, payload: Record<string, unknown>, suffix: string) {
  return {
    id: `77777777-7777-4777-8777-7777777777${suffix}`,
    familyId: ids.family,
    babyId: ids.baby,
    actorUserId: ids.dadUser,
    actorMembershipId: ids.dadMembership,
    actorDisplayName: 'Dad',
    source: 'manual',
    eventType,
    occurredAt,
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    version: 1,
    note: 'Private care detail',
    payload,
  };
}

function validExport() {
  return {
    schemaVersion: FAMILY_EXPORT_SCHEMA_VERSION,
    generatedAt: createdAt,
    family: {
      id: ids.family,
      name: 'The Example Family',
      timezone: 'UTC',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    baby: {
      id: ids.baby,
      familyId: ids.family,
      displayName: 'Baby',
      birthDate: '2026-08-01',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    members: [{
      membershipId: ids.dadMembership,
      familyId: ids.family,
      userId: ids.dadUser,
      displayName: 'Dad',
      relationship: 'dad',
      permissionLevel: 'family_admin',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    }],
    careEvents: [
      event('feeding', { components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 120 }], relatedActions: [] }, '01'),
      event('diaper', { kind: 'urine', stoolColor: null, stoolConsistency: null, stoolAmount: null }, '02'),
      event('sleep', { startedAt: occurredAt, endedAt: null }, '03'),
      event('burping', { action: { kind: 'burping' } }, '04'),
      event('spit_up', { action: { kind: 'spit_up', amount: 'small' } }, '05'),
      event('crying', { action: { kind: 'crying', durationMinutes: 5 } }, '06'),
      event('bathing', { action: { kind: 'bathing' } }, '07'),
      event('medication', { action: { kind: 'medication', medicationName: 'Vitamin D', dose: 1, doseUnit: 'mL' } }, '08'),
      event('temperature', { measurement: { kind: 'temperature', valueCelsius: 37.1, method: 'axillary' } }, '09'),
      event('weight', { measurement: { kind: 'weight', valueKg: 3.4 } }, '10'),
    ],
    careRevisions: [{
      id: ids.revision,
      eventId: ids.event,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      action: 'edit',
      fromVersion: 1,
      toVersion: 2,
      before: { eventType: 'diaper', occurredAt, kind: 'urine' },
      after: { eventType: 'diaper', occurredAt, kind: 'stool' },
      createdAt,
    }],
    handoffCheckpoints: [{
      id: ids.checkpoint,
      familyId: ids.family,
      babyId: ids.baby,
      actorUserId: ids.dadUser,
      actorMembershipId: ids.dadMembership,
      actorDisplayName: 'Dad',
      source: 'manual',
      occurredAt,
      createdAt,
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
      createdAt,
      updatedAt: createdAt,
    }],
  };
}

function withUnknownField(collection: keyof ReturnType<typeof validExport>, key: string) {
  const document = validExport() as Record<string, unknown>;
  const value = document[collection];
  document[collection] = Array.isArray(value)
    ? [{ ...value[0], [key]: 'private' }, ...value.slice(1)]
    : { ...(value as Record<string, unknown>), [key]: 'private' };
  return document;
}

describe('M4 family export contract', () => {
  it('accepts one strict, complete export containing all ten typed care events', () => {
    const parsed = FamilyExportSchemaV1.parse(validExport());

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.careEvents.map((item) => item.eventType)).toEqual([
      'feeding', 'diaper', 'sleep', 'burping', 'spit_up', 'crying', 'bathing', 'medication', 'temperature', 'weight',
    ]);
  });

  it.each([
    ['family', 'passwordHash'],
    ['baby', 'databaseUrl'],
    ['members', 'loginName'],
    ['careEvents', 'traceId'],
    ['careEvents', 'clientRequestId'],
    ['careRevisions', 'traceId'],
    ['handoffCheckpoints', 'tokenHash'],
    ['handoffReminderRules', 'evidenceUrl'],
    ['handoffReminderRules', 'mediaUrl'],
    ['handoffReminderRules', 'modelOutput'],
  ] as const)('rejects %s unknown field %s so private internals cannot enter exports', (collection, key) => {
    expect(FamilyExportSchemaV1.safeParse(withUnknownField(collection, key)).success).toBe(false);
  });

  it('rejects malformed provenance, timestamps, statuses, sources, and revision version edges', () => {
    const malformedActor = validExport();
    malformedActor.careEvents[0]!.actorUserId = 'not-a-uuid';
    expect(FamilyExportSchemaV1.safeParse(malformedActor).success).toBe(false);

    const malformedSource = validExport();
    malformedSource.careEvents[0]!.source = 'diagnostic';
    expect(FamilyExportSchemaV1.safeParse(malformedSource).success).toBe(false);

    const malformedStatus = validExport();
    malformedStatus.careEvents[0]!.status = 'archived';
    expect(FamilyExportSchemaV1.safeParse(malformedStatus).success).toBe(false);

    const malformedTime = validExport();
    malformedTime.careEvents[0]!.occurredAt = '2026-08-17 23:59:59';
    expect(FamilyExportSchemaV1.safeParse(malformedTime).success).toBe(false);

    const zeroFromVersion = validExport();
    zeroFromVersion.careRevisions[0]!.fromVersion = 0;
    expect(FamilyExportSchemaV1.safeParse(zeroFromVersion).success).toBe(false);

    const nonSequentialVersion = validExport();
    nonSequentialVersion.careRevisions[0]!.toVersion = 3;
    expect(FamilyExportSchemaV1.safeParse(nonSequentialVersion).success).toBe(false);
  });

  it.each(['export_too_large', 'export_in_progress', 'export_failed'] as const)(
    'keeps %s in the closed API error contract',
    (code) => {
      expect(ApiErrorSchema.safeParse({ code, message: 'Export unavailable.', traceId: randomUUID() }).success).toBe(true);
    },
  );

  it('creates a generic UTC filename at the date boundary without family or baby identity', () => {
    const filename = familyExportFilename(new Date('2026-08-17T23:59:59.999-08:00'));

    expect(filename).toMatch(/^baby-care-export-\d{8}T\d{6}Z\.json$/);
    expect(filename).toBe('baby-care-export-20260818T075959Z.json');
    expect(filename).not.toContain('Example');
    expect(filename).not.toContain(ids.family);
  });

  it('sorts every export collection by its explicit stable tuple', () => {
    const document = FamilyExportSchemaV1.parse(validExport());
    const [firstEvent] = document.careEvents;
    const [firstRevision] = document.careRevisions;
    const [firstCheckpoint] = document.handoffCheckpoints;
    const [firstReminder] = document.handoffReminderRules;
    const [firstMember] = document.members;

    const members: FamilyExportMember[] = [
      { ...firstMember!, relationship: 'nanny', membershipId: ids.momMembership },
      { ...firstMember!, relationship: 'dad', membershipId: ids.momMembership },
      { ...firstMember!, relationship: 'dad', membershipId: ids.dadMembership },
    ];
    expect(members.sort(compareFamilyExportMembers).map((member) => `${member.relationship}:${member.membershipId}`)).toEqual([
      `dad:${ids.dadMembership}`, `dad:${ids.momMembership}`, `nanny:${ids.momMembership}`,
    ]);
    const events: FamilyExportCareEvent[] = [
      { ...firstEvent!, id: ids.event, occurredAt: '2026-08-17T10:00:00.000Z', createdAt },
      { ...firstEvent!, id: ids.momUser, occurredAt: '2026-08-17T09:00:00.000Z', createdAt },
      { ...firstEvent!, id: ids.dadUser, occurredAt: '2026-08-17T10:00:00.000Z', createdAt: occurredAt },
    ];
    expect(events.sort(compareFamilyExportCareEvents).map((item) => item.id)).toEqual([ids.momUser, ids.dadUser, ids.event]);
    const revisions: FamilyExportCareRevision[] = [
      { ...firstRevision!, id: ids.revision, eventId: ids.momUser, fromVersion: 2 },
      { ...firstRevision!, id: ids.momMembership, eventId: ids.dadUser, fromVersion: 2 },
      { ...firstRevision!, id: ids.dadMembership, eventId: ids.dadUser, fromVersion: 1 },
    ];
    expect(revisions.sort(compareFamilyExportCareRevisions).map((item) => item.id)).toEqual([ids.dadMembership, ids.momMembership, ids.revision]);
    const checkpoints: FamilyExportHandoffCheckpoint[] = [
      { ...firstCheckpoint!, id: ids.event, occurredAt: '2026-08-17T10:00:00.000Z', createdAt },
      { ...firstCheckpoint!, id: ids.momUser, occurredAt: '2026-08-17T09:00:00.000Z', createdAt },
      { ...firstCheckpoint!, id: ids.dadUser, occurredAt: '2026-08-17T10:00:00.000Z', createdAt: occurredAt },
    ];
    expect(checkpoints.sort(compareFamilyExportHandoffCheckpoints).map((item) => item.id)).toEqual([ids.momUser, ids.dadUser, ids.event]);
    const reminders: FamilyExportHandoffReminderRule[] = [
      { ...firstReminder!, id: ids.event, actorMembershipId: ids.momMembership, localTime: '09:00', weekdayMask: 1 },
      { ...firstReminder!, id: ids.momUser, actorMembershipId: ids.dadMembership, localTime: '09:00', weekdayMask: 1 },
      { ...firstReminder!, id: ids.dadUser, actorMembershipId: ids.dadMembership, localTime: '08:00', weekdayMask: 1 },
    ];
    expect(reminders.sort(compareFamilyExportHandoffReminderRules).map((item) => item.id)).toEqual([ids.dadUser, ids.momUser, ids.event]);
  });
});
