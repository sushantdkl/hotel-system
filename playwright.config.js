import { defineConfig, devices } from '@playwright/test';

/**
 * E2E acceptance tests for the Raithane Daure Chulo counter POS + public site.
 * Assumes a dev server is already running on PORT (default 3002) against the
 * target database. Start it with:
 *   DATABASE_URL=... npx next dev -p 3002
 */
const PORT = process.env.E2E_PORT || 3002;
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // A single Next dev server compiles routes on demand; serialize to avoid
  // contention/flakes when many first-hit routes compile at once.
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL,
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
