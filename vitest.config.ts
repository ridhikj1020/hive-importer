import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000, // the Postgres tests boot a WASM database per test file
    hookTimeout: 60_000,
  },
});
