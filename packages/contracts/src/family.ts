import { z } from 'zod';

export function isSafeTimeZoneIdentifier(value: string): boolean {
  return /^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+-]*)+)$/.test(value);
}

const IanaTimeZoneSchema = z.string().trim().min(1).max(80).refine(isSafeTimeZoneIdentifier, {
  message: 'Timezone must use safe IANA identifier syntax.',
});

export const FamilyDtoSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: IanaTimeZoneSchema,
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

export const UpdateFamilyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: IanaTimeZoneSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined, {
    message: 'At least one family field must be provided.',
  });

export const UpdateBabyInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    birthDate: z.string().date().nullable().optional(),
  })
  .strict()
  .refine((value) => value.displayName !== undefined || value.birthDate !== undefined, {
    message: 'At least one baby field must be provided.',
  });

export const CreateNannyInputSchema = z
  .object({
    loginName: z.string().trim().min(1).max(64),
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(10).max(128),
  })
  .strict();

export const UpdateMemberStatusInputSchema = z
  .object({ status: z.enum(['active', 'disabled']) })
  .strict();

export const ResetNannyPasswordInputSchema = z
  .object({ newPassword: z.string().min(10).max(128) })
  .strict();

export type FamilyDto = z.infer<typeof FamilyDtoSchema>;
export type BabyDto = z.infer<typeof BabyDtoSchema>;
export type MemberDto = z.infer<typeof MemberDtoSchema>;
export type UpdateFamilyInput = z.infer<typeof UpdateFamilyInputSchema>;
export type UpdateBabyInput = z.infer<typeof UpdateBabyInputSchema>;
export type CreateNannyInput = z.infer<typeof CreateNannyInputSchema>;
export type UpdateMemberStatusInput = z.infer<typeof UpdateMemberStatusInputSchema>;
export type ResetNannyPasswordInput = z.infer<typeof ResetNannyPasswordInputSchema>;
