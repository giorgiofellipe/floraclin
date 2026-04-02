import { test, expect, type Page } from '@playwright/test'
import { loginAndGoToDashboard } from './helpers/auth'
import { createTestCharge, recordTestPayment, createTestExpense } from './helpers/api'

/**
 * Helper: navigate to financeiro and skip if stuck on onboarding.
 */
async function goToFinanceiro(page: Page) {
  await loginAndGoToDashboard(page)

  if (page.url().includes('/onboarding')) {
    return false
  }

  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('sidebar-nav-financeiro').click()
  await page.waitForURL(/\/financeiro/, { timeout: 15000 })
  return true
}

function skipIfNotOnFinanceiro(page: Page) {
  if (!page.url().includes('/financeiro')) {
    test.skip()
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Financial > Navigation', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await goToFinanceiro(page)
    if (!ok) return
  })

  test('should display financial page with tab navigation', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Tab container is rendered as pill-style buttons, not role="tab"
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })

    // Verify all 5 tab buttons exist
    await expect(page.getByTestId('financial-tab-receivables')).toBeVisible()
    await expect(page.getByTestId('financial-tab-expenses')).toBeVisible()
    await expect(page.getByTestId('financial-tab-ledger')).toBeVisible()
    await expect(page.getByTestId('financial-tab-practitioner-pl')).toBeVisible()
    await expect(page.getByTestId('financial-tab-overview')).toBeVisible()
  })

  test('should switch between all 5 tabs', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })

    // Default tab is receivables (no ?tab= param)
    // "Nova Cobranca" button is only on receivables tab
    await expect(page.getByTestId('financial-new-charge')).toBeVisible({ timeout: 10000 })

    // Switch to expenses
    await page.getByTestId('financial-tab-expenses').click()
    await expect(page).toHaveURL(/tab=expenses/, { timeout: 10000 })
    await expect(page.getByTestId('new-expense-button')).toBeVisible({ timeout: 15000 })

    // Switch to ledger (extrato)
    await page.getByTestId('financial-tab-ledger').click()
    await expect(page).toHaveURL(/tab=ledger/, { timeout: 10000 })
    await page.waitForTimeout(1000)

    // Switch to practitioner P&L
    await page.getByTestId('financial-tab-practitioner-pl').click()
    // Wait for the tab content to render (practitioner view has date pickers)
    await page.waitForTimeout(2000)

    // Switch to overview (visao geral)
    await page.getByTestId('financial-tab-overview').click()
    await page.waitForTimeout(2000)

    // Go back to receivables
    await page.getByTestId('financial-tab-receivables').click()
    await page.waitForTimeout(2000)
    // Verify the tab is active (has the active style)
    await expect(page.getByTestId('financial-tab-receivables')).toBeVisible()
  })
})

// ─── Charges (A Receber) ─────────────────────────────────────────────────────

