import { resolve } from 'node:path';

// Integration tests run against the real dev Postgres/Redis configured in apps/api/.env.
try {
  process.loadEnvFile(resolve(__dirname, '../.env'));
} catch {
  // CI provides env vars directly
}
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

// AC-2/AC-6 fire hundreds of concurrent requests; the default Prisma pool (CPUs*2+1 ≈ 9) makes the
// test client time out waiting for a connection. Give the test process a wider pool without touching
// the developer's .env (this only affects the vitest process).
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '50');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '60');
  process.env.DATABASE_URL = url.toString();
}
