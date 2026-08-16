import { describe, expect, it } from 'vitest';
import * as Domain from '../src/index.js';

type BottleAmountHistory = { amountMl: number; occurredAt: Date };
type DuplicateCandidate = { eventType: string; occurredAt: Date; fingerprint: string; eventId?: string };
type CareRuleWarning = { code: string; summary: string; recentEventId?: string } | null;

function rank(records: readonly BottleAmountHistory[]): number[] {
  const fn = (Domain as unknown as Record<string, unknown>).rankRecentBottleAmounts as
    | ((items: readonly BottleAmountHistory[]) => number[])
    | undefined;
  expect(fn, 'rankRecentBottleAmounts export is missing').toBeDefined();
  return fn!(records);
}

function validateTime(occurredAt: Date, now: Date) {
  const fn = (Domain as unknown as Record<string, unknown>).validateOccurredAt as
    | ((value: Date, reference: Date) => unknown)
    | undefined;
  expect(fn, 'validateOccurredAt export is missing').toBeDefined();
  return fn!(occurredAt, now);
}

function duplicate(candidate: DuplicateCandidate, recent: readonly DuplicateCandidate[]): CareRuleWarning {
  const fn = (Domain as unknown as Record<string, unknown>).findDuplicateWarning as
    | ((value: DuplicateCandidate, items: readonly DuplicateCandidate[]) => CareRuleWarning)
    | undefined;
  expect(fn, 'findDuplicateWarning export is missing').toBeDefined();
  return fn!(candidate, recent);
}

function bottleSanity(amountMl: number, recentAmounts: readonly number[]): CareRuleWarning {
  const fn = (Domain as unknown as Record<string, unknown>).findBottleSanityWarning as
    | ((value: number, items: readonly number[]) => CareRuleWarning)
    | undefined;
  expect(fn, 'findBottleSanityWarning export is missing').toBeDefined();
  return fn!(amountMl, recentAmounts);
}

describe('M2 deterministic care rules', () => {
  it('ranks exact bottle amounts by frequency then newest use and returns at most three', () => {
    expect(rank([
      { amountMl: 60, occurredAt: new Date('2026-08-13T10:00:00Z') },
      { amountMl: 50, occurredAt: new Date('2026-08-13T09:00:00Z') },
      { amountMl: 60, occurredAt: new Date('2026-08-13T08:00:00Z') },
      { amountMl: 40, occurredAt: new Date('2026-08-13T07:00:00Z') },
      { amountMl: 50, occurredAt: new Date('2026-08-13T06:00:00Z') },
      { amountMl: 30, occurredAt: new Date('2026-08-13T05:00:00Z') },
    ])).toEqual([60, 50, 40]);
  });

  it('ignores records older than the newest twenty before ranking', () => {
    const base = Date.parse('2026-08-13T10:00:00Z');
    const newestTwenty = Array.from({ length: 20 }, (_, index) => ({
      amountMl: index + 1,
      occurredAt: new Date(base - index * 60_000),
    }));
    expect(rank([
      ...newestTwenty,
      { amountMl: 20, occurredAt: new Date(base - 20 * 60_000) },
    ])).toEqual([1, 2, 3]);
  });

  it('accepts five minutes of future clock skew and softly warns backfills older than 24 hours', () => {
    const now = new Date('2026-08-13T10:00:00.000Z');
    expect(validateTime(new Date('2026-08-13T10:05:00.000Z'), now)).toEqual({ ok: true, warning: null });
    expect(validateTime(new Date('2026-08-13T10:05:00.001Z'), now)).toEqual({ ok: false, reason: 'future_timestamp' });
    expect(validateTime(new Date('2026-08-12T10:00:00.000Z'), now)).toEqual({ ok: true, warning: null });
    expect(validateTime(new Date('2026-08-12T09:59:59.999Z'), now)).toEqual({ ok: true, warning: 'old_backfill' });
  });

  it('warns only for exact-fingerprint candidates within five minutes', () => {
    const candidate = {
      eventType: 'feeding',
      occurredAt: new Date('2026-08-13T10:00:00Z'),
      fingerprint: 'feeding:bottle:formula:60',
    };
    const recent = {
      eventType: 'feeding',
      occurredAt: new Date('2026-08-13T09:56:00Z'),
      fingerprint: 'feeding:bottle:formula:60',
      eventId: 'recent-event',
    };
    expect(duplicate(candidate, [recent])).toMatchObject({ code: 'possible_duplicate', recentEventId: 'recent-event' });
    expect(duplicate(candidate, [{ ...recent, fingerprint: 'feeding:bottle:formula:50' }])).toBeNull();
    expect(duplicate(candidate, [{ ...recent, occurredAt: new Date('2026-08-13T09:54:59Z') }])).toBeNull();
  });

  it('uses a median-based unusual bottle warning only with at least three positive history values', () => {
    expect(bottleSanity(180, [60, 60, 70])).toMatchObject({ code: 'unusual_value' });
    expect(bottleSanity(20, [60, 60, 70])).toMatchObject({ code: 'unusual_value' });
    expect(bottleSanity(120, [60, 60, 70])).toBeNull();
    expect(bottleSanity(600, [60, 70])).toBeNull();
  });
});
