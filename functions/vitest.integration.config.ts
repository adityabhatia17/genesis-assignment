import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts', 'test/rules/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    setupFiles: ['test/helpers/integration-setup.ts'],
  },
});
