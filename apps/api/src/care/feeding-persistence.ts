import type pg from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FeedingComponentInput } from '@baby-care/contracts';
import { feedingComponents, feedingSessions } from '../schema.js';

async function insertComponents(
  client: pg.PoolClient,
  eventId: string,
  occurredAt: Date,
  components: readonly FeedingComponentInput[],
): Promise<void> {
  const orm = drizzle({ client });
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

export async function persistFeedingComponents(
  client: pg.PoolClient,
  eventId: string,
  occurredAt: Date,
  components: readonly FeedingComponentInput[],
): Promise<void> {
  const orm = drizzle({ client });
  await orm.insert(feedingSessions).values({ eventId });
  await insertComponents(client, eventId, occurredAt, components);
}

export async function replaceFeedingComponents(
  client: pg.PoolClient,
  eventId: string,
  occurredAt: Date,
  components: readonly FeedingComponentInput[],
): Promise<void> {
  const orm = drizzle({ client });
  await orm.delete(feedingComponents).where(eq(feedingComponents.sessionEventId, eventId));
  await insertComponents(client, eventId, occurredAt, components);
}
