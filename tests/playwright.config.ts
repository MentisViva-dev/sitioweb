import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for MentisViva production smoke tests.
 *
 * These tests target https://mentisviva.cl directly. They are NON-mutating —
 * they don't submit forms, don't log in, don't touch the DB. Safe to run any time.
 *
 * Run:
 *   npm install
 *   npm run install-browsers
 *   npm test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://mentisviva.cl',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    ignoreHTTPSErrors: false,
    // Reasonable user agent so analytics/CDN don't filter us out
    userAgent:
      'Mozilla/5.0 (Playwright; MentisViva-SmokeTests) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
