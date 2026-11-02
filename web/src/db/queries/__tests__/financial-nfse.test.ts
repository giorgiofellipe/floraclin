import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  cardPayments,
  cardTerminals,
  cashMovements,
  financialEntries,
  installments,
  nfseDocuments,
  patients,
  paymentRecords,
  tenants,
} from '@/db/schema'

const getNfseSettingsMock = vi.fn()
vi.mock('@/db/queries/nfse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/queries/nfse')>()),
  getNfseSettings: (...args: unknown[]) => getNfseSettingsMock(...args),
}))

const createDocumentsSpy = vi.fn()
vi.mock('@/lib/nfse/emission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/nfse/emission')>()
  createDocumentsSpy.mockImplementation(actual.createDocuments)
  return { ...actual, createDocuments: (...args: Parameters<typeof actual.createDocuments>) => createDocumentsSpy(...args) }
})

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn().mockResolvedValue({ inserted: false }),
  resolveMetaEventPrerequisites: vi.fn().mockResolvedValue(null),
  claimAndSendPendingEvent: vi.fn(),
}))

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000f6a01'
const USER = '00000000-0000-0000-0000-0000000f6b01'
const PATIENT = '00000000-0000-0000-0000-0000000f6c01'
const TERMINAL = '00000000-0000-0000-0000-0000000f6d01'

const ALWAYS = { configured: true, emissionMode: 'always', emailPatient: true }
const ASK = { configured: true, emissionMode: 'ask', emailPatient: false }

async function seedInstallment(amount = '100.00') {
  const entryId = crypto.randomUUID()
  const installmentId = crypto.randomUUID()
  await db.insert(financialEntries).values({
    id: entryId,
    tenantId: TENANT,
    patientId: PATIENT,
    description: 'Teste',
    totalAmount: amount,
    createdBy: USER,
  })
  await db.insert(installments).values({
    id: installmentId,
    tenantId: TENANT,
    financialEntryId: entryId,
    installmentNumber: 1,
    amount,
    dueDate: '2099-01-01',
    appliedFineType: 'percentage',
    appliedFineValue: '2',
    appliedInterestRate: '1',
    appliedGracePeriodDays: 0,
  })
  return { entryId, installmentId, amount }
}

function payInput(seed: { installmentId: string; amount: string }) {
  return {
    installmentId: seed.installmentId,
    amount: Number(seed.amount),
    paymentMethod: 'pix' as const,
    expectedTotalDue: Number(seed.amount),
  }
}

async function documentsFor(paymentRecordId: string) {
  return db.select().from(nfseDocuments).where(eq(nfseDocuments.paymentRecordId, paymentRecordId))
}

async function cleanup() {
  const entryIds = (
    await db.select({ id: financialEntries.id }).from(financialEntries).where(eq(financialEntries.tenantId, TENANT))
  ).map((r) => r.id)
  const installmentIds = (
    await db.select({ id: installments.id }).from(installments).where(eq(installments.tenantId, TENANT))
  ).map((r) => r.id)
  await db.delete(nfseDocuments).where(eq(nfseDocuments.tenantId, TENANT))
  await db.delete(cashMovements).where(eq(cashMovements.tenantId, TENANT))
  if (installmentIds.length > 0) {
    await db.delete(paymentRecords).where(inArray(paymentRecords.installmentId, installmentIds))
  }
  await db.delete(cardPayments).where(eq(cardPayments.tenantId, TENANT))
  await db.delete(installments).where(eq(installments.tenantId, TENANT))
  if (entryIds.length > 0) await db.delete(financialEntries).where(inArray(financialEntries.id, entryIds))
}

