import type { Page } from '@playwright/test'

/**
 * Helper to make API calls through the browser's authenticated session.
 * This ensures we use the same auth cookies as the logged-in user.
 */
export async function apiPost(page: Page, path: string, body: Record<string, unknown>) {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: res.status, data: await res.json() }
    },
    { path, body }
  )
}

export async function apiPut(page: Page, path: string, body: Record<string, unknown>) {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: res.status, data: await res.json() }
    },
    { path, body }
  )
}

export async function apiGet(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const res = await fetch(path)
    return { status: res.status, data: await res.json() }
  }, path)
}

/**
 * Create a financial charge via API and return the entry ID.
 */
export async function createTestCharge(page: Page, options?: {
  patientId?: string
  description?: string
  totalAmount?: number
  installmentCount?: number
}) {
  // Get first patient if not specified
  let patientId = options?.patientId
  if (!patientId) {
    const patients = await apiGet(page, '/api/financial/patients')
    patientId = patients.data?.[0]?.id
    if (!patientId) throw new Error('No patients found for test charge')
  }

  const result = await apiPost(page, '/api/financial', {
    patientId,
    description: options?.description ?? 'E2E Test Charge',
    totalAmount: options?.totalAmount ?? 500,
    installmentCount: options?.installmentCount ?? 1,
  })

  if (result.status >= 400) throw new Error(`Failed to create charge: ${JSON.stringify(result.data)}`)
  return result.data
}

/**
 * Record a payment on the first pending installment of an entry.
 */
export async function recordTestPayment(page: Page, entryId: string, amount?: number) {
  // Get entry detail to find a pending installment
  const detail = await apiGet(page, `/api/financial/${entryId}`)
  const installment = detail.data?.installments?.find((i: { status: string }) => i.status === 'pending')
  if (!installment) throw new Error('No pending installment found')

  const result = await apiPut(page, `/api/financial/installments/${installment.id}/pay`, {
    amount: amount ?? Number(installment.amount),
    paymentMethod: 'pix',
  })

  if (result.status >= 400) throw new Error(`Failed to record payment: ${JSON.stringify(result.data)}`)
  return result.data
}

/**
 * Create an expense via API.
 */
export async function createTestExpense(page: Page, options?: {
  description?: string
  totalAmount?: number
  installmentCount?: number
}) {
  // Get first expense category
  const categories = await apiGet(page, '/api/financial/settings/categories')
  const categoryId = categories.data?.data?.[0]?.id ?? categories.data?.[0]?.id
  if (!categoryId) throw new Error('No expense categories found')

  const result = await apiPost(page, '/api/expenses', {
    categoryId,
    description: options?.description ?? 'E2E Test Expense',
    totalAmount: options?.totalAmount ?? 300,
    installmentCount: options?.installmentCount ?? 1,
  })

  if (result.status >= 400) throw new Error(`Failed to create expense: ${JSON.stringify(result.data)}`)
  return result.data
}

/**
 * Create an appointment via API.
 */
export async function createTestAppointment(page: Page, options?: {
  date?: string
  startTime?: string
  endTime?: string
}) {
  // Get practitioners
  const practitioners = await apiGet(page, '/api/appointments/practitioners')
  const practitionerId = practitioners.data?.[0]?.id
  if (!practitionerId) throw new Error('No practitioners found')

  const today = new Date().toISOString().split('T')[0]

  // Generate a semi-random time slot to avoid conflicts with previous test runs
  // Use minute-based offset from current time to find a free slot
  const startTime = options?.startTime
  const endTime = options?.endTime

  if (startTime && endTime) {
    const result = await apiPost(page, '/api/appointments', {
      practitionerId,
      date: options?.date ?? today,
      startTime,
      endTime,
      patientId: null,
      bookingName: 'E2E Test Appointment',
    })
    if (result.status >= 400) throw new Error(`Failed to create appointment: ${JSON.stringify(result.data)}`)
    return result.data
  }

  // Try multiple time slots until one works (avoids conflicts)
  const slots = ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30']
  for (const slot of slots) {
    const [h, m] = slot.split(':').map(Number)
    const end = `${String(h).padStart(2, '0')}:${String(m + 30).padStart(2, '0').replace('60', '00')}`
    const endHour = m + 30 >= 60 ? `${String(h + 1).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(m + 30).padStart(2, '0')}`

    const result = await apiPost(page, '/api/appointments', {
      practitionerId,
      date: options?.date ?? today,
      startTime: slot,
      endTime: endHour,
      patientId: null,
      bookingName: 'E2E Test Appointment',
    })
    if (result.status < 400) return result.data
    // If conflict, try next slot
  }

  throw new Error('Failed to create appointment: all time slots conflicted')
}
