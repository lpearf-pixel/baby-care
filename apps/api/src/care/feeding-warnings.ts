import type pg from 'pg';
import type { CareWarning, CreateFeedingSessionInput } from '@baby-care/contracts';
import { findBottleSanityWarning, validateOccurredAt } from '@baby-care/domain';
import type { CareActorContext } from './care-auth.js';
import { CareValidationError } from './care-errors.js';
import { recentBottleHistory } from './feeding-history.js';
import { findNearbyBottleEvent } from './feeding-nearby-bottle.js';
import { findNearbyDirectEvent } from './feeding-nearby-direct.js';

export async function collectFeedingWarnings(
  pool: pg.Pool,
  actor: CareActorContext,
  input: CreateFeedingSessionInput,
  now: Date,
): Promise<CareWarning[]> {
  const occurredAt = new Date(input.occurredAt);
  const timeResult = validateOccurredAt(occurredAt, now);
  if (!timeResult.ok) throw new CareValidationError('occurredAt is too far in the future.');

  const warnings: CareWarning[] = [];
  if (timeResult.warning === 'old_backfill') {
    warnings.push({ code: 'old_backfill', summary: 'This record is more than 24 hours old.' });
  }

  for (const component of input.components) {
    if (component.kind === 'bottle') {
      const history = await recentBottleHistory(pool, actor, component.liquidType);
      const unusual = findBottleSanityWarning(component.amountMl, history.map((item) => item.amountMl));
      if (unusual) warnings.push(unusual);
      const nearby = await findNearbyBottleEvent(pool, actor, occurredAt, component.liquidType, component.amountMl);
      if (nearby) warnings.push({
        code: 'possible_duplicate',
        summary: 'A similar bottle record was saved within five minutes.',
        recentEventId: nearby,
      });
    } else {
      const nearby = await findNearbyDirectEvent(pool, actor, occurredAt, component.durationMinutes);
      if (nearby) warnings.push({
        code: 'possible_duplicate',
        summary: 'A similar direct feeding record was saved within five minutes.',
        recentEventId: nearby,
      });
    }
  }

  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.recentEventId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
