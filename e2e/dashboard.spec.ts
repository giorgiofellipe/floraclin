import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)
  })

  test('should display personalized greeting', async ({ page }) => {
    // Skip if we ended up on onboarding instead of dashboard
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    const greeting = page.getByTestId('dashboard-greeting')
    await expect(greeting).toBeVisible({ timeout: 10000 })
    // Greeting should contain "Bom dia", "Boa tarde", or "Boa noite"
    await expect(greeting).toHaveText(/Bom dia|Boa tarde|Boa noite/)
  })

  test('should show quick stats section', async ({ page }) => {
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    // Just verify the stats container renders (values may be zero with empty test data)
    const stats = page.getByTestId('dashboard-stats')
    await expect(stats).toBeVisible({ timeout: 10000 })
  })

  test('should show today appointments section', async ({ page }) => {
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    const appointments = page.getByTestId('dashboard-appointments')
    await expect(appointments).toBeVisible({ timeout: 10000 })
  })
})
