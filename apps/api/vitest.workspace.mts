import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.mts',
    test: { name: 'unit', include: ['src/**/*.spec.ts'] },
  },
  {
    extends: './vitest.config.mts',
    test: {
      name: 'int',
      include: ['test/**/*.int.test.ts'],
      setupFiles: ['test/setup-env.ts'],
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  },
]);
