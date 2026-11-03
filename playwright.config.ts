import { defineConfig } from '@playwright/test';
const port = Number(process.env.PORT || 3000);
export default defineConfig({
  testDir: './tests',
  // Needs lmscript >= 0.2.454 and runs in its own CI job: `npm run test:host`.
  testIgnore: process.env.LMWEBTEST_HOST_TESTS ? [] : ['**/playwright-host.spec.ts'],
  workers: 1, // Demo tests reset the same file store.
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
