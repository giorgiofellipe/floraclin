import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Authentication (auth bypass mode)', () => {
  test('should access dashboard via auth bypass header', async ({ page }) => {
    await loginAsAdmin(page)
    // Auth bypass lets us through — we land on /dashboard or /onboarding
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/)
  })

  test('should render sidebar and header on dashboard', async ({ page }) => {
    await loginAsAdmin(page)

    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('header')).toBeVisible({ timeout: 10000 })
  })

  test('should navigate to dashboard without redirect to login', async ({ page }) => {
    // With auth bypass enabled and x-test-user-id header, we should NOT
    // be redirected to /login
    await page.goto('/dashboard')
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 })

    // Verify we are NOT on login
    expect(page.url()).not.toContain('/login')
  })
})
