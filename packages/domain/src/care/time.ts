const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const OLD_BACKFILL_MS = 24 * 60 * 60 * 1000;

export type OccurredAtValidation =
  | { ok: true; warning: null | 'old_backfill' }
  | { ok: false; reason: 'future_timestamp' };

export function validateOccurredAt(occurredAt: Date, now: Date): OccurredAtValidation {
  const occurredAtMs = occurredAt.getTime();
  const nowMs = now.getTime();

  if (occurredAtMs > nowMs + FUTURE_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'future_timestamp' };
  }

  return {
    ok: true,
    warning: occurredAtMs < nowMs - OLD_BACKFILL_MS ? 'old_backfill' : null,
  };
}
