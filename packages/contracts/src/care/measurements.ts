import { z } from 'zod';
import { CareEventStatusSchema, CareWriteMetaInputSchema } from './common.js';

export const MeasurementPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('temperature'),
    valueCelsius: z.number().positive(),
    method: z.string().trim().min(1).max(80).optional(),
  }).strict(),
  z.object({ kind: z.literal('weight'), valueKg: z.number().positive() }).strict(),
]);

export const CreateMeasurementInputSchema = CareWriteMetaInputSchema.extend({
  measurement: MeasurementPayloadSchema,
}).strict();

export const MeasurementReceiptSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  kind: z.enum(['temperature', 'weight']),
}).strict();

export type MeasurementPayload = z.infer<typeof MeasurementPayloadSchema>;
export type CreateMeasurementInput = z.infer<typeof CreateMeasurementInputSchema>;
export type MeasurementReceipt = z.infer<typeof MeasurementReceiptSchema>;
