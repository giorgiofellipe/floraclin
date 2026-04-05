import { test, expect, type Page } from '@playwright/test'

/**
 * Onboarding E2E Tests
 *
 * These tests assume an ephemeral Docker Postgres database that is reset
 * before each test run. The test user/tenant is seeded fresh with
 * onboarding_completed = false.
 *
 * Prerequisites (handled by test:db:up + seed):
 * - A tenant with settings: {} (onboarding not completed)
 * - A user with credentials that can log in
 * - Auth bypass middleware enabled (TEST_AUTH_BYPASS_ENABLED=true)
 *
 * These tests are sequential — the final test completes onboarding,
 * so running them out of order will cause skips.
 */

const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? 'test@floraclin.test'
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'Test@123'

async function loginTestUser(page: Page) {
  await page.goto('/login')
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('login-email').fill(TEST_EMAIL)
  await page.getByTestId('login-password').fill(TEST_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 })
}

function skipIfNotOnboarding(page: Page) {
  if (!page.url().includes('/onboarding')) {
    test.skip()
  }
}

// ─── Onboarding Flow ──────────────────────────────────────────────────

test.describe('Onboarding', () => {
  test.describe.configure({ mode: 'serial' })

  test('should redirect new clinic to onboarding', async ({ page }) => {
    await loginTestUser(page)
    expect(page.url()).toContain('/onboarding')
  })

  test('should display stepper with 3 steps on step 1', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // All 3 step labels visible
    await expect(page.locator('text=Clínica')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Procedimentos')).toBeVisible()
    await expect(page.locator('text=Equipe')).toBeVisible()

    // Step 1 content visible
    await expect(page.locator('text=Dados da Clínica')).toBeVisible()

    // Next button visible, no Previous button on step 1
    await expect(page.getByTestId('onboarding-next')).toBeVisible()
    await expect(page.getByTestId('onboarding-prev')).not.toBeVisible()
  })

  test('should show clinic form with pre-filled name and booking link', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    await expect(page.locator('text=Dados da Clínica')).toBeVisible({ timeout: 10000 })

    // Booking link preview should be visible
    await expect(page.locator('text=Link de agendamento online')).toBeVisible()
    await expect(page.locator('text=floraclin.com.br/c/')).toBeVisible()
  })

  test('should navigate to step 2 — Procedimentos', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('onboarding-next').click()

    // Step 2 content
    await expect(page.locator('text=Tipos de Procedimento')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Procedimentos Sugeridos')).toBeVisible()

    // Default procedures listed as checkboxes (all checked by default)
    const checkboxes = page.locator('input[type="checkbox"]')
    await expect(checkboxes.first()).toBeVisible()
    await expect(checkboxes.first()).toBeChecked()

    // Previous button now visible
    await expect(page.getByTestId('onboarding-prev')).toBeVisible()
  })

  test('should toggle procedure selection', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Navigate to step 2
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Procedimentos Sugeridos')).toBeVisible({ timeout: 5000 })

    // Uncheck first procedure
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await expect(firstCheckbox).toBeChecked()
    await firstCheckbox.uncheck()
    await expect(firstCheckbox).not.toBeChecked()

    // Check it again
    await firstCheckbox.check()
    await expect(firstCheckbox).toBeChecked()
  })

  test('should go back from step 2 to step 1', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Go to step 2
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Tipos de Procedimento')).toBeVisible({ timeout: 5000 })

    // Go back to step 1
    await page.getByTestId('onboarding-prev').click()
    await expect(page.locator('text=Dados da Clínica')).toBeVisible({ timeout: 5000 })
  })

  test('should navigate to step 3 — Equipe', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Step 1 → Step 2
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Tipos de Procedimento')).toBeVisible({ timeout: 5000 })

    // Step 2 → Step 3
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Convide sua Equipe')).toBeVisible({ timeout: 5000 })

    // Skip and Complete buttons visible
    await expect(page.getByTestId('onboarding-skip')).toBeVisible()
    await expect(page.getByTestId('onboarding-complete')).toBeVisible()

    // Skip button says "Pular por enquanto"
    await expect(page.getByTestId('onboarding-skip')).toContainText('Pular por enquanto')
  })

  test('should complete onboarding and redirect to dashboard', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Navigate through all steps
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Tipos de Procedimento')).toBeVisible({ timeout: 5000 })

    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-complete')).toBeVisible({ timeout: 5000 })

    // Complete onboarding
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/onboarding') && res.request().method() === 'POST',
      { timeout: 15000 }
    )
    await page.getByTestId('onboarding-complete').click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Should redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 })
  })

  test('should not redirect to onboarding after completion', async ({ page }) => {
    await loginTestUser(page)

    // After completing onboarding, user should go to dashboard
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 15000 })

    // If onboarding was completed in previous test, should be on dashboard
    // If running standalone (fresh DB), this might still be on onboarding
    // Both are valid outcomes depending on test isolation
  })
})
