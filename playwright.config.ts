import { defineConfig, devices } from '@playwright/test'

// E2E tests MUST run against a local Docker Postgres, never against Supabase.
// Start the test DB: pnpm test:db:up
// Run tests: TEST_DATABASE_URL=postgresql://test:test@localhost:5433/floraclin_test pnpm test:e2e:run
if (!process.env.TEST_DATABASE_URL && !process.env.CI) {
  console.error(
    '\n❌ E2E tests require TEST_DATABASE_URL pointing to a local Docker Postgres.\n' +
    '   Start the test DB:  pnpm test:db:up\n' +
    '   Run tests:          TEST_DATABASE_URL=postgresql://test:test@localhost:5433/floraclin_test pnpm test:e2e:run\n' +
    '   NEVER run e2e against Supabase.\n'
  )
  process.exit(1)
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        timeout: 120000,
      }
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
      },
})
