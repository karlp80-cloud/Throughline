import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config.
 *
 * The web server is `vite preview` against the built `dist/`. This means
 * e2e tests require a prior `npm run build`. The `test` script chains
 * unit -> build -> e2e in that order.
 */
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Serialize on CI to avoid resource contention; let Playwright pick the
  // worker count locally. Conditional spread keeps `exactOptionalPropertyTypes`
  // happy — the `workers` key is simply absent when not on CI.
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['list'], ['html']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
