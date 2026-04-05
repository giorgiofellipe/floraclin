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
    baseURL: process.env.BASE_URL ?? 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Send test user ID header on every request for auth bypass
    extraHTTPHeaders: {
      'x-test-user-id': process.env.TEST_USER_ID ?? '00000000-0000-4000-a000-000000000001',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // In CI, start the dev server automatically.
  // Locally, start it manually with test env vars:
  //   source .env.test && pnpm dev
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        timeout: 120000,
        env: {
          DATABASE_URL: process.env.DATABASE_URL!,
          TEST_AUTH_BYPASS_ENABLED: 'true',
          TEST_USER_ID: process.env.TEST_USER_ID!,
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
      }
    : undefined,
})