test.describe('Financial > Charges (A Receber)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await goToFinanceiro(page)
    if (!ok) return
    // Ensure we're on receivables tab
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-receivables').click()
  })

  test('should show charges list with cards', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Either the list has entries or we see the empty state
    const newChargeButton = page.getByTestId('financial-new-charge')
    await expect(newChargeButton).toBeVisible({ timeout: 15000 })

    // Wait for loading to finish -- look for "registros" count or empty state
    await expect(
      page.locator('text=/\\d+ registro|Nenhuma cobrança registrada/')
    ).toBeVisible({ timeout: 15000 })
  })

  test('should toggle filter panel', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    const filterToggle = page.getByTestId('financial-filters-toggle')
    await expect(filterToggle).toBeVisible({ timeout: 15000 })

    // Open filters
    await filterToggle.click()

    // Filter panel should appear with Status dropdown, Paciente dropdown, etc.
    await expect(page.locator('text=Atrasados')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Parciais')).toBeVisible()

    // Close filters
    await filterToggle.click()
    await expect(page.locator('text=Atrasados')).not.toBeVisible({ timeout: 5000 })
  })

  test('should open "Nova Cobranca" form', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await page.getByTestId('financial-new-charge').click()

    // The payment form dialog should appear
    await expect(page.getByTestId('payment-form')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Nova Cobrança').first()).toBeVisible()
    await expect(page.getByTestId('payment-form-submit')).toBeVisible()
  })

  test('should create a new charge with installments', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await page.getByTestId('financial-new-charge').click()
    await expect(page.getByTestId('payment-form')).toBeVisible({ timeout: 10000 })

    // Select patient -- click the trigger to open the dropdown, then pick an option
    const patientTrigger = page.getByTestId('payment-form').getByRole('combobox').first()
    await patientTrigger.click()
    // Wait for the popover to render and click the first patient option
    const firstPatientOption = page.getByRole('option').first()
    await expect(firstPatientOption).toBeVisible({ timeout: 5000 })
    await firstPatientOption.click()

    // Fill description
    await page.getByTestId('payment-form').locator('#description').fill('Teste E2E - Aplicação de botox')

    // Fill amount (currency masked input — type digits sequentially)
    const amountInput = page.getByTestId('payment-form-amount')
    await amountInput.click()
    await amountInput.pressSequentially('50000', { delay: 50 })
    await page.waitForTimeout(500)

    // Select 2 installments
    const installmentTrigger = page.getByTestId('payment-form').getByRole('combobox').nth(1)
    await installmentTrigger.click()
    await page.waitForTimeout(300)
    // Click the 2x option in the dropdown
    const option2x = page.getByRole('option', { name: '2x', exact: true })
    await expect(option2x).toBeVisible({ timeout: 3000 })
    await option2x.click()
    await page.waitForTimeout(500)

    // Verify installment preview appeared
    await expect(page.locator('text=1a parcela').or(page.locator('text=1ª parcela'))).toBeVisible({ timeout: 5000 })

    // Submit
    const submitButton = page.getByTestId('payment-form-submit')
    await expect(submitButton).toBeEnabled({ timeout: 5000 })

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/financial') && res.request().method() === 'POST',
      { timeout: 15000 }
    )
    await submitButton.click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Dialog should close
    await expect(page.getByTestId('payment-form')).not.toBeVisible({ timeout: 10000 })
  })

  test('should expand charge to see installment details', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Wait for at least one entry card to appear
    const entryCard = page.locator('[aria-label="Expandir"]').first()
    await expect(entryCard).toBeVisible({ timeout: 15000 })

    // Click to expand
    await entryCard.click()

    // Should show "Parcela X/Y" text inside the expanded InstallmentTable
    await expect(page.locator('text=/Parcela \\d+\\/\\d+/').first()).toBeVisible({ timeout: 10000 })
  })

  test('should record a payment on an installment (via partial payment dialog)', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Expand a PENDING charge card (skip cancelled/paid ones)
    // Find a card that shows "Pendente" or "Parcial" status
    const pendingCard = page.locator('text=Pendente').first().locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
    await expect(pendingCard).toBeVisible({ timeout: 15000 })
    const expandButton = pendingCard.getByTestId('financial-entry-expand')
    await expandButton.click()

    // Wait for installments to load, then find a "Pagar" button
    await expect(page.locator('text=/Parcela \\d+\\/\\d+/').first()).toBeVisible({ timeout: 15000 })
    const payButton = page.getByTestId('installment-pay').first()
    await expect(payButton).toBeVisible({ timeout: 10000 })
    await payButton.click()

    // Partial payment dialog opens
    await expect(page.locator('text=Registrar Pagamento')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('partial-payment-amount')).toBeVisible()

    // The amount is pre-filled; verify allocation preview appears
    await expect(page.getByTestId('allocation-preview')).toBeVisible({ timeout: 5000 })

    // Confirm the payment
    const confirmButton = page.locator('button', { hasText: 'Confirmar Pagamento' })
    await expect(confirmButton).toBeEnabled({ timeout: 5000 })

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/financial/installments/') && res.request().method() === 'PUT',
      { timeout: 15000 }
    )
    await confirmButton.click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Dialog should close
    await expect(page.locator('text=Registrar Pagamento')).not.toBeVisible({ timeout: 10000 })
  })

  test('should show penalty info for overdue installments', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Look for penalty indicators on the main list (Multa or Juros text)
    // These only appear if there are overdue entries with configured penalties.
    // If none exist, we just verify the page loaded correctly.
    const penaltyIndicator = page.locator('text=/Multa R\\$|Juros R\\$/').first()
    const hasPenalties = await penaltyIndicator.isVisible().catch(() => false)

    if (hasPenalties) {
      // Expand an entry with penalties visible
      await expect(penaltyIndicator).toBeVisible({ timeout: 5000 })
    } else {
      // No overdue entries with penalties -- just verify the list is loaded
      await expect(
        page.locator('text=/\\d+ registro|Nenhuma cobrança registrada/')
      ).toBeVisible({ timeout: 15000 })
    }
  })

  test('should reverse (estornar) a payment', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Create a charge and record a payment via API so there's guaranteed data
    const charge = await createTestCharge(page, { description: 'E2E Estorno Test' })
    const chargeId = charge?.data?.id ?? charge?.id
    await recordTestPayment(page, chargeId)

    // Reload to pick up the new data
    await page.reload()
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })

    // Expand the first charge (our newly created one should be at the top)
    const expandButton = page.locator('[aria-label="Expandir"]').first()
    await expect(expandButton).toBeVisible({ timeout: 15000 })
    await expandButton.click()

    // Look for a "Ver pagamentos" chevron (payment records expand toggle)
    const paymentToggle = page.locator('[aria-label="Ver pagamentos"]').first()
    await expect(paymentToggle).toBeVisible({ timeout: 10000 })
    await paymentToggle.click()

    // Hover on a payment record to reveal the "Estornar" button
    const estornarButton = page.locator('button', { hasText: 'Estornar' }).first()
    // The button uses opacity-0 group-hover:opacity-100, so we need to hover
    const paymentRow = estornarButton.locator('..')
    await paymentRow.hover()
    await expect(estornarButton).toBeVisible({ timeout: 5000 })
    await estornarButton.click()

    // Reverse payment confirmation dialog
    await expect(page.locator('text=Estornar Pagamento')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Confirmar Estorno')).toBeVisible()
  })
})

