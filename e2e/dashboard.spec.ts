import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('should display personalized greeting', async ({ page }) => {
    const greeting = page.getByTestId('dashboard-greeting')
    await expect(greeting).toBeVisible()
    // Greeting should contain "Bom dia", "Boa tarde", or "Boa noite"
    await expect(greeting).toHaveText(/Bom dia|Boa tarde|Boa noite/)
  })

  test('should show quick stats cards', async ({ page }) => {
    const stats = page.getByTestId('dashboard-stats')
    await expect(stats).toBeVisible()
    // Should contain stat cards
    await expect(page.getByText(/Pacientes esta semana/i)).toBeVisible()
    await expect(page.getByText(/Procedimentos este m/i)).toBeVisible()
  })

  test('should show today appointments section', async ({ page }) => {
    const appointments = page.getByTestId('dashboard-appointments')
    await expect(appointments).toBeVisible()
    await expect(page.getByText(/Agenda de hoje/i)).toBeVisible()
  })
})
