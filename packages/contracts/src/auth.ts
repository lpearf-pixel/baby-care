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

export type SetupInput = z.infer<typeof SetupInputSchema>;
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;
export type SetupCreatedResponse = z.infer<typeof SetupCreatedResponseSchema>;
