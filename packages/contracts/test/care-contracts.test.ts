import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CareWarningSchema,
  CareWriteMetaInputSchema,
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
