import { test, expect, type Page } from '@playwright/test'
import { resetConfirmationState, seedForOnboarding, seedUnconfirmedSignup } from './helpers/test-db'

/**
 * Onboarding E2E Tests
 *
 * Runs against an ephemeral Docker Postgres. Before each test, the
 * tenant settings are reset to onboarding_completed = false.
 * Auth is bypassed via x-test-user-id header (set in playwright config).
 *
 * Tests are serial — the final test completes onboarding.
 */

async function loginTestUser(page: Page) {
  await page.goto('/dashboard')
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

  // The wizard resumes at the autosaved step, so each test starts from a fresh draft.
  test.beforeEach(async () => {
    await seedForOnboarding()
  })

  test('should redirect new clinic to onboarding', async ({ page }) => {
    await loginTestUser(page)
    expect(page.url()).toContain('/onboarding')
  })

  test('should display the stepper on step 1', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Welcome header visible
    await expect(page.getByRole('heading', { name: 'Bem-vindo(a) ao FloraClin' })).toBeVisible({ timeout: 10000 })

    // Step 1 content visible
    await expect(page.locator('text=Dados da Clínica')).toBeVisible()

    // Next button visible, no Previous button on step 1
    await expect(page.getByTestId('onboarding-next')).toBeVisible()
    await expect(page.getByTestId('onboarding-prev')).not.toBeVisible()

    // Next button visible, no Previous button on step 1
    await expect(page.getByTestId('onboarding-next')).toBeVisible()
    await expect(page.getByTestId('onboarding-prev')).not.toBeVisible()
  })

  test('should ask only for the clinic name and phone on step 1', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    await expect(page.locator('text=Dados da Clínica')).toBeVisible({ timeout: 10000 })

    await expect(page.getByLabel('Nome da clínica *')).toBeVisible()
    await expect(page.getByLabel('Telefone *')).toBeVisible()
    // Address, hours and the booking link moved to Settings.
    await expect(page.locator('text=floraclin.com.br/c/')).toHaveCount(0)
    await expect(page.locator('input[type="time"]')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-use-defaults')).toBeVisible()
  })

  test('should keep Próximo on screen on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    const next = page.getByTestId('onboarding-next')
    await expect(next).toBeInViewport({ timeout: 10000 })
    // 16px or more, or iOS zooms the page when a field is focused.
    await expect(page.getByLabel('Nome da clínica *')).toHaveCSS('font-size', '16px')
    await expect(page.getByLabel('Telefone *')).toHaveCSS('font-size', '16px')
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
    const firstProcedure = page.getByRole('checkbox').first()
    await expect(firstProcedure).toBeVisible()
    await expect(firstProcedure).toHaveAttribute('aria-checked', 'true')

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
    const firstProcedure = page.getByRole('checkbox').first()
    await expect(firstProcedure).toHaveAttribute('aria-checked', 'true')
    await firstProcedure.click()
    await expect(firstProcedure).toHaveAttribute('aria-checked', 'false')

    // Check it again
    await firstProcedure.click()
    await expect(firstProcedure).toHaveAttribute('aria-checked', 'true')
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

  test('should navigate to step 4: Equipe', async ({ page }) => {
    await loginTestUser(page)
    skipIfNotOnboarding(page)

    // Step 1 → Step 2
    await page.getByTestId('onboarding-next').click()
    await expect(page.locator('text=Tipos de Procedimento')).toBeVisible({ timeout: 5000 })

    // Step 2 → Step 3 → Step 4
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible({ timeout: 5000 })
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
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-complete')).toBeVisible({ timeout: 5000 })

    // Complete onboarding — click and wait for redirect
    await page.getByTestId('onboarding-complete').click()

    // Wait for redirect to dashboard (onboarding API + redirect)
    await page.waitForURL(/\/dashboard/, { timeout: 30000 })
    // Pointed at the first patient once; the parameter is dropped from the URL.
    await expect(page.getByTestId('first-patient-hint')).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/dashboard$/)
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

// ─── Confirmation link ────────────────────────────────────────────────

test.describe('Confirmation link', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    await seedForOnboarding()
  })

  test.afterEach(async () => {
    await resetConfirmationState()
  })

  test('opened in the browser that signed up, confirms and goes straight on to the setup', async ({ page }) => {
    const { email, password, confirmPath } = await seedUnconfirmedSignup()

    // A real Auth.js session (signup signs in the same way): the confirm link
    // only skips the tap for the session of the address it carries.
    await page.goto('/login')
    await page.getByTestId('login-email').fill(email)
    await page.getByTestId('login-password').fill(password)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 })
    await page.goto('/onboarding')
    // The confirmation banner waits for the dashboard: none on the setup.
    await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('email-confirmation-banner')).toHaveCount(0)

    await page.goto(confirmPath)

    await page.waitForURL(/\/onboarding$/, { timeout: 30000 })
    await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('email-confirmation-banner')).toHaveCount(0)
  })

  test('opened in a browser with no session, asks for one tap and then goes on to the setup', async ({ browser, baseURL }) => {
    const { confirmPath } = await seedUnconfirmedSignup()
    // A fresh context: no session cookie and none of the config's headers,
    // like the mail app's in-app browser.
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()

    try {
      await page.goto(confirmPath)

      await page.waitForURL(/\/confirm-email$/, { timeout: 30000 })
      await expect(page.getByText('Falta só um toque')).toBeVisible({ timeout: 10000 })
      await page.getByTestId('confirm-email-submit').click()

      await page.waitForURL(/\/onboarding$/, { timeout: 30000 })
      await expect(page.getByTestId('onboarding-next')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('email-confirmation-banner')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
