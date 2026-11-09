import { defineConfig } from '@playwright/test';

// Contract tests: each plugin's dist/ installed into a built Ephemeris (see e2e/app.ts).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
});