describeIntegration('payment and reversal NFS-e integration (requires test DB)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`INSERT INTO floraclin.users (id, email, full_name) VALUES (${USER}, 'financial-nfse@example.com', 'Financial Nfse') ON CONFLICT DO NOTHING`,
    )
    await db.insert(tenants).values({ id: TENANT, name: 'Financial Nfse', slug: 'financial-nfse-test' }).onConflictDoNothing()
    await db
      .insert(patients)
      .values({ id: PATIENT, tenantId: TENANT, fullName: 'Paciente Nfse', phone: '11999990011' })
      .onConflictDoNothing()
    await db
      .insert(cardTerminals)
      .values({
        id: TERMINAL,
        tenantId: TENANT,
        name: 'Maquininha',
        debitRate: '1',
        creditRates: Array(12).fill('2'),
        creditPayoutMode: 'lump_sum',
      })
      .onConflictDoNothing()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    createDocumentsSpy.mockImplementation((await vi.importActual<typeof import('@/lib/nfse/emission')>('@/lib/nfse/emission')).createDocuments)
    getNfseSettingsMock.mockResolvedValue(ALWAYS)
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
  })

  it('always mode writes a pending row in the payment transaction', async () => {
    const { recordPayment } = await import('../financial')
    const seed = await seedInstallment()

    const result = await recordPayment(TENANT, USER, payInput(seed))

    expect(result.nfse).toMatchObject({ mode: 'always', promptPaymentRecordIds: [] })
    expect(result.nfse.documentIds).toHaveLength(1)
    const [doc] = await documentsFor(result.paymentRecord.id)
    expect(doc).toMatchObject({ id: result.nfse.documentIds[0], status: 'pending', emailRequested: true })
  })

  it('ask mode returns the new payment record ids', async () => {
    getNfseSettingsMock.mockResolvedValue(ASK)
    const { recordPayment } = await import('../financial')
    const seed = await seedInstallment()

    const result = await recordPayment(TENANT, USER, payInput(seed))

    expect(result.nfse).toEqual({ mode: 'ask', documentIds: [], promptPaymentRecordIds: [result.paymentRecord.id] })
    expect(await documentsFor(result.paymentRecord.id)).toHaveLength(0)
  })

  it('a settings read failure does not fail the payment', async () => {
    getNfseSettingsMock.mockRejectedValue(new Error('pool exhausted'))
    const { recordPayment } = await import('../financial')
    const seed = await seedInstallment()

    const result = await recordPayment(TENANT, USER, payInput(seed))

    expect(result.nfse).toEqual({ mode: null, documentIds: [], promptPaymentRecordIds: [] })
    const [stored] = await db.select().from(paymentRecords).where(eq(paymentRecords.id, result.paymentRecord.id))
    expect(stored).toBeDefined()
  })

  it('a failing outbox insert does not roll back the payment', async () => {
    createDocumentsSpy.mockImplementationOnce(async (tx: typeof db) => {
      await tx.execute(sql`SELECT 1 / 0`)
      return []
    })
    const { recordPayment } = await import('../financial')
    const seed = await seedInstallment()

    const result = await recordPayment(TENANT, USER, payInput(seed))

    expect(result.nfse.documentIds).toEqual([])
    const [stored] = await db.select().from(paymentRecords).where(eq(paymentRecords.id, result.paymentRecord.id))
    expect(stored).toBeDefined()
    const [installment] = await db.select().from(installments).where(eq(installments.id, seed.installmentId))
    expect(installment.status).toBe('paid')
  })

  it('bulk pay creates one row per payment record and returns results with nfse', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const a = await seedInstallment('100.00')
    const b = await seedInstallment('250.00')

    const { results, nfse } = await bulkPayInstallments(TENANT, USER, {
      installmentIds: [a.installmentId, b.installmentId],
      paymentMethod: 'pix',
    })

    const recordIds = results.map((r) => r.paymentRecord.id).sort()
    expect(nfse.mode).toBe('always')
    expect([...nfse.documentIds]).toHaveLength(2)
    const docs = await db.select().from(nfseDocuments).where(inArray(nfseDocuments.paymentRecordId, recordIds))
    expect(docs.map((d) => d.paymentRecordId).sort()).toEqual(recordIds)
  })

  it('reversal marks a pending row as payment_reversed', async () => {
    const { recordPayment, reversePayment } = await import('../financial')
    const seed = await seedInstallment()
    const { paymentRecord } = await recordPayment(TENANT, USER, payInput(seed))

    const result = await reversePayment(TENANT, USER, paymentRecord.id, undefined, { cancelNfse: true })

    expect(result.nfseCancelDocumentIds).toEqual([])
    const [doc] = await documentsFor(paymentRecord.id)
    expect(doc).toMatchObject({ status: 'failed', errorCode: 'payment_reversed' })
  })

  it('reversal cancels the notes of every payment record of a card payment', async () => {
    const { bulkPayInstallments, reversePayment } = await import('../financial')
    const a = await seedInstallment('100.00')
    const b = await seedInstallment('200.00')
    const { results, nfse } = await bulkPayInstallments(TENANT, USER, {
      installmentIds: [a.installmentId, b.installmentId],
      paymentMethod: 'pix',
    })
    const recordIds = results.map((r) => r.paymentRecord.id)
    const [card] = await db
      .insert(cardPayments)
      .values({
        tenantId: TENANT,
        cardTerminalId: TERMINAL,
        patientId: PATIENT,
        method: 'credit_card',
        installmentCount: 1,
        rate: '2',
        payoutMode: 'lump_sum',
        grossAmount: '300',
        feeAmount: '6',
        netAmount: '294',
        description: 'Teste',
        paidAt: new Date(),
        createdBy: USER,
      })
      .returning({ id: cardPayments.id })
    await db.update(paymentRecords).set({ cardPaymentId: card.id }).where(inArray(paymentRecords.id, recordIds))
    await db.update(nfseDocuments).set({ status: 'issued' }).where(inArray(nfseDocuments.id, nfse.documentIds))

    const result = await reversePayment(TENANT, USER, recordIds[0], undefined, { cancelNfse: true })

    expect([...result.nfseCancelDocumentIds].sort()).toEqual([...nfse.documentIds].sort())
    const docs = await db.select().from(nfseDocuments).where(inArray(nfseDocuments.id, nfse.documentIds))
    expect(docs.every((d) => d.cancelRequestedAt !== null)).toBe(true)
  })

  it('reversal keeps issued notes when cancelNfse is false but still stops an in-flight one', async () => {
    const { bulkPayInstallments, reversePayment } = await import('../financial')
    const a = await seedInstallment('100.00')
    const b = await seedInstallment('200.00')
    const { results } = await bulkPayInstallments(TENANT, USER, {
      installmentIds: [a.installmentId, b.installmentId],
      paymentMethod: 'pix',
    })
    const [issuedRecord, inFlightRecord] = results.map((r) => r.paymentRecord.id)
    await db.update(nfseDocuments).set({ status: 'issued' }).where(eq(nfseDocuments.paymentRecordId, issuedRecord))
    await db.update(nfseDocuments).set({ status: 'processing' }).where(eq(nfseDocuments.paymentRecordId, inFlightRecord))

    const first = await reversePayment(TENANT, USER, issuedRecord, undefined, { cancelNfse: false })
    const second = await reversePayment(TENANT, USER, inFlightRecord, undefined, { cancelNfse: false })

    expect(first.nfseCancelDocumentIds).toEqual([])
    const [issued] = await documentsFor(issuedRecord)
    expect(issued).toMatchObject({ status: 'issued', cancelRequestedAt: null })
    const [inFlight] = await documentsFor(inFlightRecord)
    expect(second.nfseCancelDocumentIds).toEqual([inFlight.id])
    expect(inFlight.cancelRequestedAt).not.toBeNull()
  })
})
