import { z } from 'zod';

const common = {
  service: z.literal('baby-care-api'),
  timestamp: z.string().datetime(),
};

export const HealthResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      ...common,
      database: z.literal('ok'),
    })
    .strict(),
  z
    .object({
      status: z.literal('degraded'),
      ...common,
      database: z.literal('unavailable'),
    })
    .strict(),
]);

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
