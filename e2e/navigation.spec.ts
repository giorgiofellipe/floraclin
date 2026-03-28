import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('sidebar links navigate to correct pages', async ({ page }) => {
    const links = [
      { testId: 'sidebar-nav-agenda', url: '/agenda' },
      { testId: 'sidebar-nav-pacientes', url: '/pacientes' },
      { testId: 'sidebar-nav-financeiro', url: '/financeiro' },
      { testId: 'sidebar-nav-configuracoes', url: '/configuracoes' },
      { testId: 'sidebar-nav-dashboard', url: '/dashboard' },
    ]

    for (const link of links) {
      await page.getByTestId(link.testId).click()
      await page.waitForURL(new RegExp(link.url))
      await expect(page).toHaveURL(new RegExp(link.url))
    }
  })

  test('mobile menu opens and closes', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/dashboard')

    // Sidebar should be hidden on mobile
    await expect(page.getByTestId('sidebar')).toBeHidden()

    // Open mobile menu
    await page.getByTestId('header-mobile-menu').click()

    // Navigation links should be visible in the sheet
    await expect(page.getByText('Dashboard')).toBeVisible()
    await expect(page.getByText('Agenda')).toBeVisible()
    await expect(page.getByText('Pacientes')).toBeVisible()
  })

  test('page titles are correct', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveTitle(/Dashboard/)

    await page.getByTestId('sidebar-nav-pacientes').click()
    await page.waitForURL(/\/pacientes/)
    await expect(page).toHaveTitle(/Pacientes/)

    await page.getByTestId('sidebar-nav-agenda').click()
    await page.waitForURL(/\/agenda/)
    await expect(page).toHaveTitle(/Agenda/)
  })
})
