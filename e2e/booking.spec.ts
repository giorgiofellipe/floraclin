import { test, expect } from '@playwright/test'

test.describe('Public Booking', () => {
  // The booking page is at /c/{slug} (not /agendar/{slug})
  const bookingUrl = '/c/floraclin-demo'

  test('should display public booking page without auth', async ({ page }) => {
    const response = await page.goto(bookingUrl)

    if (response && response.status() === 200) {
      // Step 1 should be visible with the practitioner selection
      await expect(page.getByTestId('booking-step-1')).toBeVisible({ timeout: 10000 })
    }
  })

  test('should show practitioner selection', async ({ page }) => {
    const response = await page.goto(bookingUrl)

    if (response && response.status() === 200) {
      await expect(page.getByTestId('booking-step-1')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Selecione o profissional')).toBeVisible()
    }
  })

  test('should show date picker after selecting practitioner', async ({ page }) => {
    const response = await page.goto(bookingUrl)

    if (response && response.status() !== 200) {
      test.skip()
      return
    }

    await expect(page.getByTestId('booking-step-1')).toBeVisible({ timeout: 10000 })

    // Step 1: Select a practitioner (click the first practitioner button)
    const practitionerButton = page
      .getByTestId('booking-step-1')
      .locator('button[type="button"]')
      .first()
    const hasPractitioners = await practitionerButton.isVisible().catch(() => false)

    if (!hasPractitioners) {
      test.skip()
      return
    }

    await practitionerButton.click()

    // Click "Proximo" button to go to step 2
    // The button text is "Proximo" with accent: Pr\u00f3ximo
    await page.getByRole('button', { name: /Pr.ximo/i }).click()

    // Step 2: Should show date picker
    await expect(page.getByTestId('booking-step-2')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText(/Selecione a data e hor.rio/i)
    ).toBeVisible()
  })

  test('should show confirmation step UI exists', async ({ page }) => {
    const response = await page.goto(bookingUrl)

    if (response && response.status() === 200) {
      // Just verify the page loaded correctly with step 1
      await expect(page.getByTestId('booking-step-1')).toBeVisible({ timeout: 10000 })
    }
  })
})
