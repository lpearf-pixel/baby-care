import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CareTimelineItemDtoSchema,
  CareTimelineQuerySchema,
  CareWarningSchema,
  CareWriteMetaInputSchema,
  CareHandoffBriefingDtoSchema,
  CreateCareHandoffInputSchema,
  ReplaceHandoffReminderRulesInputSchema,
  SleepIntervalDtoSchema,
  UndoCareEventRequestSchema,
  UpdateCareEventRequestSchema,
} from '../src/index.js';

describe('M2 care contracts', () => {
  it('keeps care write metadata strict and server-owned identity out of client input', () => {
    const clientRequestId = randomUUID();
    const parsed = CareWriteMetaInputSchema.parse({
      occurredAt: '2026-08-13T08:00:00.000Z',
      clientRequestId,
    });

    expect(parsed).toEqual({ occurredAt: '2026-08-13T08:00:00.000Z', clientRequestId });
    expect(
      CareWriteMetaInputSchema.safeParse({
        occurredAt: '2026-08-13T08:00:00.000Z',
        clientRequestId,
        actorUserId: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it('uses the reviewed warning vocabulary and only exposes warning details on confirmation errors', () => {
    const warning = {
      code: 'possible_duplicate',
      summary: 'A similar care record was saved recently.',
      recentEventId: randomUUID(),
    } as const;

    expect(CareWarningSchema.safeParse(warning).success).toBe(true);
    expect(
      ApiErrorSchema.safeParse({
        code: 'care_confirmation_required',
        message: 'Confirm the warning before saving.',
        traceId: randomUUID(),
        details: { warnings: [warning] },
      }).success,
    ).toBe(true);

    expect(
      ApiErrorSchema.safeParse({
        code: 'care_confirmation_required',
        message: 'Confirm the warning before saving.',
        traceId: randomUUID(),
        details: { warnings: [warning], carePayload: { medicationName: 'private' } },
      }).success,
    ).toBe(false);
  });
});

describe('M3 care workspace contracts', () => {
  it('returns the authoritative version with a sleep write receipt', () => {
    expect(SleepIntervalDtoSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-08-13T07:20:00.000Z',
      status: 'active',
      startedAt: '2026-08-13T07:20:00.000Z',
      endedAt: '2026-08-13T07:40:00.000Z',
      note: null,
      version: 3,
    }).version).toBe(3);
  });

  it('accepts only client-owned handoff fields and validates reminder schedules', () => {
    const clientRequestId = randomUUID();

    expect(CreateCareHandoffInputSchema.safeParse({
      occurredAt: '2026-08-16T09:00:00+08:00',
      clientRequestId,
      actorUserId: 'forged',
    }).success).toBe(false);
    expect(CreateCareHandoffInputSchema.safeParse({
      occurredAt: '2026-08-16T09:00:00+08:00',
      clientRequestId,
    }).success).toBe(true);
    expect(ReplaceHandoffReminderRulesInputSchema.safeParse({
      rules: [{ localTime: '08:30', weekdays: [1, 2, 3, 4, 5], enabled: true }],
    }).success).toBe(true);
    expect(ReplaceHandoffReminderRulesInputSchema.safeParse({
      rules: [{ localTime: '24:00', weekdays: [1, 1], enabled: true }],
    }).success).toBe(false);

    const checkpoint = {
      id: randomUUID(),
      occurredAt: '2026-08-16T09:00:00.000Z',
      createdAt: '2026-08-16T09:00:01.000Z',
      actorUserId: randomUUID(),
      actorDisplayName: 'Dad',
      source: 'manual',
    };
    expect(CareHandoffBriefingDtoSchema.safeParse({
      checkpoint,
      previousCheckpoint: null,
      window: { mode: 'rolling_24h', from: '2026-08-15T09:00:00.000Z', to: checkpoint.occurredAt },
      careState: {
        asOf: checkpoint.occurredAt,
        lastFeeding: null,
        lastDiaper: null,
        rolling24h: {
          bottleTotalMl: 0,
          expressedBreastMilkMl: 0,
          formulaMl: 0,
          directBreastfeedingSessions: 0,
          directBreastfeedingMinutes: 0,
        },
        currentSleep: null,
      },
      feeding: {
        bottleTotalMl: 0,
        expressedBreastMilkMl: 0,
        formulaMl: 0,
        directBreastfeedingSessions: 0,
        directBreastfeedingMinutes: 0,
      },
      diapers: { urine: 0, stool: 0, urineStool: 0 },
      sleep: { intervals: 0, completedMinutes: 0 },
      notableEvents: [],
      notableEventCount: 0,
      actorActivity: [],
      corrections: [],
      correctionCount: 0,
    }).success).toBe(true);
  });

  it('makes timeline filters exclusive and requires a typed payload with a version', () => {
    expect(CareTimelineQuerySchema.safeParse({
      before: '2026-08-16T09:00:00.000Z',
      cursor: 'opaque-cursor',
    }).success).toBe(false);

    expect(CareTimelineItemDtoSchema.safeParse({
      id: randomUUID(),
      eventType: 'feeding',
      occurredAt: '2026-08-16T08:00:00.000Z',
      createdAt: '2026-08-16T08:05:01.000Z',
      updatedAt: '2026-08-16T08:05:01.000Z',
      status: 'active',
      source: 'manual',
      actorUserId: randomUUID(),
      actorDisplayName: 'Dad',
      note: null,
      version: 1,
      isBackfilled: true,
      payload: {
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60 }],
        relatedActions: [],
      },
    }).success).toBe(true);

    expect(CareTimelineItemDtoSchema.safeParse({
      id: randomUUID(),
      eventType: 'feeding',
      occurredAt: '2026-08-16T08:00:00.000Z',
      createdAt: '2026-08-16T08:05:01.000Z',
      updatedAt: '2026-08-16T08:05:01.000Z',
      status: 'active',
      source: 'manual',
      actorUserId: randomUUID(),
      actorDisplayName: 'Dad',
      note: null,
      isBackfilled: true,
    }).success).toBe(false);

    expect(CareTimelineItemDtoSchema.safeParse({
      id: randomUUID(),
      eventType: 'burping',
      occurredAt: '2026-08-16T08:00:00.000Z',
      createdAt: '2026-08-16T08:00:00.000Z',
      updatedAt: '2026-08-16T08:00:00.000Z',
      status: 'active',
      source: 'manual',
      actorUserId: randomUUID(),
      actorDisplayName: 'Dad',
      note: null,
      version: 1,
      isBackfilled: false,
      payload: { action: { kind: 'bathing' } },
    }).success).toBe(false);
  });

  it('requires the current version for historical edits and undo', () => {
    expect(UpdateCareEventRequestSchema.safeParse({
      expectedVersion: 1,
      event: {
        eventType: 'diaper',
        occurredAt: '2026-08-16T08:00:00.000Z',
        kind: 'urine',
      },
    }).success).toBe(true);
    expect(UndoCareEventRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
  });
});
