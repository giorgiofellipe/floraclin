import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers/auth'

test.describe('Patient CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByTestId('sidebar-nav-pacientes').click()
    await page.waitForURL(/\/pacientes/)
  })

  test('should display patient list page', async ({ page }) => {
    await expect(page.getByText('Pacientes')).toBeVisible()
    await expect(page.getByTestId('patient-search')).toBeVisible()
    await expect(page.getByTestId('patient-new-button')).toBeVisible()
  })

  test('should search patients by name', async ({ page }) => {
    await page.getByTestId('patient-search').fill('Maria')
    await page.getByTestId('patient-search').press('Enter')
    await page.waitForURL(/busca=Maria/)
    // Verify search param is in URL
    expect(page.url()).toContain('busca=Maria')
  })

  test('should open new patient form', async ({ page }) => {
    await page.getByTestId('patient-new-button').click()
    await expect(page.getByTestId('patient-form')).toBeVisible()
    await expect(page.getByTestId('patient-form-name')).toBeVisible()
    await expect(page.getByTestId('patient-form-phone')).toBeVisible()
    await expect(page.getByTestId('patient-form-submit')).toBeVisible()
  })

  test('should show patient detail with tabs', async ({ page }) => {
    // Try clicking the first patient row if it exists
    const firstRow = page.getByTestId('patient-row-0')
    const hasPatients = await firstRow.isVisible().catch(() => false)

    if (hasPatients) {
      // Click the patient name link
      await firstRow.getByRole('link').first().click()
      await page.waitForURL(/\/pacientes\//)

      // Verify tabs are visible
      await expect(page.getByTestId('patient-tab-dados')).toBeVisible()
      await expect(page.getByTestId('patient-tab-anamnese')).toBeVisible()
      await expect(page.getByTestId('patient-tab-procedimentos')).toBeVisible()
    } else {
      // If no patients, verify the empty state is shown
      await expect(page.getByTestId('patient-empty-state')).toBeVisible()
    }
  })

  test('should navigate between patient tabs', async ({ page }) => {
    const firstRow = page.getByTestId('patient-row-0')
    const hasPatients = await firstRow.isVisible().catch(() => false)

    if (!hasPatients) {
      test.skip()
      return
    }

    await firstRow.getByRole('link').first().click()
    await page.waitForURL(/\/pacientes\//)

    const tabs = ['dados', 'anamnese', 'procedimentos', 'fotos', 'termos', 'financeiro', 'timeline']
    for (const tab of tabs) {
      await page.getByTestId(`patient-tab-${tab}`).click()
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`))
    }
  })
})
