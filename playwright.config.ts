import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'

// Load .env.test for e2e test environment
config({ path: '.env.test' })

// E2E tests MUST run against a local Docker Postgres, never against Supabase.
// Start the test DB: pnpm test:db:up
// Run tests: pnpm test:e2e:run
if (!process.env.TEST_DATABASE_URL && !process.env.CI) {
  console.error(
    '\n❌ E2E tests require TEST_DATABASE_URL pointing to a local Docker Postgres.\n' +
    '   Start the test DB:  pnpm test:db:up\n' +
    '   Run tests:          pnpm test:e2e:run\n' +
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
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Send test user ID header on every request for auth bypass
    extraHTTPHeaders: {
      'x-test-user-id': process.env.TEST_USER_ID ?? 'e2e-test-user-0000-0000-000000000001',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'dotenv -e .env.test -- pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
