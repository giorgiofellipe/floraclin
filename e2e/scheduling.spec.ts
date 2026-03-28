import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByTestId('sidebar-nav-agenda').click()
    await page.waitForURL(/\/agenda/)
  })

  test('should display calendar in day view', async ({ page }) => {
    await expect(page.getByTestId('calendar-view-toggle')).toBeVisible()
    await expect(page.getByTestId('calendar-date-prev')).toBeVisible()
    await expect(page.getByTestId('calendar-date-next')).toBeVisible()
    await expect(page.getByTestId('calendar-new-appointment')).toBeVisible()
  })

  test('should switch between day/week/month views', async ({ page }) => {
    // Click week view
    await page.getByTestId('calendar-view-toggle').getByText('Semana').click()
    await expect(page).toHaveURL(/view=week/)

    // Click month view
    await page.getByTestId('calendar-view-toggle').getByText('Mês').click()
    await expect(page).toHaveURL(/view=month/)

    // Click day view
    await page.getByTestId('calendar-view-toggle').getByText('Dia').click()
    await expect(page).toHaveURL(/view=day/)
  })

  test('should open new appointment form', async ({ page }) => {
    await page.getByTestId('calendar-new-appointment').click()
    await expect(page.getByTestId('appointment-form')).toBeVisible()
    await expect(page.getByTestId('appointment-form-submit')).toBeVisible()
  })
})
