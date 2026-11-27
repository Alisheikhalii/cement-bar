import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  FIELD_HASH_KEY: z.string().min(16),
  COOKIE_SECURE: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_TENANT_ID: z.string().uuid().optional(),
  WORKER: bool,
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  redisUrl: string;
  port: number;
  webOrigin: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  fieldEncryptionKey: string;
  fieldHashKey: string;
  cookieSecure: boolean;
  logLevel: string;
  publicTenantId: string | undefined;
  worker: boolean;
}

/** Injection token for the validated config. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Auth/session constants (security parameters, SPEC §6). */
export const AUTH = {
  accessTtlSeconds: 10 * 60,
  refreshTtlSeconds: 7 * 24 * 60 * 60,
  maxFailedLogins: 5,
  lockMinutes: 15,
  argon2: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
} as const;

export const RATE_LIMITS = {
  global: { ttlMs: 1000, limit: 100 },
  login: { ttlMs: 60_000, limit: 5 },
  register: { ttlMs: 60_000, limit: 5 },
} as const;

/** Loads `.env` (if present) into process.env without overriding existing vars. */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // no .env file — rely on the real environment
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN.replace(/\/$/, ''),
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    jwtRefreshSecret: e.JWT_REFRESH_SECRET,
    fieldEncryptionKey: e.FIELD_ENCRYPTION_KEY,
    fieldHashKey: e.FIELD_HASH_KEY,
    cookieSecure: e.COOKIE_SECURE,
    logLevel: e.LOG_LEVEL,
    publicTenantId: e.PUBLIC_TENANT_ID,
    worker: e.WORKER,
  };
}
