export type CareRuleWarningCode = 'possible_duplicate' | 'unusual_value' | 'sleep_overlap' | 'old_backfill';

export interface CareRuleWarning {
  code: CareRuleWarningCode;
  summary: string;
  recentEventId?: string;
}

export interface DuplicateCandidate {
  eventType: string;
  occurredAt: Date;
  fingerprint: string;
  eventId?: string;
}

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export function findDuplicateWarning(
  candidate: DuplicateCandidate,
  recent: readonly DuplicateCandidate[],
): CareRuleWarning | null {
  const match = recent
    .filter((item) =>
      item.eventType === candidate.eventType &&
      item.fingerprint === candidate.fingerprint &&
      Math.abs(item.occurredAt.getTime() - candidate.occurredAt.getTime()) <= DUPLICATE_WINDOW_MS,
    )
    .sort((a, b) => {
      const aDistance = Math.abs(a.occurredAt.getTime() - candidate.occurredAt.getTime());
      const bDistance = Math.abs(b.occurredAt.getTime() - candidate.occurredAt.getTime());
      return aDistance - bDistance || b.occurredAt.getTime() - a.occurredAt.getTime();
    })[0];

  if (!match) return null;
  return {
    code: 'possible_duplicate',
    summary: 'A similar record was saved within five minutes.',
    ...(match.eventId ? { recentEventId: match.eventId } : {}),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

export function findBottleSanityWarning(
  amountMl: number,
  recentAmounts: readonly number[],
): CareRuleWarning | null {
  if (!Number.isFinite(amountMl) || amountMl <= 0) return null;
  const positiveHistory = recentAmounts.filter((value) => Number.isFinite(value) && value > 0);
  if (positiveHistory.length < 3) return null;

  const typical = median(positiveHistory);
  if (amountMl < typical * 3 && amountMl > typical / 3) return null;

  return {
    code: 'unusual_value',
    summary: 'This value differs substantially from recent recorded values.',
  };
}

export function careFingerprint(...parts: readonly (string | number)[]): string {
  return parts.join(':');
}
