import { test, expect } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'

test.describe('Patient CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndGoToDashboard(page)

    if (page.url().includes('/onboarding')) {
      return // tests will skip individually
    }

    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('sidebar-nav-pacientes').click()
    await page.waitForURL(/\/pacientes/, { timeout: 10000 })
  })

  test('should display patient list page', async ({ page }) => {
    if (!page.url().includes('/pacientes')) {
      test.skip()
      return
    }

    // Use the heading specifically to avoid sidebar match
    await expect(
      page.locator('h1', { hasText: 'Pacientes' })
    ).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('patient-search')).toBeVisible()
    await expect(page.getByTestId('patient-new-button')).toBeVisible()
  })

  test('should search patients by name', async ({ page }) => {
    if (!page.url().includes('/pacientes')) {
      test.skip()
      return
    }

    await page.getByTestId('patient-search').fill('Sofia')
    await page.getByTestId('patient-search').press('Enter')
    // The search triggers navigation with ?busca= query param
    // Wait briefly for the URL to update
    await page.waitForTimeout(1000)
    // Click the Buscar button to trigger search
    await page.getByRole('button', { name: 'Buscar' }).click()
    await page.waitForURL(/busca=Sofia/, { timeout: 10000 })
    expect(page.url()).toContain('busca=Sofia')
  })

  test('should open new patient form', async ({ page }) => {
    if (!page.url().includes('/pacientes')) {
      test.skip()
      return
    }

    await page.getByTestId('patient-new-button').click()
    await expect(page.getByTestId('patient-form')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('patient-form-name')).toBeVisible()
    await expect(page.getByTestId('patient-form-phone')).toBeVisible()
    await expect(page.getByTestId('patient-form-submit')).toBeVisible()
  })

  test('should show patient detail with tabs', async ({ page }) => {
    if (!page.url().includes('/pacientes')) {
      test.skip()
      return
    }

    // Wait for the patient list to load (either rows or empty state)
    await expect(
      page.getByTestId('patient-row-0').or(page.getByTestId('patient-empty-state'))
    ).toBeVisible({ timeout: 10000 })

    const hasPatients = await page.getByTestId('patient-row-0').isVisible()

    if (hasPatients) {
      // Click the patient name link
      await page.getByTestId('patient-row-0').getByRole('link').first().click()
      await page.waitForURL(/\/pacientes\//, { timeout: 10000 })

      // Verify tabs are visible
      await expect(page.getByTestId('patient-tab-dados')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('patient-tab-anamnese')).toBeVisible()
      await expect(page.getByTestId('patient-tab-procedimentos')).toBeVisible()
    } else {
      // If no patients, verify the empty state is shown
      await expect(page.getByTestId('patient-empty-state')).toBeVisible()
    }
  })

  test('should navigate between patient tabs', async ({ page }) => {
    if (!page.url().includes('/pacientes')) {
      test.skip()
      return
    }

    // Wait for the patient list to load
    await expect(
      page.getByTestId('patient-row-0').or(page.getByTestId('patient-empty-state'))
    ).toBeVisible({ timeout: 10000 })

    const hasPatients = await page.getByTestId('patient-row-0').isVisible()

    if (!hasPatients) {
      test.skip()
      return
    }

    await page.getByTestId('patient-row-0').getByRole('link').first().click()
    await page.waitForURL(/\/pacientes\//, { timeout: 10000 })

    const tabs = ['dados', 'anamnese', 'procedimentos', 'fotos', 'termos', 'financeiro', 'timeline']
    for (const tab of tabs) {
      await page.getByTestId(`patient-tab-${tab}`).click()
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`), { timeout: 5000 })
    }
  })
})
