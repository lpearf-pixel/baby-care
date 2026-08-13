export interface BottleAmountHistory {
  amountMl: number;
  occurredAt: Date;
}

interface RankedAmount {
  amountMl: number;
  count: number;
  newestAtMs: number;
}

export function rankRecentBottleAmounts(records: readonly BottleAmountHistory[]): number[] {
  const newestTwenty = [...records]
    .filter((record) => Number.isFinite(record.amountMl) && record.amountMl > 0)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 20);

  const grouped = new Map<number, RankedAmount>();
  for (const record of newestTwenty) {
    const occurredAtMs = record.occurredAt.getTime();
    const existing = grouped.get(record.amountMl);
    if (existing) {
      existing.count += 1;
      existing.newestAtMs = Math.max(existing.newestAtMs, occurredAtMs);
    } else {
      grouped.set(record.amountMl, {
        amountMl: record.amountMl,
        count: 1,
        newestAtMs: occurredAtMs,
      });
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.newestAtMs - a.newestAtMs || a.amountMl - b.amountMl)
    .slice(0, 3)
    .map((entry) => entry.amountMl);
}
