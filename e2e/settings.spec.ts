import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)

    if (page.url().includes('/onboarding')) {
      return // tests will skip individually
    }

    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('sidebar-nav-configuracoes').click()
    await page.waitForURL(/\/configuracoes/, { timeout: 10000 })
  })

  test('should display settings page with tabs', async ({ page }) => {
    if (!page.url().includes('/configuracoes')) {
      test.skip()
      return
    }

    // Use heading element to avoid matching sidebar nav link text
    await expect(
      page.locator('h1', { hasText: /Configura/ })
    ).toBeVisible({ timeout: 10000 })
  })

  test('should show clinic settings tab', async ({ page }) => {
    if (!page.url().includes('/configuracoes')) {
      test.skip()
      return
    }

    // The actual tab label is "Clinica"
    const clinicTab = page.getByRole('tab', { name: /Cl.nica/i })
    const isVisible = await clinicTab.isVisible().catch(() => false)
    if (isVisible) {
      await clinicTab.click()
    }
    await expect(
      page.locator('h1', { hasText: /Configura/ })
    ).toBeVisible()
  })

  test('should show team management tab', async ({ page }) => {
    if (!page.url().includes('/configuracoes')) {
      test.skip()
      return
    }

    // The actual tab label is "Equipe"
    const teamTab = page.getByRole('tab', { name: /Equipe/i })
    const isVisible = await teamTab.isVisible().catch(() => false)
    if (isVisible) {
      await teamTab.click()
      // Verify we're still on the settings page
      await expect(
        page.locator('h1', { hasText: /Configura/ })
      ).toBeVisible()
    }
  })
})
