import type { Page } from '@playwright/test'

export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByTestId('login-email').fill('admin@floraclin.com.br')
  await page.getByTestId('login-password').fill('Admin@123')
  await page.getByTestId('login-submit').click()
  await page.waitForURL('/dashboard')
}
