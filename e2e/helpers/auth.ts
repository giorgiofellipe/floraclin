import type { Page } from '@playwright/test'

export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('login-email').fill('admin@floraclin.com.br')
  await page.getByTestId('login-password').fill('Admin@123')
  await page.getByTestId('login-submit').click()

  // After login, the app may redirect to /dashboard or /onboarding
  // (depending on whether the tenant has completed onboarding).
  // Accept either destination as a successful login.
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 })

  // If we landed on onboarding, that's fine — login succeeded.
  // Tests that need the dashboard should navigate explicitly.
}

/**
 * Login and ensure we end up on /dashboard.
 * If onboarding hasn't been completed, navigate to /dashboard directly
 * (the redirect loop is handled by accepting the final URL).
 */
export async function loginAndGoToDashboard(page: Page) {
  await loginAsAdmin(page)

  // If redirected to onboarding, try navigating to dashboard anyway
  if (page.url().includes('/onboarding')) {
    await page.goto('/dashboard')
    // May redirect back to /onboarding — accept either
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 })
  }
}
