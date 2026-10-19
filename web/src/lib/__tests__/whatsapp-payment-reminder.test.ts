import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/financial', () => ({
  getInstallmentsDueReminder: vi.fn(),
  claimPaymentReminder: vi.fn(),
  releasePaymentReminder: vi.fn(),
}))

import { claimPaymentReminder, getInstallmentsDueReminder } from '@/db/queries/financial'
import { loadDueReminders } from '../whatsapp-payment-reminder'

const ARGS = { tenantId: 't1', tenantName: 'Clínica Lume', config: { daysBeforeDue: 5 } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 2026-10-17 22:00 BRT, already the 18th in UTC
  vi.setSystemTime(new Date('2026-10-18T01:00:00Z'))
  vi.mocked(getInstallmentsDueReminder).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadDueReminders', () => {
  it('looks up installments due from the BR today through daysBeforeDue days ahead', async () => {
    await loadDueReminders(ARGS)

    expect(getInstallmentsDueReminder).toHaveBeenCalledWith('t1', '2026-10-17', '2026-10-22')
  })

  it('reminds the open balance with the clinic name and BR due date, claiming that installment', async () => {
    vi.mocked(getInstallmentsDueReminder).mockResolvedValue([{
      id: 'i1',
      amount: '1500.00',
      amountPaid: '265.50',
      dueDate: '2026-10-20',
      patientId: 'p1',
      patientName: 'Maria Silva',
      patientPhone: '11999991234',
    }])
    vi.mocked(claimPaymentReminder).mockResolvedValue(true)

    const [message] = await loadDueReminders(ARGS)

    expect(message.values).toEqual({
      patient_name: 'Maria',
      amount: '1.234,50',
      clinic_name: 'Clínica Lume',
      due_date: '20/10/2026',
    })
    await message.claim()
    expect(claimPaymentReminder).toHaveBeenCalledWith('t1', 'i1')
  })
})
