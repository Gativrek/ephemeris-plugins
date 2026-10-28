import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['plugins/*/src/**/*.test.ts', 'plugins/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
