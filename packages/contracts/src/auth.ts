import { z } from 'zod';

const LoginNameSchema = z.string().trim().min(1).max(64);
const PasswordSchema = z.string().min(10).max(128);

export const SetupInputSchema = z
  .object({
    familyName: z.string().trim().min(1).max(120),
    babyDisplayName: z.string().trim().min(1).max(80),
    dad: z.object({ loginName: LoginNameSchema, password: PasswordSchema }).strict(),
    mom: z.object({ loginName: LoginNameSchema, password: PasswordSchema }).strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dad.loginName.trim().toLowerCase() === value.mom.loginName.trim().toLowerCase()) {
      context.addIssue({
        code: 'custom',
        path: ['mom', 'loginName'],
        message: 'Dad and Mom login names must be different.',
      });
    }
  });

export const SetupStatusResponseSchema = z.object({ required: z.boolean() }).strict();
export const SetupCreatedResponseSchema = z.object({ status: z.literal('created') }).strict();

export const LoginInputSchema = z
  .object({ loginName: LoginNameSchema, password: z.string().min(1).max(128) })
  .strict();

export const ChangePasswordInputSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema })
  .strict();

export const SessionDtoSchema = z
  .object({
    userId: z.string().uuid(),
    displayName: z.string(),
    relationship: z.enum(['dad', 'mom', 'nanny']),
    permissionLevel: z.enum(['family_admin', 'caregiver']),
    familyId: z.string().uuid(),
    familyName: z.string(),
    babyId: z.string().uuid(),
    babyDisplayName: z.string(),
  })
  .strict();

export type SetupInput = z.infer<typeof SetupInputSchema>;
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;
export type SetupCreatedResponse = z.infer<typeof SetupCreatedResponseSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;
export type SessionDto = z.infer<typeof SessionDtoSchema>;
