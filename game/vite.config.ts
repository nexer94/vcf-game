import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // The model imports the BCG dataset from docs/spec/data (outside game/): let the dev server read the repo root.
    fs: { allow: ['..'] },
  },
  test: {
    // Model + engine must be testable without a browser.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
