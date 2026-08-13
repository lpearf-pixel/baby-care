export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly apiHost: string;
  readonly apiPort: number;
  readonly databaseUrl: string;
  readonly appTimezone: string;
  readonly babyDisplayName: string;
}

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function readPort(raw: string | undefined): number {
  const value = raw ?? '8787';
  if (!/^\d+$/.test(value)) throw new ConfigError('API_PORT must be an integer');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('API_PORT must be between 1 and 65535');
  return port;
}

function readNodeEnv(raw: string | undefined): NodeEnv {
  const value = raw ?? 'development';
  if (value !== 'development' && value !== 'test' && value !== 'production') throw new ConfigError('NODE_ENV must be development, test, or production');
  return value;
}

function readDatabaseUrl(raw: string | undefined): string {
  if (!raw || !/^postgres(?:ql)?:\/\//i.test(raw)) throw new ConfigError('DATABASE_URL must be a PostgreSQL connection URL');
  return raw;
}

export function loadConfig(env: Env): AppConfig {
  return Object.freeze({
    nodeEnv: readNodeEnv(env.NODE_ENV),
    apiHost: env.API_HOST?.trim() || '0.0.0.0',
    apiPort: readPort(env.API_PORT),
    databaseUrl: readDatabaseUrl(env.DATABASE_URL),
    appTimezone: env.APP_TIMEZONE?.trim() || 'Asia/Shanghai',
    babyDisplayName: env.BABY_DISPLAY_NAME?.trim() || 'xiangxiang',
  });
}
