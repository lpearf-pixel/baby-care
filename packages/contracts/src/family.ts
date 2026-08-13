import { z } from 'zod';

export const FamilyDtoSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    status: z.literal('active'),
  })
  .strict();

export const BabyDtoSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string(),
    birthDate: z.string().date().nullable(),
    status: z.literal('active'),
  })
  .strict();

export const MemberDtoSchema = z
  .object({
    membershipId: z.string().uuid(),
    displayName: z.string(),
    relationship: z.enum(['dad', 'mom', 'nanny']),
    permissionLevel: z.enum(['family_admin', 'caregiver']),
    status: z.enum(['active', 'disabled']),
  })
  .strict();

export type FamilyDto = z.infer<typeof FamilyDtoSchema>;
export type BabyDto = z.infer<typeof BabyDtoSchema>;
export type MemberDto = z.infer<typeof MemberDtoSchema>;
