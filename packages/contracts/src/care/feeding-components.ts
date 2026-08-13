import { z } from 'zod';

export const BottleLiquidTypeSchema = z.enum(['expressed_breast_milk', 'formula']);

export const FeedingComponentInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct_breastfeeding'), durationMinutes: z.number().int().positive() }).strict(),
  z.object({
    kind: z.literal('bottle'),
    liquidType: BottleLiquidTypeSchema,
    amountMl: z.number().int().positive(),
    bottleCapacityMl: z.number().int().positive().optional(),
  }).strict(),
]);

export const FeedingRelatedActionInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('burping') }).strict(),
  z.object({ kind: z.literal('spit_up'), amount: z.enum(['small', 'medium', 'large']) }).strict(),
]);

export type BottleLiquidType = z.infer<typeof BottleLiquidTypeSchema>;
export type FeedingComponentInput = z.infer<typeof FeedingComponentInputSchema>;
export type FeedingRelatedActionInput = z.infer<typeof FeedingRelatedActionInputSchema>;
