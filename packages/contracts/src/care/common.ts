import { z } from 'zod';

export const CareSourceSchema = z.enum(['manual', 'guardian', 'device', 'import', 'ai']);
export const CareEventStatusSchema = z.enum(['active', 'voided']);
export const CareEventTypeSchema = z.enum([
  'feeding',
  'diaper',
  'sleep',
  'burping',
  'spit_up',
  'crying',
  'bathing',
  'medication',
  'temperature',
  'weight',
]);

export const CareWarningCodeSchema = z.enum([
  'duplicate_candidate',
  'unusual_value',
  'old_backfill',
  'sleep_overlap',
]);

export const CareWarningSchema = z
  .object({
    code: CareWarningCodeSchema,
    message: z.string().min(1).max(240),
    relatedEventId: z.string().uuid().optional(),
  })
  .strict();

export const CareWriteMetaInputSchema = z
  .object({
    occurredAt: z.string().datetime({ offset: true }),
    clientRequestId: z.string().uuid(),
    confirmedWarnings: z.array(CareWarningCodeSchema).max(8).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export type CareSource = z.infer<typeof CareSourceSchema>;
export type CareEventStatus = z.infer<typeof CareEventStatusSchema>;
export type CareEventType = z.infer<typeof CareEventTypeSchema>;
export type CareWarningCode = z.infer<typeof CareWarningCodeSchema>;
export type CareWarning = z.infer<typeof CareWarningSchema>;
export type CareWriteMetaInput = z.infer<typeof CareWriteMetaInputSchema>;
