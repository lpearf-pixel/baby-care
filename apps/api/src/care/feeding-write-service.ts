import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { CreateFeedingSessionInput } from '@baby-care/contracts';
import { feedingSessions } from '../schema.js';
import type { CareActorContext } from './care-auth.js';
import { insertCareActionRow } from './care-action-repository.js';
import { createCareEvent, type CareEventRow } from './care-event-repository.js';
import { persistFeedingComponents } from './feeding-persistence.js';

export async function writeFeedingSession(
  client: pg.PoolClient,
  actor: CareActorContext,
  input: CreateFeedingSessionInput,
  traceId: string,
): Promise<CareEventRow> {
  const occurredAt = new Date(input.occurredAt);
  const event = await createCareEvent(client, {
    actor,
    eventType: 'feeding',
    occurredAt,
    clientRequestId: input.clientRequestId,
    note: input.note ?? null,
    traceId,
  });

  const orm = drizzle({ client });
  const existing = await orm.select({ eventId: feedingSessions.eventId })
    .from(feedingSessions)
    .where(eq(feedingSessions.eventId, event.id))
    .limit(1);
  if (existing[0]) return event;

  await persistFeedingComponents(client, event.id, occurredAt, input.components);
  for (const action of input.relatedActions ?? []) {
    const child = await createCareEvent(client, {
      actor,
      eventType: action.kind,
      occurredAt,
      clientRequestId: randomUUID(),
      traceId,
    });
    await insertCareActionRow(client, {
      eventId: child.id,
      actionType: action.kind,
      feedingSessionEventId: event.id,
      ...('amount' in action ? { spitUpAmount: action.amount } : {}),
    });
  }
  return event;
}
