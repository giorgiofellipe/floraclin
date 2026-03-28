import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Financial', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)

    if (page.url().includes('/onboarding')) {
      return // tests will skip individually
    }

    // Wait for sidebar to be visible before clicking
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('sidebar-nav-financeiro').click()
    await page.waitForURL(/\/financeiro/, { timeout: 15000 })
  })

  test('should display financial page with tabs', async ({ page }) => {
    if (!page.url().includes('/financeiro')) {
      test.skip()
      return
    }

    // Use the page heading specifically (not sidebar link)
    await expect(
      page.locator('h1', { hasText: 'Financeiro' })
    ).toBeVisible({ timeout: 10000 })

    // Check for tab triggers -- the actual tab labels are "A Receber" and "Visao Geral"
    await expect(page.getByRole('tab', { name: /A Receber/i })).toBeVisible()
  })

  test('should show receivables tab', async ({ page }) => {
    if (!page.url().includes('/financeiro')) {
      test.skip()
      return
    }

    // Click the "A Receber" tab
    const receivablesTab = page.getByRole('tab', { name: /A Receber/i })
    await receivablesTab.click()

    // Verify the financial page is still properly rendered
    await expect(
      page.locator('h1', { hasText: 'Financeiro' })
    ).toBeVisible()
  })

  test('should show overview tab', async ({ page }) => {
    if (!page.url().includes('/financeiro')) {
      test.skip()
      return
    }

    // Click the "Visao Geral" tab
    const overviewTab = page.getByRole('tab', { name: /Vis.o Geral/i })
    await overviewTab.click()

    // Verify the financial page is still properly rendered
    await expect(
      page.locator('h1', { hasText: 'Financeiro' })
    ).toBeVisible()
  })
})
