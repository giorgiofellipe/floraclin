import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)

    if (page.url().includes('/onboarding')) {
      return // tests will skip individually
    }

    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('sidebar-nav-agenda').click()
    await page.waitForURL(/\/agenda/, { timeout: 10000 })
  })

  test('should display calendar in day view', async ({ page }) => {
    if (!page.url().includes('/agenda')) {
      test.skip()
      return
    }

    await expect(page.getByTestId('calendar-view-toggle')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('calendar-date-prev')).toBeVisible()
    await expect(page.getByTestId('calendar-date-next')).toBeVisible()
    await expect(page.getByTestId('calendar-new-appointment')).toBeVisible()
  })

  test('should switch between day/week/month views', async ({ page }) => {
    if (!page.url().includes('/agenda')) {
      test.skip()
      return
    }

    // The view toggle contains Button components with text Dia, Semana, Mes
    const viewToggle = page.getByTestId('calendar-view-toggle')
    await expect(viewToggle).toBeVisible({ timeout: 10000 })

    // Click week view button
    await viewToggle.getByRole('button', { name: 'Semana' }).click()
    await expect(page).toHaveURL(/view=week/, { timeout: 5000 })

    // Click month view button
    await viewToggle.getByRole('button', { name: /M.s/ }).click()
    await expect(page).toHaveURL(/view=month/, { timeout: 5000 })

    // Click day view button
    await viewToggle.getByRole('button', { name: 'Dia' }).click()
    await expect(page).toHaveURL(/view=day/, { timeout: 5000 })
  })

  test('should open new appointment form', async ({ page }) => {
    if (!page.url().includes('/agenda')) {
      test.skip()
      return
    }

    await page.getByTestId('calendar-new-appointment').click()
    await expect(page.getByTestId('appointment-form')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('appointment-form-submit')).toBeVisible()
  })
})
