import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
