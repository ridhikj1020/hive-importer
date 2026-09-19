import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000, // the Postgres tests boot a WASM database per test
    hookTimeout: 60_000,
  },
});
