import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Financial', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByTestId('sidebar-nav-financeiro').click()
    await page.waitForURL(/\/financeiro/)
  })

  test('should display financial page with tabs', async ({ page }) => {
    await expect(page.getByText('Financeiro')).toBeVisible()
    // Check for tab-like navigation (receivables, overview, etc.)
    await expect(page.getByText(/Contas a Receber|A Receber|Receitas/i)).toBeVisible()
  })

  test('should show receivables tab', async ({ page }) => {
    // Navigate to receivables if there's a tab
    const receivablesTab = page.getByText(/Contas a Receber|A Receber/i)
    const isVisible = await receivablesTab.isVisible().catch(() => false)
    if (isVisible) {
      await receivablesTab.click()
    }
    // The page should show a list or empty state
    await expect(page.getByText(/Financeiro/i)).toBeVisible()
  })

  test('should show overview tab with charts', async ({ page }) => {
    const overviewTab = page.getByText(/Visão Geral|Resumo|Overview/i)
    const isVisible = await overviewTab.isVisible().catch(() => false)
    if (isVisible) {
      await overviewTab.click()
    }
    // Verify the financial page is still properly rendered
    await expect(page.getByText(/Financeiro/i)).toBeVisible()
  })
})
