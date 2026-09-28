import { defineConfig } from 'vitest/config';

/** `npm run balance`: long AI-vs-AI campaign runs, kept out of the normal test suite. */
export default defineConfig({
  test: {
    include: ['tests/balance/*.run.ts'],
    environment: 'node',
    testTimeout: 60 * 60 * 1000,
  },
});
