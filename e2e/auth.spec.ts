import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Authentication flow', () => {
  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/login/)
    await expect(page.getByTestId('login-email')).toBeVisible()
    await expect(page.getByTestId('login-password')).toBeVisible()
    await expect(page.getByTestId('login-submit')).toBeVisible()
  })

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill('wrong@email.com')
    await page.getByTestId('login-password').fill('wrongpassword')
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  test('should redirect to dashboard after login', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible()
  })

  test('should redirect to login after logout', async ({ page }) => {
    await loginAsAdmin(page)
    // Open user menu and click logout
    await page.getByRole('button', { name: /menu|perfil|user/i }).click()
    await page.getByRole('menuitem', { name: /sair|logout/i }).click()
    await page.waitForURL(/\/login/)
    await expect(page.getByTestId('login-email')).toBeVisible()
  })
})
