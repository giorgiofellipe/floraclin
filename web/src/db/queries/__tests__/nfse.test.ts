import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  financialEntries,
  installments,
  nfseDocuments,
  nfseDpsSequences,
  nfseSettings,
  patients,
  paymentRecords,
  tenants,
} from '@/db/schema'
import {
  claimDocument,
  getNfseSettings,
  getNfseSettingsWithSecrets,
  insertPendingDocuments,
  listAlwaysPaymentsMissingDocuments,
  listPaymentRecordsForEmission,
  nextDpsNumber,
  saveCertificate,
  saveFiscalSettings,
} from '../nfse'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT_A = '00000000-0000-0000-0000-0000000f5a01'
const TENANT_B = '00000000-0000-0000-0000-0000000f5a02'
const USER = '00000000-0000-0000-0000-0000000f5b01'
const PATIENT_A = '00000000-0000-0000-0000-0000000f5c01'
const PATIENT_B = '00000000-0000-0000-0000-0000000f5c02'
const ENTRY_A = '00000000-0000-0000-0000-0000000f5d01'
const ENTRY_B = '00000000-0000-0000-0000-0000000f5d02'
const INSTALLMENT_A = '00000000-0000-0000-0000-0000000f5e01'
const INSTALLMENT_B = '00000000-0000-0000-0000-0000000f5e02'
const PAYMENT_1 = '00000000-0000-0000-0000-0000000f5f01'
const PAYMENT_2 = '00000000-0000-0000-0000-0000000f5f02'
const PAYMENT_B = '00000000-0000-0000-0000-0000000f5f03'
const TENANTS = [TENANT_A, TENANT_B]
const CNPJ = '11222333000181'
const SEQ_KEY = { cnpj: '99888777000166', municipalityCode: '3550308', series: '00800' }

const cert = {
  cnpj: CNPJ,
  subject: 'CN=Clinica Teste',
  issuer: 'CN=AC Teste',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  pfxBase64: 'cGZ4LWJ5dGVz',
  password: 'senha-secreta',
}

const fiscal = {
  municipalityCode: '3550308',
  municipalRegistration: null,
  simplesNacionalOption: 1 as const,
  simplesNacionalRegime: null,
  simplesNacionalTaxRate: null,
  servicePreset: 'estetica' as const,
  advancedCodes: null,
  issRate: 2,
  issWithheld: false,
  emissionMode: 'ask' as const,
  emailPatient: false,
  clinicAddressFallback: false,
}

function docRow(paymentRecordId: string, tenantId = TENANT_A, patientId = PATIENT_A) {
  return {
    tenantId,
    paymentRecordId,
    patientId,
    environment: 'restricted' as const,
    value: '100.00',
    competenceDate: '2026-11-02',
    emailRequested: false,
    createdBy: USER,
  }
}

async function insertDoc(paymentRecordId: string, patch: Partial<typeof nfseDocuments.$inferInsert> = {}) {
  const [row] = await db
    .insert(nfseDocuments)
    .values({ ...docRow(paymentRecordId), ...patch })
    .returning({ id: nfseDocuments.id })
  return row.id
}

async function clearDocuments() {
  await db.delete(nfseDocuments).where(inArray(nfseDocuments.tenantId, TENANTS))
}

