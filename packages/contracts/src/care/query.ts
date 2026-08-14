import { z } from 'zod';
import { CareEventStatusSchema, CareEventTypeSchema, CareSourceSchema } from './common.js';

export const CareSummaryQuerySchema = z.object({
  at: z.string().datetime({ offset: true }),
}).strict();

export const CareTimelineQuerySchema = z.object({
  before: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const CareHomeSummaryDtoSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  lastFeeding: z.object({
    occurredAt: z.string().datetime({ offset: true }),
    bottle: z.object({
      liquidType: z.enum(['expressed_breast_milk', 'formula']),
      amountMl: z.number().int().positive(),
    }).optional(),
    directBreastfeedingMinutes: z.number().int().positive().optional(),
  }).strict().nullable(),
  lastDiaper: z.object({
    occurredAt: z.string().datetime({ offset: true }),
    kind: z.enum(['urine', 'stool', 'urine_stool']),
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
    startedAt: z.string().datetime({ offset: true }),
  }).strict().nullable(),
}).strict();

export const CareTimelineItemDtoSchema = z.object({
  id: z.string().uuid(),
  eventType: CareEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  source: CareSourceSchema,
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  note: z.string().nullable(),
}).strict();

export const CareTimelineResponseSchema = z.object({
  items: z.array(CareTimelineItemDtoSchema),
}).strict();

export type CareSummaryQuery = z.infer<typeof CareSummaryQuerySchema>;
export type CareTimelineQuery = z.infer<typeof CareTimelineQuerySchema>;
export type CareHomeSummaryDto = z.infer<typeof CareHomeSummaryDtoSchema>;
export type CareTimelineItemDto = z.infer<typeof CareTimelineItemDtoSchema>;
export type CareTimelineResponse = z.infer<typeof CareTimelineResponseSchema>;
