import { describe, expect, it } from 'vitest'
import { summarizePatientEntries } from '../patient-summary'

const entry = (over: Partial<Parameters<typeof summarizePatientEntries>[0][number]>) => ({
  status: 'pending',
  isOverdue: false,
  totalAmount: '0.00',
  totalAmountPaid: 0,
  totalFineAmount: 0,
  totalInterestAmount: 0,
  ...over,
})

describe('summarizePatientEntries', () => {
  it('splits entries into pending, overdue with fine and interest, and paid', () => {
    const totals = summarizePatientEntries([
      entry({ status: 'paid', totalAmount: '300.00', totalAmountPaid: '300.00' }),
      entry({ status: 'pending', isOverdue: true, totalAmount: '100.00', totalFineAmount: 2, totalInterestAmount: 1.5 }),
      entry({ status: 'partial', isOverdue: true, totalAmount: '100.00', totalAmountPaid: '40.00', totalFineAmount: 2, totalInterestAmount: 0.33 }),
      entry({ status: 'partial', totalAmount: '200.00', totalAmountPaid: '100.00' }),
      entry({ status: 'pending', totalAmount: '50.00' }),
      entry({ status: 'cancelled', totalAmount: '999.00' }),
      entry({ status: 'renegotiated', totalAmount: '999.00' }),
    ])

    expect(totals).toEqual({ pending: 150, overdue: 165.83, paid: 300 })
  })
})
