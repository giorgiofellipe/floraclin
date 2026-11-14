import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { expenseInstallments, expenses, financialEntries, installments, patients, paymentRecords, tenants, users } from '@/db/schema'
import { parseBrDate } from '@/lib/dates'
import { getFinancialOverview, getRevenueOverview } from '../financial'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000f0e01'
const USER = '00000000-0000-0000-0000-0000000f0e02'
const CATEGORY = '00000000-0000-0000-0000-0000000f0e03'
const ANA = '00000000-0000-0000-0000-0000000f0e04'
const BIA = '00000000-0000-0000-0000-0000000f0e05'

const noPenalty = { appliedFineType: 'percentage', appliedFineValue: '0.00', appliedInterestRate: '0.00', appliedGracePeriodDays: 0 }

async function charge(patientId: string, createdYmd: string, parts: Array<{ amount: string; dueYmd: string; paidYmd?: string }>) {
  const [entry] = await db
    .insert(financialEntries)
    .values({
      tenantId: TENANT,
      patientId,
      description: `Cobrança ${createdYmd}`,
      totalAmount: parts.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
      installmentCount: parts.length,
      createdBy: USER,
      createdAt: parseBrDate(createdYmd),
    })
    .returning({ id: financialEntries.id })
  for (const [i, p] of parts.entries()) {
    const [inst] = await db
      .insert(installments)
      .values({
        tenantId: TENANT,
        financialEntryId: entry.id,
        installmentNumber: i + 1,
        amount: p.amount,
        amountPaid: p.paidYmd ? p.amount : '0',
        dueDate: p.dueYmd,
        status: p.paidYmd ? 'paid' : 'pending',
        paidAt: p.paidYmd ? parseBrDate(p.paidYmd) : null,
        ...noPenalty,
      })
      .returning({ id: installments.id })
    if (p.paidYmd) {
      await db.insert(paymentRecords).values({
        installmentId: inst.id,
        amount: p.amount,
        principalCovered: p.amount,
        paymentMethod: 'pix',
        paidAt: parseBrDate(p.paidYmd),
        recordedBy: USER,
      })
    }
  }
}

async function expense(createdYmd: string, parts: Array<{ amount: string; paidYmd?: string }>) {
  const [row] = await db
    .insert(expenses)
    .values({
      tenantId: TENANT,
      categoryId: CATEGORY,
      description: `Despesa ${createdYmd}`,
      totalAmount: parts.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
      installmentCount: parts.length,
      createdBy: USER,
      createdAt: parseBrDate(createdYmd),
    })
    .returning({ id: expenses.id })
  await db.insert(expenseInstallments).values(
    parts.map((p, i) => ({
      expenseId: row.id,
      installmentNumber: i + 1,
      amount: p.amount,
      dueDate: p.paidYmd ?? createdYmd,
      status: p.paidYmd ? 'paid' : 'pending',
      paidAt: p.paidYmd ? parseBrDate(p.paidYmd) : null,
    })),
  )
}

describeIntegration('Financeiro overview (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Overview', slug: 'financial-overview-test' })
    await db.insert(users).values({ id: USER, email: 'overview@test.local', fullName: 'Dra.' })
    // Entered in October, paid one part in October and one in November.
    await expense('2025-10-20', [{ amount: '300.00', paidYmd: '2025-10-25' }, { amount: '200.00', paidYmd: '2025-11-05' }])
    // Entered in November, nothing paid yet.
    await expense('2025-11-02', [{ amount: '999.00' }])

    await db.insert(patients).values([
      { id: ANA, tenantId: TENANT, fullName: 'Ana', phone: '11999990001' },
      { id: BIA, tenantId: TENANT, fullName: 'Bia', phone: '11999990002' },
    ])
    // Charged in September, paid in November.
    await charge(ANA, '2025-09-10', [{ amount: '400.00', dueYmd: '2025-11-03', paidYmd: '2025-11-03' }])
    // Charged in August: one part late, one due in 3 days, one due in 10 days.
    await charge(ANA, '2025-08-01', [
      { amount: '100.00', dueYmd: '2025-11-01' },
      { amount: '80.00', dueYmd: '2025-11-18' },
      { amount: '70.00', dueYmd: '2025-11-25' },
    ])
    await charge(BIA, '2025-11-01', [{ amount: '50.00', dueYmd: '2025-11-10' }])
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: financialEntries.id }).from(financialEntries).where(eq(financialEntries.tenantId, TENANT))).map((r) => r.id)
    const instIds = (await db.select({ id: installments.id }).from(installments).where(eq(installments.tenantId, TENANT))).map((r) => r.id)
    if (instIds.length > 0) await db.delete(paymentRecords).where(inArray(paymentRecords.installmentId, instIds))
    await db.delete(installments).where(eq(installments.tenantId, TENANT))
    if (entryIds.length > 0) await db.delete(financialEntries).where(inArray(financialEntries.id, entryIds))
    await db.delete(patients).where(eq(patients.tenantId, TENANT))
    const ids = (await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.tenantId, TENANT))).map((r) => r.id)
    if (ids.length > 0) await db.delete(expenseInstallments).where(inArray(expenseInstallments.expenseId, ids))
    await db.delete(expenses).where(eq(expenses.tenantId, TENANT))
    await db.delete(users).where(eq(users.id, USER))
    await db.delete(tenants).where(eq(tenants.id, TENANT))
  })

  // Regression: expenses were picked by expenses.createdAt, so a November
  // payment of an October expense landed in October's profit.
  it('counts an expense in the month its installment was paid, not the month it was entered', async () => {
    const october = await getRevenueOverview(TENANT, '2025-10-01', '2025-10-31')
    const november = await getRevenueOverview(TENANT, '2025-11-01', '2025-11-30')

    expect(october.summary.totalExpenses).toBe(300)
    expect(november.summary.totalExpenses).toBe(200)
  })

  it('shows the month on a cash basis, open receivables as of today, and a 6-month trend with expenses', async () => {
    const overview = await getFinancialOverview(TENANT, '2025-11', parseBrDate('2025-11-15'))

    expect(overview.summary).toEqual({ totalReceived: 400, totalExpenses: 200, totalCardFees: 0, netProfit: 200 })
    expect(overview.receivables).toEqual({
      overdue: { total: 150, patientCount: 2 },
      dueSoon: { total: 80, count: 1 },
    })
    expect(overview.byProcedureType).toEqual([{ name: 'Sem procedimento', total: 400 }])
    expect(overview.monthly).toEqual([
      { month: '2025-06', received: 0, expenses: 0 },
      { month: '2025-07', received: 0, expenses: 0 },
      { month: '2025-08', received: 0, expenses: 0 },
      { month: '2025-09', received: 0, expenses: 0 },
      { month: '2025-10', received: 0, expenses: 300 },
      { month: '2025-11', received: 400, expenses: 200 },
    ])
  })
})
