import { z } from 'zod';
import { CareEventStatusSchema, CareWriteMetaInputSchema } from './common.js';
import {
  BottleLiquidTypeSchema,
  FeedingComponentInputSchema,
  FeedingRelatedActionInputSchema,
} from './feeding-components.js';

export const CreateFeedingSessionInputSchema = CareWriteMetaInputSchema.extend({
  components: z.array(FeedingComponentInputSchema).min(1).max(8),
  relatedActions: z.array(FeedingRelatedActionInputSchema).max(4).optional(),
}).strict();

export const FeedingSessionDtoSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  components: z.array(FeedingComponentInputSchema).min(1),
  relatedActions: z.array(FeedingRelatedActionInputSchema),
  note: z.string().nullable(),
}).strict();

export const FeedingQuickValuesQuerySchema = z.object({ liquidType: BottleLiquidTypeSchema }).strict();
export const FeedingQuickValuesDtoSchema = z.object({
  liquidType: BottleLiquidTypeSchema,
  values: z.array(z.number().int().positive()).max(3),
}).strict();

export type CreateFeedingSessionInput = z.infer<typeof CreateFeedingSessionInputSchema>;
export type FeedingSessionDto = z.infer<typeof FeedingSessionDtoSchema>;
export type FeedingQuickValuesDto = z.infer<typeof FeedingQuickValuesDtoSchema>;
