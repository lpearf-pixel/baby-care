import type pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FeedingComponentInput } from '@baby-care/contracts';
import { feedingComponents, feedingSessions } from '../schema.js';

export async function persistFeedingComponents(
  client: pg.PoolClient,
  eventId: string,
  occurredAt: Date,
  components: readonly FeedingComponentInput[],
): Promise<void> {
  const orm = drizzle({ client });
  await orm.insert(feedingSessions).values({ eventId });
  for (const component of components) {
    if (component.kind === 'direct_breastfeeding') {
      await orm.insert(feedingComponents).values({
        sessionEventId: eventId,
        componentType: 'direct_breastfeeding',
        durationMinutes: component.durationMinutes,
        occurredAt,
      });
    } else {
      await orm.insert(feedingComponents).values({
        sessionEventId: eventId,
        componentType: 'bottle',
        liquidType: component.liquidType,
        amountMl: component.amountMl,
        bottleCapacityMl: component.bottleCapacityMl,
        occurredAt,
      });
    }
  }
}
