import type { CreateFeedingSessionInput, FeedingQuickValuesDto, FeedingSessionDto } from '@baby-care/contracts';
import { rankRecentBottleAmounts } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { CareConfirmationRequiredError } from './care-errors.js';
import { findByClientRequestId } from './care-event-repository.js';
import { recentBottleHistory } from './feeding-history.js';
import { collectFeedingWarnings } from './feeding-warnings.js';
import { writeFeedingSession } from './feeding-write-service.js';

function toDto(event: { id: string; occurredAt: Date; status: 'active' | 'voided' }, input: CreateFeedingSessionInput): FeedingSessionDto {
  return {
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
    status: event.status,
    components: input.components,
    relatedActions: input.relatedActions ?? [],
    note: input.note ?? null,
  };
}

export function createFeedingService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async createSession(actor: CareActorContext, input: CreateFeedingSessionInput, traceId: string): Promise<FeedingSessionDto> {
      const lookupClient = await database.pool.connect();
      try {
        const existing = await findByClientRequestId(lookupClient, actor, input.clientRequestId);
        if (existing) return toDto(existing, input);
      } finally {
        lookupClient.release();
      }

      const warnings = await collectFeedingWarnings(database.pool, actor, input, now());
      const confirmed = new Set(input.confirmedWarnings ?? []);
      const pending = warnings.filter((warning) => !confirmed.has(warning.code));
      if (pending.length > 0) throw new CareConfirmationRequiredError(pending);

      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await writeFeedingSession(client, actor, input, traceId);
        await client.query('commit');
        return toDto(event, input);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async quickValues(actor: CareActorContext, liquidType: FeedingQuickValuesDto['liquidType']): Promise<FeedingQuickValuesDto> {
      const history = await recentBottleHistory(database.pool, actor, liquidType);
      return { liquidType, values: rankRecentBottleAmounts(history) };
    },
  };
}

export type FeedingService = ReturnType<typeof createFeedingService>;
