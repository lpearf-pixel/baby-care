import { z } from 'zod';
import { CareEventStatusSchema, CareSourceSchema } from './common.js';
import { DiaperKindSchema } from './diaper.js';
import { FeedingComponentInputSchema, FeedingRelatedActionInputSchema } from './feeding-components.js';

const OffsetDateTimeSchema = z.string().datetime({ offset: true });
const CareTimelineCategorySchema = z.enum(['all', 'feeding', 'diaper', 'sleep', 'other']);

export const CareSummaryQuerySchema = z.object({
  at: OffsetDateTimeSchema,
}).strict();

export const CareTimelineQuerySchema = z.object({
  before: OffsetDateTimeSchema.optional(),
  cursor: z.string().min(1).optional(),
  from: OffsetDateTimeSchema.optional(),
  to: OffsetDateTimeSchema.optional(),
  category: CareTimelineCategorySchema.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, context) => {
  if (value.before && value.cursor) {
    context.addIssue({ code: 'custom', path: ['cursor'], message: 'Cursor and before cannot be used together.' });
  }
  if (value.from && value.to && new Date(value.from).getTime() > new Date(value.to).getTime()) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'Timeline end must not be before start.' });
  }
});

export const CareHomeSummaryDtoSchema = z.object({
  asOf: OffsetDateTimeSchema,
  lastFeeding: z.object({
    occurredAt: OffsetDateTimeSchema,
    bottle: z.object({
      liquidType: z.enum(['expressed_breast_milk', 'formula']),
      amountMl: z.number().int().positive(),
    }).optional(),
    directBreastfeedingMinutes: z.number().int().positive().optional(),
  }).strict().nullable(),
  lastDiaper: z.object({
    occurredAt: OffsetDateTimeSchema,
    kind: DiaperKindSchema,
  }).strict().nullable(),
  rolling24h: z.object({
    bottleTotalMl: z.number().int().nonnegative(),
    expressedBreastMilkMl: z.number().int().nonnegative(),
    formulaMl: z.number().int().nonnegative(),
    directBreastfeedingSessions: z.number().int().nonnegative(),
    directBreastfeedingMinutes: z.number().int().nonnegative(),
  }).strict(),
  currentSleep: z.object({
    intervalId: z.string().uuid(),
    startedAt: OffsetDateTimeSchema,
  }).strict().nullable(),
}).strict();

const CareTimelineItemBaseSchema = z.object({
  id: z.string().uuid(),
  occurredAt: OffsetDateTimeSchema,
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
  status: CareEventStatusSchema,
  source: CareSourceSchema,
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  isBackfilled: z.boolean(),
});

export const FeedingTimelinePayloadSchema = z.object({
  components: z.array(FeedingComponentInputSchema).min(1),
  relatedActions: z.array(FeedingRelatedActionInputSchema),
}).strict();
export const DiaperTimelinePayloadSchema = z.object({
  kind: DiaperKindSchema,
  stoolColor: z.string().nullable(),
  stoolConsistency: z.string().nullable(),
  stoolAmount: z.string().nullable(),
}).strict();
export const SleepTimelinePayloadSchema = z.object({
  startedAt: OffsetDateTimeSchema,
  endedAt: OffsetDateTimeSchema.nullable(),
}).strict();
export const BurpingTimelinePayloadSchema = z.object({
  action: z.object({ kind: z.literal('burping') }).strict(),
}).strict();
export const SpitUpTimelinePayloadSchema = z.object({
  action: z.object({ kind: z.literal('spit_up'), amount: z.enum(['small', 'medium', 'large']) }).strict(),
}).strict();
export const CryingTimelinePayloadSchema = z.object({
  action: z.object({ kind: z.literal('crying'), durationMinutes: z.number().int().positive().optional() }).strict(),
}).strict();
export const BathingTimelinePayloadSchema = z.object({
  action: z.object({ kind: z.literal('bathing') }).strict(),
}).strict();
export const MedicationTimelinePayloadSchema = z.object({
  action: z.object({
    kind: z.literal('medication'),
    medicationName: z.string().trim().min(1).max(160),
    dose: z.number().positive(),
    doseUnit: z.string().trim().min(1).max(40),
  }).strict(),
}).strict();
export const TemperatureTimelinePayloadSchema = z.object({
  measurement: z.object({
    kind: z.literal('temperature'),
    valueCelsius: z.number().positive(),
    method: z.string().trim().min(1).max(80).optional(),
  }).strict(),
}).strict();
export const WeightTimelinePayloadSchema = z.object({
  measurement: z.object({ kind: z.literal('weight'), valueKg: z.number().positive() }).strict(),
}).strict();

export const CareTimelineItemDtoSchema = z.discriminatedUnion('eventType', [
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('feeding'), payload: FeedingTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('diaper'), payload: DiaperTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('sleep'), payload: SleepTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('burping'), payload: BurpingTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('spit_up'), payload: SpitUpTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('crying'), payload: CryingTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('bathing'), payload: BathingTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('medication'), payload: MedicationTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('temperature'), payload: TemperatureTimelinePayloadSchema }).strict(),
  CareTimelineItemBaseSchema.extend({ eventType: z.literal('weight'), payload: WeightTimelinePayloadSchema }).strict(),
]);

export const CareTimelineResponseSchema = z.object({
  items: z.array(CareTimelineItemDtoSchema),
  nextCursor: z.string().nullable(),
}).strict();

export type CareSummaryQuery = z.infer<typeof CareSummaryQuerySchema>;
export type CareTimelineQuery = z.infer<typeof CareTimelineQuerySchema>;
export type CareTimelineCategory = z.infer<typeof CareTimelineCategorySchema>;
export type CareHomeSummaryDto = z.infer<typeof CareHomeSummaryDtoSchema>;
export type CareTimelineItemDto = z.infer<typeof CareTimelineItemDtoSchema>;
export type CareTimelineResponse = z.infer<typeof CareTimelineResponseSchema>;
