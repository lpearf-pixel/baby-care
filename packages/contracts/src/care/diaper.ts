import { z } from 'zod';
import { CareEventStatusSchema, CareWriteMetaInputSchema } from './common.js';

export const DiaperKindSchema = z.enum(['urine', 'stool', 'urine_stool']);

export const CreateDiaperInputSchema = CareWriteMetaInputSchema.extend({
  kind: DiaperKindSchema,
  stoolColor: z.string().trim().min(1).max(80).optional(),
  stoolConsistency: z.string().trim().min(1).max(80).optional(),
  stoolAmount: z.string().trim().min(1).max(80).optional(),
}).strict();

export const DiaperEventDtoSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  kind: DiaperKindSchema,
  stoolColor: z.string().nullable(),
  stoolConsistency: z.string().nullable(),
  stoolAmount: z.string().nullable(),
  note: z.string().nullable(),
}).strict();

export type DiaperKind = z.infer<typeof DiaperKindSchema>;
export type CreateDiaperInput = z.infer<typeof CreateDiaperInputSchema>;
export type DiaperEventDto = z.infer<typeof DiaperEventDtoSchema>;
