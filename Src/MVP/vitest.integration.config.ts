import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['Src/tests/integration/**/*.test.ts'],
    setupFiles: ['./Src/tests/integration/setup.ts']
  }
});