export interface LoginLimiter {
  allow(key: string): boolean;
}

export function createLoginLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): LoginLimiter {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be positive');

  const buckets = new Map<string, { startedAt: number; count: number }>();

  return {
    allow(key: string): boolean {
      const current = now();
      const bucket = buckets.get(key);

      if (!bucket || current - bucket.startedAt >= windowMs) {
        buckets.set(key, { startedAt: current, count: 1 });
        return true;
      }

      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
  };
}
