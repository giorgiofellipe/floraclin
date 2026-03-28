import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)
  })

  test('sidebar links navigate to correct pages', async ({ page }) => {
    // Skip if onboarding redirect prevents access to platform pages
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    const links = [
      { testId: 'sidebar-nav-agenda', url: '/agenda' },
      { testId: 'sidebar-nav-pacientes', url: '/pacientes' },
      { testId: 'sidebar-nav-financeiro', url: '/financeiro' },
      { testId: 'sidebar-nav-configuracoes', url: '/configuracoes' },
      { testId: 'sidebar-nav-dashboard', url: '/dashboard' },
    ]

    for (const link of links) {
      // Ensure sidebar is visible (desktop viewport)
      await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 5000 })
      await page.getByTestId(link.testId).click()
      await page.waitForURL(new RegExp(link.url), { timeout: 10000 })
      await expect(page).toHaveURL(new RegExp(link.url))
    }
  })

  test('mobile menu opens and closes', async ({ page }) => {
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/dashboard')
    // May redirect to /onboarding
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 })

    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    // Sidebar should be hidden on mobile (it uses md:flex which hides on small screens)
    await expect(page.getByTestId('sidebar')).toBeHidden()

    // Open mobile menu
    await page.getByTestId('header-mobile-menu').click()

    // Navigation links should be visible in the mobile sheet (dialog)
    // Scope to the dialog to avoid matching the hidden desktop sidebar
    const mobileNav = page.getByRole('dialog')
    await expect(mobileNav.getByText('Painel')).toBeVisible()
    await expect(mobileNav.getByText('Agenda')).toBeVisible()
    await expect(mobileNav.getByText('Pacientes')).toBeVisible()
  })

  test('page titles are correct', async ({ page }) => {
    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    await page.goto('/dashboard')
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 })

    if (page.url().includes('/onboarding')) {
      test.skip()
      return
    }

    await expect(page).toHaveTitle(/Dashboard/)

    await page.getByTestId('sidebar-nav-pacientes').click()
    await page.waitForURL(/\/pacientes/, { timeout: 10000 })
    await expect(page).toHaveTitle(/Pacientes/)

    await page.getByTestId('sidebar-nav-agenda').click()
    await page.waitForURL(/\/agenda/, { timeout: 10000 })
    await expect(page).toHaveTitle(/Agenda/)
  })
})