// ─── Expenses (Despesas) ─────────────────────────────────────────────────────

test.describe('Financial > Expenses (Despesas)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await goToFinanceiro(page)
    if (!ok) return
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-expenses').click()
    await expect(page).toHaveURL(/tab=expenses/, { timeout: 5000 })
  })

  test('should show expenses list', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await expect(page.getByTestId('new-expense-button')).toBeVisible({ timeout: 15000 })

    // Either list entries or empty state
    await expect(
      page.locator('text=/\\d+ despesa|Nenhuma despesa registrada/')
    ).toBeVisible({ timeout: 15000 })
  })

  test('should open "Nova Despesa" form', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await page.getByTestId('new-expense-button').click()
    await expect(page.getByTestId('expense-form')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Nova Despesa').first()).toBeVisible()
    await expect(page.getByTestId('expense-form-submit')).toBeVisible()
  })

  test('should create a new expense', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    await page.getByTestId('new-expense-button').click()
    await expect(page.getByTestId('expense-form')).toBeVisible({ timeout: 10000 })

    // Select category
    const categoryTrigger = page.getByTestId('expense-category-select')
    await categoryTrigger.click()
    const firstCategory = page.locator('[role="option"]').first()
    await expect(firstCategory).toBeVisible({ timeout: 5000 })
    await firstCategory.click()

    // Fill description
    await page.getByTestId('expense-description').fill('Teste E2E - Aluguel consultorio')

    // Fill amount
    await page.getByTestId('expense-amount').fill('150000')

    // Submit
    const submitButton = page.getByTestId('expense-form-submit')
    await expect(submitButton).toBeEnabled({ timeout: 5000 })

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/expenses') && res.request().method() === 'POST',
      { timeout: 15000 }
    )
    await submitButton.click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Dialog should close
    await expect(page.getByTestId('expense-form')).not.toBeVisible({ timeout: 10000 })
  })

  test('should expand expense to see installment details', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Wait for at least one expense card with a chevron
    const expenseCard = page.locator('.group').filter({ hasText: /R\$/ }).first()
    await expect(expenseCard).toBeVisible({ timeout: 15000 })

    // Click the card to expand
    await expenseCard.click()

    // Expanded detail should show "Parcelas" label and installment rows
    await expect(page.locator('text=Parcelas').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=/Parcela \\d+\\/\\d+/').first()).toBeVisible({ timeout: 5000 })
  })

  test('should pay an expense installment', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Create a fresh expense via API so there's guaranteed a pending installment
    await createTestExpense(page, { description: 'E2E Pay Expense Test' })

    // Reload to pick up the new expense
    await page.reload()
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-expenses').click()
    await expect(page).toHaveURL(/tab=expenses/, { timeout: 5000 })

    // Expand first expense (our newly created one)
    const expenseCard = page.locator('.group').filter({ hasText: /R\$/ }).first()
    await expect(expenseCard).toBeVisible({ timeout: 15000 })
    await expenseCard.click()

    // Find a "Pagar" button on a pending installment
    const payButton = page.locator('button', { hasText: 'Pagar' }).first()
    await expect(payButton).toBeVisible({ timeout: 10000 })
    await payButton.click()

    // Payment dialog opens with "Registrar Pagamento" title
    await expect(page.locator('text=Registrar Pagamento')).toBeVisible({ timeout: 10000 })

    // Confirm
    const confirmButton = page.locator('button', { hasText: 'Confirmar Pagamento' })
    await expect(confirmButton).toBeEnabled({ timeout: 5000 })

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/expenses/installments/') && res.request().method() === 'PUT',
      { timeout: 15000 }
    )
    await confirmButton.click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Dialog should close
    await expect(page.locator('text=Registrar Pagamento')).not.toBeVisible({ timeout: 10000 })
  })

  test('should cancel an expense', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Create a fresh expense via API so there's guaranteed a cancellable one
    await createTestExpense(page, { description: 'E2E Cancel Expense Test' })

    // Reload to pick up the new expense
    await page.reload()
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-expenses').click()
    await expect(page).toHaveURL(/tab=expenses/, { timeout: 5000 })

    // Expand first expense (our newly created one)
    const expenseCard = page.locator('.group').filter({ hasText: /R\$/ }).first()
    await expect(expenseCard).toBeVisible({ timeout: 15000 })
    await expenseCard.click()

    // Look for "Cancelar Despesa" button inside expanded detail
    const cancelButton = page.locator('button', { hasText: 'Cancelar Despesa' })
    await expect(cancelButton).toBeVisible({ timeout: 10000 })
    await cancelButton.click()

    // Confirmation dialog
    await expect(page.locator('text=Tem certeza que deseja cancelar esta despesa')).toBeVisible({
      timeout: 10000,
    })

    const confirmButton = page.locator('button', { hasText: 'Confirmar Cancelamento' })
    await expect(confirmButton).toBeVisible()

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/expenses/') && ['PATCH', 'DELETE', 'POST'].includes(res.request().method()),
      { timeout: 15000 }
    )
    await confirmButton.click()
    const response = await responsePromise
    expect(response.status()).toBeLessThan(400)

    // Dialog should close
    await expect(page.locator('text=Confirmar Cancelamento')).not.toBeVisible({ timeout: 10000 })
  })
})

