import { resolve } from 'node:path';

// Integration tests run against the real dev Postgres/Redis configured in apps/api/.env.
try {
  process.loadEnvFile(resolve(__dirname, '../.env'));
} catch {
  // CI provides env vars directly
}
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
