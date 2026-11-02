import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../test-results/localweb',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.LOCALWEB_URL || 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