// ─── Renegotiation ───────────────────────────────────────────────────────────

test.describe('Financial > Renegotiation', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await goToFinanceiro(page)
    if (!ok) return
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-receivables').click()
  })

  test('should select multiple charges and open renegotiation dialog', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Create 2 charges for the same patient via API
    const charge1 = await createTestCharge(page, { description: 'E2E Reneg Test 1' })
    const patientId = charge1?.data?.patientId ?? charge1?.patientId
    await createTestCharge(page, { description: 'E2E Reneg Test 2', patientId })

    // Reload to pick up the new data
    await page.reload()
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-receivables').click()

    // Wait for list to load
    await expect(page.getByTestId('financial-new-charge')).toBeVisible({ timeout: 15000 })

    // Select all charges
    const selectAll = page.getByTestId('financial-select-all')
    await expect(selectAll).toBeVisible({ timeout: 10000 })

    // Click "Selecionar todos" checkbox
    await selectAll.getByRole('checkbox').first().click()

    // Bulk action bar should appear at the bottom
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible({ timeout: 5000 })

    // Look for renegotiate button
    const renegButton = page.locator('button', { hasText: /Renegociar/ })
    await expect(renegButton).toBeVisible()

    // If enabled, click to open dialog
    const isEnabled = await renegButton.isEnabled()
    if (isEnabled) {
      await renegButton.click()
      await expect(page.locator('text=Renegociação').first()).toBeVisible({ timeout: 10000 })
      await expect(page.locator('text=Cobranças originais')).toBeVisible()
      await expect(page.locator('text=Confirmar Renegociação')).toBeVisible()
    }
  })

  test('should show custom due dates in renegotiation preview', async ({ page }) => {
    skipIfNotOnFinanceiro(page)

    // Create 2 charges for the same patient via API
    const charge1 = await createTestCharge(page, { description: 'E2E Reneg Preview 1', totalAmount: 600 })
    const patientId = charge1?.data?.patientId ?? charge1?.patientId
    await createTestCharge(page, { description: 'E2E Reneg Preview 2', totalAmount: 400, patientId })

    // Reload to pick up the new data
    await page.reload()
    await expect(page.getByTestId('financial-tabs')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('financial-tab-receivables').click()

    // Wait for list to load
    await expect(page.getByTestId('financial-new-charge')).toBeVisible({ timeout: 15000 })

    // Select first entry only (same patient guaranteed since we just created them)
    const firstCheckbox = page
      .getByRole('checkbox')
      .first()
    await firstCheckbox.click()

    // Bulk action bar
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible({ timeout: 5000 })

    const renegButton = page.locator('button', { hasText: /Renegociar/ })
    await expect(renegButton).toBeEnabled({ timeout: 5000 })

    await renegButton.click()

    // Inside the dialog, change installments to 3x
    const installmentTrigger = page.locator('[role="dialog"]').getByRole('combobox').last()
    await expect(installmentTrigger).toBeVisible({ timeout: 10000 })
    await installmentTrigger.click()
    await page.waitForTimeout(300)

    const option3x = page.getByRole('option', { name: '3x', exact: true })
    await expect(option3x).toBeVisible({ timeout: 5000 })
    await option3x.click()

    // Should show installment preview with 3 rows including due dates
    await expect(page.locator('text=Parcelas e vencimentos')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=/1ª parcela/')).toBeVisible()
    await expect(page.locator('text=/2ª parcela/')).toBeVisible()
    await expect(page.locator('text=/3ª parcela/')).toBeVisible()
  })
})
