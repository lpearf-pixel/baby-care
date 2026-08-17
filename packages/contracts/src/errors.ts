import { z } from 'zod';
import { CareWarningSchema } from './care/common.js';

export const ApiErrorCodeSchema = z.enum([
  'setup_closed',
  'setup_token_invalid',
  'invalid_credentials',
  'unauthenticated',
  'forbidden',
  'origin_not_allowed',
  'login_name_conflict',
  'member_already_exists',
  'member_disabled',
  'validation_failed',
  'care_confirmation_required',
  'care_event_not_found',
  'care_state_conflict',
  'export_too_large',
  'export_in_progress',
  'export_failed',
]);

const NonConfirmationErrorCodeSchema = z.enum([
  'setup_closed',
  'setup_token_invalid',
  'invalid_credentials',
  'unauthenticated',
  'forbidden',
  'origin_not_allowed',
  'login_name_conflict',
  'member_already_exists',
  'member_disabled',
  'validation_failed',
  'care_event_not_found',
  'care_state_conflict',
  'export_too_large',
  'export_in_progress',
  'export_failed',
]);

const NonConfirmationApiErrorSchema = z
  .object({
    code: NonConfirmationErrorCodeSchema,
    message: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();

const CareConfirmationApiErrorSchema = z
  .object({
    code: z.literal('care_confirmation_required'),
    message: z.string().min(1),
    traceId: z.string().min(1),
    details: z
      .object({
        warnings: z.array(CareWarningSchema).min(1).max(8),
      })
      .strict(),
  })
  .strict();

export const ApiErrorSchema = z.discriminatedUnion('code', [
  NonConfirmationApiErrorSchema,
  CareConfirmationApiErrorSchema,
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
