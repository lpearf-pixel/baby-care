import { z } from 'zod';

const ExplicitBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const ConfigSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1),
  BABY_CARE_APP_ORIGIN: z.string().url(),
  BABY_CARE_SETUP_TOKEN: z.string().min(16),
  SESSION_SECURE: ExplicitBooleanSchema,
  DIAGNOSTIC_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  return ConfigSchema.parse(environment);
}
