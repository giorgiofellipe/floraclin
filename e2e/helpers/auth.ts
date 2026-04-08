import type { Page } from '@playwright/test'

/**
 * Navigate to the app as the test user.
 *
 * In test mode (TEST_AUTH_BYPASS_ENABLED=true), the middleware bypasses
 * Supabase auth using the x-test-user-id header (set via playwright
 * config's extraHTTPHeaders). No actual login form submission needed —
 * just navigate to /dashboard and the middleware lets us through.
 *
 * The app will redirect to /onboarding if the test tenant hasn't
 * completed onboarding, or /dashboard if it has.
 */
export async function loginAsTestUser(page: Page) {
  await page.goto('/dashboard')
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 })
}

/**
 * Navigate to dashboard. If redirected to onboarding, that's fine —
 * means the test tenant hasn't completed onboarding yet.
 */
export async function loginAndGoToDashboard(page: Page) {
  await loginAsTestUser(page)

  if (page.url().includes('/onboarding')) {
    // Tenant hasn't completed onboarding — tests that need dashboard
    // should handle this by completing onboarding first or skipping
    await page.goto('/dashboard')
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 })
  }
}

// Legacy alias
export const loginAsAdmin = loginAsTestUser
