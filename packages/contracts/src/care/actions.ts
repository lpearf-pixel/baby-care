import { z } from 'zod';
import { CareEventStatusSchema, CareWriteMetaInputSchema } from './common.js';

export const CareActionPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('burping') }).strict(),
  z.object({ kind: z.literal('spit_up'), amount: z.enum(['small', 'medium', 'large']) }).strict(),
  z.object({ kind: z.literal('crying'), durationMinutes: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('bathing') }).strict(),
  z.object({
    kind: z.literal('medication'),
    medicationName: z.string().trim().min(1).max(160),
    dose: z.number().positive(),
    doseUnit: z.string().trim().min(1).max(40),
  }).strict(),
]);

export const CreateCareActionInputSchema = CareWriteMetaInputSchema.extend({
  action: CareActionPayloadSchema,
}).strict();

export const CareActionReceiptSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  kind: z.enum(['burping', 'spit_up', 'crying', 'bathing', 'medication']),
}).strict();

export type CareActionPayload = z.infer<typeof CareActionPayloadSchema>;
export type CreateCareActionInput = z.infer<typeof CreateCareActionInputSchema>;
export type CareActionReceipt = z.infer<typeof CareActionReceiptSchema>;
