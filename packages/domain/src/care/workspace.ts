const BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;

export function isCareEventBackfilled(occurredAt: Date, createdAt: Date): boolean {
  return createdAt.getTime() - occurredAt.getTime() > BACKFILL_THRESHOLD_MS;
}

export function weekdaysToMask(weekdays: readonly number[]): number {
  return weekdays.reduce((mask, weekday) => mask | (1 << (weekday - 1)), 0);
}

export function maskToWeekdays(mask: number): number[] {
  return Array.from({ length: 7 }, (_, index) => index + 1).filter((weekday) => (mask & (1 << (weekday - 1))) !== 0);
}

const weekdayByName: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function isHandoffReminderVisible(input: {
  localTime: string;
  weekdayMask: number;
  enabled: boolean;
  familyTimeZone: string;
  now: Date;
}): boolean {
  if (!input.enabled) return false;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: input.familyTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  }
  const parts = formatter.formatToParts(input.now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = weekdayByName[values.weekday ?? ''];

  return weekday !== undefined
    && (input.weekdayMask & (1 << (weekday - 1))) !== 0
    && `${values.hour}:${values.minute}` === input.localTime;
}
