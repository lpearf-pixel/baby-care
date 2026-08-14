import { z } from 'zod';
import { CareEventStatusSchema, CareWriteMetaInputSchema } from './common.js';

export const StartSleepInputSchema = CareWriteMetaInputSchema;
export const WakeSleepInputSchema = CareWriteMetaInputSchema;

export const SleepIntervalDtoSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: CareEventStatusSchema,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
}).strict();

export type StartSleepInput = z.infer<typeof StartSleepInputSchema>;
export type WakeSleepInput = z.infer<typeof WakeSleepInputSchema>;
export type SleepIntervalDto = z.infer<typeof SleepIntervalDtoSchema>;
