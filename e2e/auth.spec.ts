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
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 10000 })
  })

  test('should redirect to dashboard or onboarding after login', async ({ page }) => {
    await loginAsAdmin(page)
    // After login the app redirects to either /dashboard or /onboarding
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/)
  })

  test('should redirect to login after logout', async ({ page }) => {
    await loginAsAdmin(page)

    // The user menu is a DropdownMenu triggered by an avatar button
    // Find the avatar/button in the header area
    const userMenuTrigger = page.getByTestId('header').locator('button').last()
    await userMenuTrigger.click()

    // Click the "Sair" (logout) menu item
    await page.getByRole('menuitem', { name: /sair/i }).click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
    await expect(page.getByTestId('login-email')).toBeVisible()
  })
})
