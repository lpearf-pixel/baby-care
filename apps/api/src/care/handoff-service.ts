import type {
  CareHandoffBriefingDto,
  CreateCareHandoffInput,
  HandoffReminderRuleInput,
  ReplaceHandoffReminderRulesInput,
} from '@baby-care/contracts';
import { isHandoffReminderVisible, validateOccurredAt, weekdaysToMask } from '@baby-care/domain';
import { writeAudit } from '../audit/audit-repository.js';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { CareValidationError } from './care-errors.js';
import {
  findHandoffByClientRequestId,
  insertHandoffCheckpoint,
  listHandoffReminderRules,
  loadFamilyTimeZone,
  replaceHandoffReminderRules,
  type HandoffCheckpointRow,
} from './handoff-repository.js';
import { createHandoffSummaryService } from './handoff-summary-service.js';

export interface HandoffReminderState {
  rules: HandoffReminderRuleInput[];
  shouldPrompt: boolean;
}

function actorForCheckpoint(actor: CareActorContext, checkpoint: HandoffCheckpointRow): CareActorContext {
  if (checkpoint.family_id !== actor.familyId || checkpoint.actor_user_id !== actor.userId) {
    throw new Error('Idempotent checkpoint does not belong to the authenticated family user.');
  }
  return {
    ...actor,
    babyId: checkpoint.baby_id,
    membershipId: checkpoint.actor_membership_id ?? actor.membershipId,
  };
}

export function createHandoffService(database: DatabaseContext, now: () => Date = () => new Date()) {
  const summaries = createHandoffSummaryService(database);

  async function reminders(actor: CareActorContext): Promise<HandoffReminderState> {
    const [rules, familyTimeZone] = await Promise.all([
      listHandoffReminderRules(database.pool, actor),
      loadFamilyTimeZone(database.pool, actor),
    ]);
    const current = now();
    return {
      rules,
      shouldPrompt: rules.some((rule) => isHandoffReminderVisible({
        localTime: rule.localTime,
        weekdayMask: weekdaysToMask(rule.weekdays),
        enabled: rule.enabled,
        familyTimeZone,
        now: current,
      })),
    };
  }

  return {
    async create(
      actor: CareActorContext,
      input: CreateCareHandoffInput,
      traceId: string,
    ): Promise<CareHandoffBriefingDto> {
      const client = await database.pool.connect();
      let checkpointId: string;
      let summaryActor: CareActorContext;
      try {
        await client.query('begin');
        const existing = await findHandoffByClientRequestId(client, actor, input.clientRequestId);
        if (existing) {
          checkpointId = existing.id;
          summaryActor = actorForCheckpoint(actor, existing);
          await client.query('commit');
        } else {
          const occurredAt = new Date(input.occurredAt);
          if (!validateOccurredAt(occurredAt, now()).ok) {
            throw new CareValidationError('The handoff time is too far in the future.');
          }
          const createdAt = now();
          const inserted = await insertHandoffCheckpoint(client, {
            actor,
            occurredAt,
            createdAt,
            clientRequestId: input.clientRequestId,
            traceId,
          });
          const checkpoint = inserted
            ?? await findHandoffByClientRequestId(client, actor, input.clientRequestId);
          if (!checkpoint) throw new Error('Handoff checkpoint was not persisted.');
          checkpointId = checkpoint.id;
          summaryActor = actorForCheckpoint(actor, checkpoint);
          if (inserted) {
            await writeAudit(client, {
              familyId: actor.familyId,
              actorUserId: actor.userId,
              actorMembershipId: actor.membershipId,
              action: 'care.handoff_created',
              targetType: 'care_handoff_checkpoint',
              targetId: checkpoint.id,
              source: 'api',
              traceId,
              metadata: { checkpointId: checkpoint.id, source: checkpoint.source, traceId },
              occurredAt: createdAt,
            });
          }
          await client.query('commit');
        }
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return summaries.byId(summaryActor, checkpointId);
    },

    reminders,

    async replaceReminders(
      actor: CareActorContext,
      input: ReplaceHandoffReminderRulesInput,
    ): Promise<HandoffReminderState> {
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await replaceHandoffReminderRules(client, actor, input.rules, now());
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return reminders(actor);
    },
  };
}

export type HandoffService = ReturnType<typeof createHandoffService>;
