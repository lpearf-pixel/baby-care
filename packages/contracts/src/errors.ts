import { z } from 'zod';

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
]);

export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
