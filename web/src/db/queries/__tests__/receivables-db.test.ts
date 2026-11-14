import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { financialEntries, installments, patients, paymentRecords, tenants, users } from '@/db/schema'
import { brToday, shiftBrYmd } from '@/lib/dates'
import { getReceivablesTotals, listFinancialEntries } from '../financial'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000fec01'
const USER = '00000000-0000-0000-0000-0000000fec02'
const PATIENT = '00000000-0000-0000-0000-0000000fec03'

const terms = { appliedFineType: 'percentage', appliedFineValue: '2.00', appliedInterestRate: '0.00', appliedGracePeriodDays: 0 }
const day = (offset: number) => shiftBrYmd(brToday(), offset)

/** One charge; each installment is [amount, due offset in days, paid?]. */
async function charge(description: string, status: string, parts: [string, number, boolean?][]) {
  const total = parts.reduce((sum, [amount]) => sum + Number(amount), 0).toFixed(2)
  const [entry] = await db
    .insert(financialEntries)
    .values({ tenantId: TENANT, patientId: PATIENT, description, totalAmount: total, installmentCount: parts.length, status, createdBy: USER })
    .returning({ id: financialEntries.id })
  for (const [index, [amount, offset, paid]] of parts.entries()) {
    const [inst] = await db
      .insert(installments)
      .values({
        tenantId: TENANT,
        financialEntryId: entry.id,
        installmentNumber: index + 1,
        amount,
        amountPaid: paid ? amount : '0',
        dueDate: day(offset),
        status: status === 'cancelled' ? 'cancelled' : paid ? 'paid' : 'pending',
        ...terms,
      })
      .returning({ id: installments.id })
    if (paid) {
      await db.insert(paymentRecords).values({
        installmentId: inst.id,
        amount,
        paymentMethod: 'pix',
        principalCovered: amount,
        paidAt: new Date(),
        recordedBy: USER,
      })
    }
  }
  return entry.id
}

describeIntegration('Recebíveis list and totals (integration, requires test DB)', () => {
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Recebíveis', slug: 'receivables-inbox-test' })
    await db.insert(users).values({ id: USER, email: 'receivables@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990001' })
    ids.overdue = await charge('overdue', 'pending', [['100.00', -10]])
    ids.later = await charge('later', 'pending', [['70.00', 30]])
    ids.soon = await charge('soon', 'pending', [['50.00', 3]])
    ids.partial = await charge('partial', 'partial', [['200.00', -20, true], ['200.00', 5]])
    ids.paid = await charge('paid', 'paid', [['300.00', -1, true]])
    ids.cancelled = await charge('cancelled', 'cancelled', [['999.00', -5]])
  })

  afterAll(async () => {
    const entryIds = (await db.select({ id: financialEntries.id }).from(financialEntries).where(eq(financialEntries.tenantId, TENANT))).map((e) => e.id)
    const instIds = (await db.select({ id: installments.id }).from(installments).where(eq(installments.tenantId, TENANT))).map((i) => i.id)
    if (instIds.length) await db.delete(paymentRecords).where(inArray(paymentRecords.installmentId, instIds))
    await db.delete(installments).where(eq(installments.tenantId, TENANT))
    if (entryIds.length) await db.delete(financialEntries).where(inArray(financialEntries.id, entryIds))
    await db.delete(patients).where(eq(patients.tenantId, TENANT))
    await db.delete(users).where(eq(users.id, USER))
    await db.delete(tenants).where(eq(tenants.id, TENANT))
  })

  const list = async (filters: Parameters<typeof listFinancialEntries>[1]) =>
    (await listFinancialEntries(TENANT, filters)).data

  it('lists open charges by their next due date, pointing at the installment Receber pays', async () => {
    const rows = await list({ status: 'open', page: 1, limit: 20 })

    expect(rows.map((r) => r.description)).toEqual(['overdue', 'soon', 'partial', 'later'])
    const partial = rows.find((r) => r.id === ids.partial)!
    expect(partial).toMatchObject({ nextInstallmentNumber: 2, nextDueDate: day(5) })
    expect(rows[0]).toMatchObject({ nextDueDate: day(-10), isOverdue: true })
  })

  it('filters the week ahead without the overdue ones, and the month by payments received in it', async () => {
    const dueSoon = await list({ status: 'open', dueSoon: true, page: 1, limit: 20 })
    expect(dueSoon.map((r) => r.description).sort()).toEqual(['partial', 'soon'])

    const received = await list({ receivedThisMonth: true, page: 1, limit: 20 })
    expect(received.map((r) => r.description).sort()).toEqual(['paid', 'partial'])
  })

  it('totals what is overdue with its fine, what falls due in 7 days, and the cash of this month', async () => {
    expect(await getReceivablesTotals(TENANT)).toEqual({
      overdue: 102,
      dueSoon: 250,
      receivedThisMonth: 500,
    })
  })
})
