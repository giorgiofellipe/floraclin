import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { financialEntries, installments, patients, tenants, users } from '@/db/schema'
import { brToday, shiftBrYmd } from '@/lib/dates'
import { getPatientFinancialSummary } from '../financial'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000f5a01'
const USER = '00000000-0000-0000-0000-0000000f5a02'
const PATIENT = '00000000-0000-0000-0000-0000000f5a03'

const terms = { appliedFineType: 'percentage', appliedFineValue: '2.00', appliedInterestRate: '0.00', appliedGracePeriodDays: 0 }

async function entry(status: string, total: string, dueDate: string, installmentStatus = 'pending') {
  const [e] = await db
    .insert(financialEntries)
    .values({ tenantId: TENANT, patientId: PATIENT, description: status, totalAmount: total, status, createdBy: USER })
    .returning({ id: financialEntries.id })
  await db.insert(installments).values({
    tenantId: TENANT,
    financialEntryId: e.id,
    installmentNumber: 1,
    amount: total,
    amountPaid: installmentStatus === 'paid' ? total : '0',
    dueDate,
    status: installmentStatus,
    ...terms,
  })
}

describeIntegration('getPatientFinancialSummary (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Summary', slug: 'patient-summary-test' })
    await db.insert(users).values({ id: USER, email: 'summary@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' })
    await entry('pending', '100.00', shiftBrYmd(brToday(), -10))
    await entry('pending', '50.00', shiftBrYmd(brToday(), 30))
    await entry('pending', '30.00', brToday())
    await entry('paid', '300.00', shiftBrYmd(brToday(), -40), 'paid')
    await entry('cancelled', '999.00', shiftBrYmd(brToday(), -5), 'cancelled')
  })

  it('matches the Financeiro section: pending apart from overdue, overdue with its fine', async () => {
    expect(await getPatientFinancialSummary(TENANT, PATIENT)).toEqual({
      openAmount: 80,
      overdueAmount: 102,
      nextDueDate: brToday(),
    })
  })
})
