import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Model + engine must be testable without a browser.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
