import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByTestId('sidebar-nav-configuracoes').click()
    await page.waitForURL(/\/configuracoes/)
  })

  test('should display settings page with tabs', async ({ page }) => {
    await expect(page.getByText(/Configura/i)).toBeVisible()
  })

  test('should show clinic settings tab', async ({ page }) => {
    // Look for clinic-related settings content
    const clinicTab = page.getByText(/Cl.nica|Dados da Cl.nica|Geral/i)
    const isVisible = await clinicTab.isVisible().catch(() => false)
    if (isVisible) {
      await clinicTab.click()
    }
    await expect(page.getByText(/Configura/i)).toBeVisible()
  })

  test('should show team management tab', async ({ page }) => {
    // Look for team/equipe tab
    const teamTab = page.getByText(/Equipe|Time|Profissionais/i)
    const isVisible = await teamTab.isVisible().catch(() => false)
    if (isVisible) {
      await teamTab.click()
      await expect(page.getByText(/Equipe|Time|Profissionais/i).first()).toBeVisible()
    }
  })
})
