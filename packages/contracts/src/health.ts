import { z } from 'zod';

export const HealthResponseSchema = z.never();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