describeIntegration('nfse queries (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO floraclin.users (id, email, full_name) VALUES (${USER}, 'nfse-test@example.com', 'Nfse Test') ON CONFLICT DO NOTHING`)
    for (const [id, n] of [[TENANT_A, 'a'], [TENANT_B, 'b']]) {
      await db.insert(tenants).values({ id, name: `Nfse Test ${n}`, slug: `nfse-test-${n}` }).onConflictDoNothing()
    }
    await db.insert(patients).values([
      { id: PATIENT_A, tenantId: TENANT_A, fullName: 'Paciente A', phone: '11999990001' },
      { id: PATIENT_B, tenantId: TENANT_B, fullName: 'Paciente B', phone: '11999990002' },
    ]).onConflictDoNothing()
    await db.insert(financialEntries).values([
      { id: ENTRY_A, tenantId: TENANT_A, patientId: PATIENT_A, description: 'A', totalAmount: '300', createdBy: USER },
      { id: ENTRY_B, tenantId: TENANT_B, patientId: PATIENT_B, description: 'B', totalAmount: '100', createdBy: USER },
    ]).onConflictDoNothing()
    const fine = { appliedFineType: 'percentage', appliedFineValue: '2', appliedInterestRate: '1', appliedGracePeriodDays: 0 }
    await db.insert(installments).values([
      { id: INSTALLMENT_A, tenantId: TENANT_A, financialEntryId: ENTRY_A, installmentNumber: 1, amount: '300', dueDate: '2026-11-02', ...fine },
      { id: INSTALLMENT_B, tenantId: TENANT_B, financialEntryId: ENTRY_B, installmentNumber: 1, amount: '100', dueDate: '2026-11-02', ...fine },
    ]).onConflictDoNothing()
    const pay = { paymentMethod: 'pix', paidAt: new Date(), recordedBy: USER }
    await db.insert(paymentRecords).values([
      { id: PAYMENT_1, installmentId: INSTALLMENT_A, amount: '100', ...pay },
      { id: PAYMENT_2, installmentId: INSTALLMENT_A, amount: '200', ...pay },
      { id: PAYMENT_B, installmentId: INSTALLMENT_B, amount: '100', ...pay },
    ]).onConflictDoNothing()
  })

  beforeEach(async () => {
    await clearDocuments()
    await db.delete(nfseSettings).where(inArray(nfseSettings.tenantId, TENANTS))
    await db.delete(nfseDpsSequences).where(eq(nfseDpsSequences.cnpj, SEQ_KEY.cnpj))
  })

  afterAll(async () => {
    await clearDocuments()
    await db.delete(nfseSettings).where(inArray(nfseSettings.tenantId, TENANTS))
    await db.delete(nfseDpsSequences).where(eq(nfseDpsSequences.cnpj, SEQ_KEY.cnpj))
    await db.delete(paymentRecords).where(inArray(paymentRecords.id, [PAYMENT_1, PAYMENT_2, PAYMENT_B]))
    await db.delete(installments).where(inArray(installments.id, [INSTALLMENT_A, INSTALLMENT_B]))
    await db.delete(financialEntries).where(inArray(financialEntries.id, [ENTRY_A, ENTRY_B]))
    await db.delete(patients).where(inArray(patients.id, [PATIENT_A, PATIENT_B]))
    await db.delete(tenants).where(inArray(tenants.id, TENANTS))
    await db.execute(sql`DELETE FROM floraclin.users WHERE id = ${USER}`)
  })

  it('nextDpsNumber returns consecutive numbers under concurrent calls', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => db.transaction((tx) => nextDpsNumber(tx as unknown as typeof db, SEQ_KEY))),
    )
    expect(numbers.map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('insert race keeps one active row per payment', async () => {
    const results = await Promise.all(
      [0, 1].map(() => db.transaction((tx) => insertPendingDocuments(tx as unknown as typeof db, [docRow(PAYMENT_1)]))),
    )
    expect(results.flat()).toHaveLength(1)
  })

  it('allows a new row after the previous one is cancelled', async () => {
    const [first] = await insertPendingDocuments(db, [docRow(PAYMENT_1)])
    await db.update(nfseDocuments).set({ status: 'cancelled' }).where(eq(nfseDocuments.id, first))
    const second = await insertPendingDocuments(db, [docRow(PAYMENT_1)])
    expect(second).toHaveLength(1)
  })

  it.each([
    ['provider_error', 4, true, true],
    ['reconcile_unavailable', 4, true, true],
    ['provider_error', 5, false, true],
    ['missing_taker_data', 1, false, true],
    ['reconcile_ambiguous', 1, false, false],
    ['payment_reversed', 1, false, false],
  ])('a failed row with %s at attempt %i: auto claim %s, manual claim %s', async (errorCode, attemptCount, auto, manual) => {
    const id = await insertDoc(PAYMENT_1, { status: 'failed', errorCode, attemptCount })
    expect(Boolean(await claimDocument(id, 'auto'))).toBe(auto)
    if (!auto) expect(Boolean(await claimDocument(id, 'manual'))).toBe(manual)
  })

  it('stale processing at attempt 5 is not auto-claimed, a fresh claim is never taken twice', async () => {
    const stale = new Date(Date.now() - 20 * 60_000)
    const exhausted = await insertDoc(PAYMENT_1, { status: 'processing', claimedAt: stale, attemptCount: 5 })
    expect(await claimDocument(exhausted, 'auto')).toBeNull()
    await clearDocuments()
    const recent = await insertDoc(PAYMENT_1, { status: 'processing', claimedAt: new Date(), attemptCount: 1 })
    expect(await claimDocument(recent, 'manual')).toBeNull()
    await clearDocuments()
    const staleOk = await insertDoc(PAYMENT_1, { status: 'processing', claimedAt: stale, attemptCount: 1 })
    expect(await claimDocument(staleOk, 'auto')).not.toBeNull()
  })

  it('getNfseSettings never returns certificate secrets', async () => {
    await saveCertificate(TENANT_A, USER, cert)
    await saveFiscalSettings(TENANT_A, USER, fiscal)
    const settings = await getNfseSettings(TENANT_A)
    expect(settings?.configured).toBe(true)
    expect(settings?.municipalityName).toBe('São Paulo')
    expect(JSON.stringify(settings)).not.toContain(cert.password)
    expect(JSON.stringify(settings)).not.toContain(cert.pfxBase64)
  })

  it('getNfseSettingsWithSecrets decrypts what saveCertificate stored', async () => {
    await saveCertificate(TENANT_A, USER, cert)
    const [raw] = await db.select().from(nfseSettings).where(eq(nfseSettings.tenantId, TENANT_A))
    expect(raw.certificatePassword).not.toBe(cert.password)
    const settings = await getNfseSettingsWithSecrets(TENANT_A)
    expect(settings?.pfxBase64).toBe(cert.pfxBase64)
    expect(settings?.password).toBe(cert.password)
  })

  it('listPaymentRecordsForEmission ignores another tenant payment record', async () => {
    const rows = await listPaymentRecordsForEmission(TENANT_A, [PAYMENT_1, PAYMENT_B])
    expect(rows.map((r) => r.id)).toEqual([PAYMENT_1])
  })

  it('listAlwaysPaymentsMissingDocuments finds an always-mode payment without a row and ignores payments before always_enabled_at', async () => {
    await saveCertificate(TENANT_A, USER, cert)
    await saveFiscalSettings(TENANT_A, USER, { ...fiscal, emissionMode: 'always' })
    await db.update(paymentRecords).set({ recordedAt: new Date(Date.now() - 3600_000) }).where(eq(paymentRecords.id, PAYMENT_1))
    await db.update(paymentRecords).set({ recordedAt: new Date(Date.now() + 3600_000) }).where(eq(paymentRecords.id, PAYMENT_2))
    const missing = await listAlwaysPaymentsMissingDocuments(50)
    expect(missing).toEqual([{ tenantId: TENANT_A, paymentRecordId: PAYMENT_2 }])
  })
})
