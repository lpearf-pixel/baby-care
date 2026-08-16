import { z } from 'zod';
import { CareSourceSchema } from './common.js';
import { CareHomeSummaryDtoSchema, CareTimelineItemDtoSchema } from './query.js';

const OffsetDateTimeSchema = z.string().datetime({ offset: true });
const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected local time in HH:mm format.');
const WeekdaySchema = z.number().int().min(1).max(7);

export const CreateCareHandoffInputSchema = z.object({
  occurredAt: OffsetDateTimeSchema,
  clientRequestId: z.string().uuid(),
}).strict();

export const CareHandoffCheckpointDtoSchema = z.object({
  id: z.string().uuid(),
  occurredAt: OffsetDateTimeSchema,
  createdAt: OffsetDateTimeSchema,
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  source: CareSourceSchema,
}).strict();

export const HandoffReminderRuleInputSchema = z.object({
  localTime: LocalTimeSchema,
  weekdays: z.array(WeekdaySchema).min(1).max(7).refine(
    (weekdays) => new Set(weekdays).size === weekdays.length,
    'Weekdays must not repeat.',
  ),
  enabled: z.boolean(),
}).strict();

export const ReplaceHandoffReminderRulesInputSchema = z.object({
  rules: z.array(HandoffReminderRuleInputSchema).max(16),
}).strict();

export const CareHandoffBriefingDtoSchema = z.object({
  checkpoint: CareHandoffCheckpointDtoSchema,
  previousCheckpoint: CareHandoffCheckpointDtoSchema.nullable(),
  window: z.object({
    mode: z.enum(['checkpoint', 'rolling_24h']),
    from: OffsetDateTimeSchema,
    to: OffsetDateTimeSchema,
  }).strict(),
  careState: CareHomeSummaryDtoSchema,
  feeding: z.object({
    bottleTotalMl: z.number().int().nonnegative(),
    expressedBreastMilkMl: z.number().int().nonnegative(),
    formulaMl: z.number().int().nonnegative(),
    directBreastfeedingSessions: z.number().int().nonnegative(),
    directBreastfeedingMinutes: z.number().int().nonnegative(),
  }).strict(),
  diapers: z.object({
    urine: z.number().int().nonnegative(),
    stool: z.number().int().nonnegative(),
    urineStool: z.number().int().nonnegative(),
  }).strict(),
  sleep: z.object({
    intervals: z.number().int().nonnegative(),
    completedMinutes: z.number().int().nonnegative(),
  }).strict(),
  notableEvents: z.array(CareTimelineItemDtoSchema).max(20),
  notableEventCount: z.number().int().nonnegative(),
  actorActivity: z.array(z.object({
    actorUserId: z.string().uuid().nullable(),
    actorDisplayName: z.string().nullable(),
    eventCount: z.number().int().nonnegative(),
  }).strict()),
  corrections: z.array(z.object({
    eventId: z.string().uuid(),
    action: z.enum(['edit', 'void']),
    actorDisplayName: z.string(),
    createdAt: OffsetDateTimeSchema,
  }).strict()),
  correctionCount: z.number().int().nonnegative(),
}).strict();

export type CreateCareHandoffInput = z.infer<typeof CreateCareHandoffInputSchema>;
export type CareHandoffCheckpointDto = z.infer<typeof CareHandoffCheckpointDtoSchema>;
export type HandoffReminderRuleInput = z.infer<typeof HandoffReminderRuleInputSchema>;
export type ReplaceHandoffReminderRulesInput = z.infer<typeof ReplaceHandoffReminderRulesInputSchema>;
export type CareHandoffBriefingDto = z.infer<typeof CareHandoffBriefingDtoSchema>;
