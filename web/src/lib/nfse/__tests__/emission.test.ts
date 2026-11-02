// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  auditLogs,
  financialEntries,
  installments,
  nfseDocuments,
  nfseDpsSequences,
  nfseSettings,
  patients,
  paymentRecords,
  tenants,
} from '@/db/schema'
import { saveCertificate, saveFiscalSettings } from '@/db/queries/nfse'
import { brToday } from '@/lib/dates'
import type { NfseSnapshot } from '../types'

const mocks = vi.hoisted(() => ({
  gateway: { emit: vi.fn(), reconcile: vi.fn(), cancel: vi.fn() },
  createNfseGateway: vi.fn(),
  sendEmail: vi.fn(),
  report: vi.fn(),
}))

vi.mock('@/lib/nfse/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nfse/gateway')>()),
  createNfseGateway: mocks.createNfseGateway,
}))
vi.mock('@/lib/email', () => ({ sendEmailWithAttachments: mocks.sendEmail }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: mocks.report }))
vi.mock('@bullcode/fiscal/nfse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bullcode/fiscal/nfse')>()),
  renderDanfse: vi.fn().mockResolvedValue(Buffer.from('pdf')),
}))

import { NfseGatewayError } from '../gateway'
import {
  createDocuments,
  markReversalInTx,
  processCancellation,
  processDocument,
  requestCancel,
  runNfseCron,
  updateRetryIntent,
} from '../emission'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000f7a01'
const TENANT_OTHER = '00000000-0000-0000-0000-0000000f7a02'
const USER = '00000000-0000-0000-0000-0000000f7b01'
const PATIENT = '00000000-0000-0000-0000-0000000f7c01'
const PATIENT_OTHER = '00000000-0000-0000-0000-0000000f7c02'
const ENTRY = '00000000-0000-0000-0000-0000000f7d01'
const ENTRY_OTHER = '00000000-0000-0000-0000-0000000f7d02'
const INSTALLMENT = '00000000-0000-0000-0000-0000000f7e01'
const INSTALLMENT_OTHER = '00000000-0000-0000-0000-0000000f7e02'
const PAY_1 = '00000000-0000-0000-0000-0000000f7f01'
const PAY_2 = '00000000-0000-0000-0000-0000000f7f02'
const PAY_3 = '00000000-0000-0000-0000-0000000f7f03'
const PAY_OTHER = '00000000-0000-0000-0000-0000000f7f04'
const TENANTS = [TENANT, TENANT_OTHER]
const PAYMENTS = [PAY_1, PAY_2, PAY_3, PAY_OTHER]
const CNPJ = '99111222000133'
const ACCESS_KEY = '42082032264643544000154000000000000426100762796533'
const NFSE_XML = '<NFSe><infNFSe><nNFSe>7</nNFSe></infNFSe></NFSe>'
const PAID_AT = new Date('2026-10-30T15:00:00Z')
const UNAVAILABLE = 'Sefin Nacional indisponível. Tentaremos de novo.'
const ISSUED = { kind: 'issued', accessKey: ACCESS_KEY, nfseXml: NFSE_XML } as const

const VALID_PATIENT = {
  fullName: 'Maria Souza',
  cpf: '529.982.247-25',
  email: 'maria@example.com',
  address: { street: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', zip: '01310-100' },
}

const cert = {
  cnpj: CNPJ,
  subject: 'CN=Clinica Teste',
  issuer: 'CN=AC Teste',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-12-31T00:00:00.000Z',
  pfxBase64: 'cGZ4LWJ5dGVz',
  password: 'senha-secreta',
}

const fiscal = {
  municipalityCode: '3550308',
  municipalRegistration: null,
  simplesNacionalOption: 3 as const,
  simplesNacionalRegime: 1 as const,
  simplesNacionalTaxRate: 6,
  servicePreset: 'estetica' as const,
  advancedCodes: null,
  issRate: 2,
  issWithheld: false,
  emissionMode: 'ask' as const,
  emailPatient: false,
}

const storedSnapshot = {
  environment: 'restricted',
  providerCnpj: CNPJ,
  municipalRegistration: null,
  municipalityCode: '3550308',
  simplesNacionalOption: 3,
  simplesNacionalRegime: 1,
  simplesNacionalTaxRate: 6,
  issRate: 2,
  issWithheld: false,
  service: { cTribNac: '060201', cNBS: '126029000', tribISSQN: 1, cIndOp: '100301', CST: '000', cClassTrib: '000001' },
  taker: {
    cpf: '52998224725',
    name: 'Maria Souza',
    email: 'maria@example.com',
    address: { zip: '01310100', street: 'Av. Paulista', number: '1000', complement: null, neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' },
    cityCode: '3550308',
  },
  description: 'Limpeza de pele',
  value: 100,
  competenceDate: '2026-10-30',
  series: '00800',
  dpsNumber: '7',
} satisfies NfseSnapshot

const MAY_HAVE_REACHED_SEFIN = {
  status: 'failed' as const,
  errorCode: 'provider_error',
  attemptCount: 1,
  payloadSnapshot: storedSnapshot,
  dpsNumber: 7,
  dpsId: 'DPS355030829911122200013300800000000000000007',
}

async function insertDoc(paymentRecordId: string, patch: Partial<typeof nfseDocuments.$inferInsert> = {}) {
  const [row] = await db
    .insert(nfseDocuments)
    .values({
      tenantId: TENANT,
      paymentRecordId,
      patientId: PATIENT,
      environment: 'restricted',
      value: '100.00',
      competenceDate: '2026-10-30',
      createdBy: USER,
      ...patch,
    })
    .returning({ id: nfseDocuments.id })
  return row.id
}

async function row(id: string) {
  const [r] = await db.select().from(nfseDocuments).where(eq(nfseDocuments.id, id))
  return r
}

async function auditCount(entityId: string, action: 'create' | 'update') {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.entityType, 'nfse_document'), eq(auditLogs.action, action)))
  return rows.length
}

const reverse = (id: string) => db.update(paymentRecords).set({ reversedAt: new Date() }).where(eq(paymentRecords.id, id))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describeIntegration('nfse emission (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO floraclin.users (id, email, full_name) VALUES (${USER}, 'nfse-emission@example.com', 'Nfse Emission') ON CONFLICT DO NOTHING`)
    for (const [id, n] of [[TENANT, 'a'], [TENANT_OTHER, 'b']]) {
      await db.insert(tenants).values({ id, name: `Clinica ${n}`, slug: `nfse-emission-${n}`, email: 'clinica@example.com' }).onConflictDoNothing()
    }
    await db.insert(patients).values([
      { id: PATIENT, tenantId: TENANT, phone: '11999990001', ...VALID_PATIENT },
      { id: PATIENT_OTHER, tenantId: TENANT_OTHER, phone: '11999990002', fullName: 'Outro' },
    ]).onConflictDoNothing()
    await db.insert(financialEntries).values([
      { id: ENTRY, tenantId: TENANT, patientId: PATIENT, description: 'Limpeza de pele', totalAmount: '300', createdBy: USER },
      { id: ENTRY_OTHER, tenantId: TENANT_OTHER, patientId: PATIENT_OTHER, description: 'Outro', totalAmount: '100', createdBy: USER },
    ]).onConflictDoNothing()
    const fine = { appliedFineType: 'percentage', appliedFineValue: '2', appliedInterestRate: '1', appliedGracePeriodDays: 0 }
    await db.insert(installments).values([
      { id: INSTALLMENT, tenantId: TENANT, financialEntryId: ENTRY, installmentNumber: 1, amount: '300', dueDate: '2026-10-30', ...fine },
      { id: INSTALLMENT_OTHER, tenantId: TENANT_OTHER, financialEntryId: ENTRY_OTHER, installmentNumber: 1, amount: '100', dueDate: '2026-10-30', ...fine },
    ]).onConflictDoNothing()
    const pay = { paymentMethod: 'pix', paidAt: PAID_AT, recordedBy: USER }
    await db.insert(paymentRecords).values([
      { id: PAY_1, installmentId: INSTALLMENT, amount: '100', ...pay },
      { id: PAY_2, installmentId: INSTALLMENT, amount: '100', ...pay },
      { id: PAY_3, installmentId: INSTALLMENT, amount: '100', ...pay },
      { id: PAY_OTHER, installmentId: INSTALLMENT_OTHER, amount: '100', ...pay },
    ]).onConflictDoNothing()
  })

  async function clean() {
    await db.delete(nfseDocuments).where(inArray(nfseDocuments.tenantId, TENANTS))
    await db.delete(nfseSettings).where(inArray(nfseSettings.tenantId, TENANTS))
    await db.delete(nfseDpsSequences).where(eq(nfseDpsSequences.cnpj, CNPJ))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await clean()
    await db.update(paymentRecords).set({ reversedAt: null, recordedAt: new Date() }).where(inArray(paymentRecords.id, PAYMENTS))
    await db.update(patients).set({ phone: '11999990001', ...VALID_PATIENT }).where(eq(patients.id, PATIENT))
    await db.update(financialEntries).set({ installmentCount: 1 }).where(eq(financialEntries.id, ENTRY))
    await saveCertificate(TENANT, USER, cert)
    await saveFiscalSettings(TENANT, USER, fiscal)
    mocks.createNfseGateway.mockReturnValue(mocks.gateway)
    mocks.gateway.emit.mockResolvedValue({ accessKey: ACCESS_KEY, nfseXml: NFSE_XML })
    mocks.gateway.reconcile.mockResolvedValue({ kind: 'not_found' })
    mocks.gateway.cancel.mockResolvedValue(undefined)
    mocks.sendEmail.mockResolvedValue({ id: 'email-1' })
  })

  afterAll(async () => {
    await clean()
    await db.delete(paymentRecords).where(inArray(paymentRecords.id, PAYMENTS))
    await db.delete(installments).where(inArray(installments.id, [INSTALLMENT, INSTALLMENT_OTHER]))
    await db.delete(financialEntries).where(inArray(financialEntries.id, [ENTRY, ENTRY_OTHER]))
    await db.delete(patients).where(inArray(patients.id, [PATIENT, PATIENT_OTHER]))
  })

  describe('createDocuments', () => {
    const args = { tenantId: TENANT, userId: USER, emailRequested: false, environment: 'restricted' as const }

    it('defaults the competence to the BR service day and honors "today"', async () => {
      const [service] = await db.transaction((tx) =>
        createDocuments(tx as unknown as typeof db, { ...args, paymentRecordIds: [PAY_1], competence: 'service' }),
      )
      const [today] = await db.transaction((tx) =>
        createDocuments(tx as unknown as typeof db, { ...args, paymentRecordIds: [PAY_2], competence: 'today' }),
      )
      expect((await row(service)).competenceDate).toBe('2026-10-30')
      expect((await row(today)).competenceDate).toBe(brToday())
    })

    it("ignores another tenant's payment record", async () => {
      const ids = await db.transaction((tx) =>
        createDocuments(tx as unknown as typeof db, { ...args, paymentRecordIds: [PAY_OTHER], competence: 'service' }),
      )
      expect(ids).toEqual([])
    })
  })

  describe('processDocument', () => {
    it('claims a document once while another worker is emitting it', async () => {
      const id = await insertDoc(PAY_1)
      const emitting = deferred<void>()
      const release = deferred<void>()
      mocks.gateway.emit.mockImplementation(async () => {
        emitting.resolve()
        await release.promise
        return { accessKey: ACCESS_KEY, nfseXml: NFSE_XML }
      })

      const first = processDocument(id)
      await emitting.promise
      const second = await processDocument(id)
      release.resolve()
      await first

      expect(second.status).toBe('processing')
      expect(mocks.gateway.emit).toHaveBeenCalledTimes(1)
      expect((await row(id)).status).toBe('issued')
    })

    it('ignores the late result of a worker whose claim went stale', async () => {
      const id = await insertDoc(PAY_1)
      const emitting = deferred<void>()
      const release = deferred<void>()
      mocks.gateway.emit.mockImplementation(async () => {
        emitting.resolve()
        await release.promise
        return { accessKey: ACCESS_KEY, nfseXml: '<NFSe><infNFSe><nNFSe>9</nNFSe></infNFSe></NFSe>' }
      })
      mocks.gateway.reconcile.mockResolvedValue(ISSUED)

      const stale = processDocument(id)
      await emitting.promise
      await db.update(nfseDocuments).set({ claimedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(nfseDocuments.id, id))
      await processDocument(id)
      release.resolve()
      await stale

      expect(await row(id)).toMatchObject({ status: 'issued', nfseNumber: '7' })
      expect(await auditCount(id, 'create')).toBe(1)
    })

    it('persists the DPS identity before calling Sefin', async () => {
      const id = await insertDoc(PAY_1)
      let seen: Awaited<ReturnType<typeof row>> | undefined
      mocks.gateway.emit.mockImplementation(async () => {
        seen = await row(id)
        return { accessKey: ACCESS_KEY, nfseXml: NFSE_XML }
      })

      await processDocument(id)

      expect(seen).toMatchObject({ dpsNumber: 1, dpsId: 'DPS355030829911122200013300800000000000000001' })
      expect(seen?.payloadSnapshot).toMatchObject({ dpsNumber: '1', providerCnpj: CNPJ, value: 100, description: 'Limpeza de pele' })
    })

    it('describes an installment of a split entry as "Parcela N/M"', async () => {
      await db.update(financialEntries).set({ installmentCount: 3 }).where(eq(financialEntries.id, ENTRY))
      const id = await insertDoc(PAY_1)

      await processDocument(id)

      expect(mocks.gateway.emit).toHaveBeenCalledWith(expect.objectContaining({ description: 'Limpeza de pele - Parcela 1/3' }))
    })

    it('stores the issued note and reads its number from the XML', async () => {
      const id = await insertDoc(PAY_1)
      const result = await processDocument(id)
      expect(result).toEqual({ id, status: 'issued' })
      expect(await row(id)).toMatchObject({ status: 'issued', accessKey: ACCESS_KEY, nfseNumber: '7', nfseXml: NFSE_XML })
    })

    it('keeps the DPS number across retries so reconcile can find the note', async () => {
      const id = await insertDoc(PAY_1)
      mocks.gateway.emit.mockRejectedValueOnce(new NfseGatewayError('provider_error', 'Sefin Nacional indisponível. Tentaremos de novo.'))

      await processDocument(id)
      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: 'provider_error', dpsNumber: 1 })

      await processDocument(id, 'manual')
      expect(mocks.gateway.reconcile).toHaveBeenCalledWith(expect.objectContaining({ dpsNumber: '1' }))
      expect(await row(id)).toMatchObject({ status: 'issued', dpsNumber: 1 })
    })

    it('reconciles with the stored DPS before renumbering, so a changed municipality does not emit a second note', async () => {
      const id = await insertDoc(PAY_1)
      mocks.gateway.emit.mockRejectedValueOnce(new NfseGatewayError('provider_error', UNAVAILABLE))
      await processDocument(id)
      mocks.gateway.reconcile.mockRejectedValueOnce(new NfseGatewayError('provider_error', UNAVAILABLE))
      await processDocument(id)
      expect((await row(id)).errorCode).toBe('reconcile_unavailable')

      await saveFiscalSettings(TENANT, USER, { ...fiscal, municipalityCode: '3304557' })
      mocks.gateway.reconcile.mockImplementation(async (s: NfseSnapshot) =>
        s.municipalityCode === '3550308' && s.dpsNumber === '1' ? ISSUED : { kind: 'not_found' },
      )
      await processDocument(id, 'manual')

      expect(mocks.gateway.emit).toHaveBeenCalledTimes(1)
      expect(await row(id)).toMatchObject({ status: 'issued', accessKey: ACCESS_KEY })
    })

    it('still reconciles after a later pre-send error hides an earlier emit timeout', async () => {
      const id = await insertDoc(PAY_1)
      mocks.gateway.emit.mockRejectedValueOnce(new NfseGatewayError('provider_error', UNAVAILABLE))
      await processDocument(id)
      mocks.createNfseGateway.mockImplementationOnce(() => {
        throw new NfseGatewayError('certificate_expired', 'Certificado vencido.')
      })
      await processDocument(id, 'manual')
      expect((await row(id)).errorCode).toBe('certificate_expired')

      await saveFiscalSettings(TENANT, USER, { ...fiscal, municipalityCode: '3304557' })
      mocks.gateway.reconcile.mockImplementation(async (s: NfseSnapshot) =>
        s.municipalityCode === '3550308' && s.dpsNumber === '1' ? ISSUED : { kind: 'not_found' },
      )
      await processDocument(id, 'manual')

      expect(mocks.gateway.emit).toHaveBeenCalledTimes(1)
      expect(await row(id)).toMatchObject({ status: 'issued', accessKey: ACCESS_KEY })
    })

    it('reconciles before resending a row that may have reached Sefin', async () => {
      const id = await insertDoc(PAY_1, MAY_HAVE_REACHED_SEFIN)
      mocks.gateway.reconcile.mockResolvedValue({ kind: 'issued', accessKey: ACCESS_KEY, nfseXml: NFSE_XML })

      await processDocument(id)

      expect(mocks.gateway.emit).not.toHaveBeenCalled()
      expect(await row(id)).toMatchObject({ status: 'issued', accessKey: ACCESS_KEY, nfseNumber: '7' })
      expect(await auditCount(id, 'create')).toBe(1)
    })

    it('emits after a reconcile that finds nothing', async () => {
      const id = await insertDoc(PAY_1, MAY_HAVE_REACHED_SEFIN)

      await processDocument(id)

      expect(mocks.gateway.reconcile.mock.invocationCallOrder[0]).toBeLessThan(mocks.gateway.emit.mock.invocationCallOrder[0])
      expect((await row(id)).status).toBe('issued')
    })

    it.each([
      ['unavailable', () => mocks.gateway.reconcile.mockRejectedValue(new NfseGatewayError('provider_error', 'x')), 'reconcile_unavailable'],
      ['ambiguous', () => mocks.gateway.reconcile.mockResolvedValue({ kind: 'ambiguous' }), 'reconcile_ambiguous'],
    ])('emits nothing when reconciliation is %s', async (_name, arrange, code) => {
      const id = await insertDoc(PAY_1, MAY_HAVE_REACHED_SEFIN)
      arrange()

      await processDocument(id)

      expect(mocks.gateway.emit).not.toHaveBeenCalled()
      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: code })
    })

    it('does not emit for a reversed payment', async () => {
      const id = await insertDoc(PAY_1)
      await reverse(PAY_1)

      await processDocument(id)

      expect(mocks.gateway.emit).not.toHaveBeenCalled()
      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: 'payment_reversed' })
    })

    it('does not emit when the payment is reversed after the document was loaded', async () => {
      const id = await insertDoc(PAY_1, MAY_HAVE_REACHED_SEFIN)
      mocks.gateway.reconcile.mockImplementation(async () => {
        await reverse(PAY_1)
        return { kind: 'not_found' }
      })

      await processDocument(id)

      expect(mocks.gateway.emit).not.toHaveBeenCalled()
      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: 'payment_reversed' })
    })

    it('reconciles a reversed payment whose DPS may have been authorized and cancels the adopted note', async () => {
      const id = await insertDoc(PAY_1, MAY_HAVE_REACHED_SEFIN)
      await reverse(PAY_1)
      mocks.gateway.reconcile.mockResolvedValue({ kind: 'issued', accessKey: ACCESS_KEY, nfseXml: NFSE_XML })

      await processDocument(id)

      expect(mocks.gateway.emit).not.toHaveBeenCalled()
      expect(mocks.gateway.cancel).toHaveBeenCalledWith(ACCESS_KEY, 2, 'Pagamento estornado no FloraClin.')
      expect((await row(id)).status).toBe('cancelled')
    })

    it('reversal during emission cancels the note right after it is issued', async () => {
      const id = await insertDoc(PAY_1)
      mocks.gateway.emit.mockImplementation(async () => {
        await reverse(PAY_1)
        await db.transaction((tx) => markReversalInTx(tx as unknown as typeof db, [PAY_1], false))
        return { accessKey: ACCESS_KEY, nfseXml: NFSE_XML }
      })

      await processDocument(id)

      expect(mocks.gateway.cancel).toHaveBeenCalledWith(ACCESS_KEY, 2, 'Pagamento estornado no FloraClin.')
      expect((await row(id)).status).toBe('cancelled')
    })

    it('manual retry rebuilds after missing taker data is fixed', async () => {
      const id = await insertDoc(PAY_1)
      await db.update(patients).set({ cpf: null }).where(eq(patients.id, PATIENT))

      const first = await processDocument(id)
      expect(first).toMatchObject({ status: 'failed', errorCode: 'missing_taker_data' })
      expect(first.errorMessage).toContain('CPF')
      expect(mocks.gateway.emit).not.toHaveBeenCalled()

      await db.update(patients).set({ cpf: '529.982.247-25' }).where(eq(patients.id, PATIENT))
      expect((await processDocument(id, 'auto')).status).toBe('failed')
      expect((await processDocument(id, 'manual')).status).toBe('issued')
      expect(mocks.gateway.emit).toHaveBeenCalledWith(expect.objectContaining({ taker: expect.objectContaining({ cpf: '52998224725' }) }))
    })

    it('fails with not_configured without calling Sefin', async () => {
      const id = await insertDoc(PAY_1)
      await db.delete(nfseSettings).where(eq(nfseSettings.tenantId, TENANT))

      await processDocument(id)

      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: 'not_configured' })
      expect(mocks.gateway.emit).not.toHaveBeenCalled()
    })

    it('uses the document environment for reconcile and cancel', async () => {
      const reconciled = await insertDoc(PAY_1, { ...MAY_HAVE_REACHED_SEFIN, environment: 'production' })
      mocks.gateway.reconcile.mockResolvedValue({ kind: 'issued', accessKey: ACCESS_KEY, nfseXml: NFSE_XML })
      await processDocument(reconciled)
      expect(mocks.createNfseGateway).toHaveBeenLastCalledWith(expect.anything(), 'production')

      mocks.createNfseGateway.mockClear()
      const cancelling = await insertDoc(PAY_2, {
        status: 'issued',
        accessKey: ACCESS_KEY,
        environment: 'production',
        cancelRequestedAt: new Date(),
        cancelReason: 2,
        cancelJustification: 'Pagamento estornado no FloraClin.',
      })
      await processCancellation(cancelling)
      expect(mocks.createNfseGateway).toHaveBeenCalledWith(expect.anything(), 'production')
    })
  })

  describe('email', () => {
    it('sends the PDF and XML to the patient after issuing', async () => {
      const id = await insertDoc(PAY_1, { emailRequested: true })

      await processDocument(id)

      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'maria@example.com',
          subject: 'NFS-e 7 - Clinica a',
          replyTo: 'clinica@example.com',
          attachments: [
            { filename: 'NFS-e-7.pdf', content: Buffer.from('pdf') },
            { filename: 'NFS-e-7.xml', content: Buffer.from(NFSE_XML) },
          ],
        }),
      )
      expect((await row(id)).emailSentAt).not.toBeNull()
    })

    it('names the email after the access key when the XML has no number', async () => {
      const id = await insertDoc(PAY_1, { emailRequested: true })
      mocks.gateway.emit.mockResolvedValue({ accessKey: ACCESS_KEY, nfseXml: '<NFSe><infNFSe/></NFSe>' })

      await processDocument(id)

      expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: `NFS-e ${ACCESS_KEY} - Clinica a` }))
    })

    it('issues the note when the email cannot be sent', async () => {
      const id = await insertDoc(PAY_1, { emailRequested: true })
      mocks.sendEmail.mockRejectedValue(new Error('resend down'))

      const result = await processDocument(id)

      expect(result.status).toBe('issued')
      expect((await row(id)).emailSentAt).toBeNull()
      expect(mocks.report).toHaveBeenCalledTimes(1)
    })

    it('issues the note without noise when the patient has no email', async () => {
      const id = await insertDoc(PAY_1, { emailRequested: true })
      await db.update(patients).set({ email: null }).where(eq(patients.id, PATIENT))

      const result = await processDocument(id)

      expect(result.status).toBe('issued')
      expect(mocks.sendEmail).not.toHaveBeenCalled()
      expect(mocks.report).not.toHaveBeenCalled()
    })
  })

  describe('reversal and cancellation', () => {
    it('a reversal after an emit timeout lets the next cron run reconcile, adopt and cancel the note', async () => {
      const id = await insertDoc(PAY_1)
      mocks.gateway.emit.mockRejectedValueOnce(new NfseGatewayError('provider_error', UNAVAILABLE))
      await processDocument(id)
      await reverse(PAY_1)
      await db.transaction((tx) => markReversalInTx(tx as unknown as typeof db, [PAY_1], false))
      mocks.gateway.reconcile.mockResolvedValue(ISSUED)

      await runNfseCron(Date.now() + 60_000)

      expect(mocks.gateway.emit).toHaveBeenCalledTimes(1)
      expect(mocks.gateway.cancel).toHaveBeenCalledWith(ACCESS_KEY, 2, 'Pagamento estornado no FloraClin.')
      expect((await row(id)).status).toBe('cancelled')
    })

    it('requestCancel cancels an issued note and audits it', async () => {
      const id = await insertDoc(PAY_1, { status: 'issued', accessKey: ACCESS_KEY })

      await requestCancel({ tenantId: TENANT, userId: USER, documentId: id, reason: 1, justification: 'Erro na emissão da nota.' })

      expect(mocks.gateway.cancel).toHaveBeenCalledWith(ACCESS_KEY, 1, 'Erro na emissão da nota.')
      expect((await row(id)).status).toBe('cancelled')
      expect(await auditCount(id, 'update')).toBe(1)
    })

    it('requestCancel refuses a note that is not issued yet', async () => {
      const id = await insertDoc(PAY_1, { status: 'processing', claimedAt: new Date() })

      await expect(
        requestCancel({ tenantId: TENANT, userId: USER, documentId: id, reason: 1, justification: 'Erro na emissão da nota.' }),
      ).rejects.toMatchObject({ code: 'NFSE_NOT_CANCELLABLE' })
      expect((await row(id)).cancelRequestedAt).toBeNull()
    })

    it('reports once when cancellation attempts run out', async () => {
      const id = await insertDoc(PAY_1, {
        status: 'issued',
        accessKey: ACCESS_KEY,
        cancelRequestedAt: new Date(),
        cancelReason: 2,
        cancelJustification: 'Pagamento estornado no FloraClin.',
        cancelAttemptCount: 9,
      })
      mocks.gateway.cancel.mockRejectedValue(new NfseGatewayError('provider_error', UNAVAILABLE))

      await processCancellation(id)
      await processCancellation(id)

      expect(mocks.report).toHaveBeenCalledTimes(1)
      expect(mocks.report).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ step: 'cancel-exhausted' }))
    })

    it('cron retries a requested cancellation until Sefin accepts it', async () => {
      const id = await insertDoc(PAY_1, {
        status: 'issued',
        accessKey: ACCESS_KEY,
        cancelRequestedAt: new Date(),
        cancelReason: 2,
        cancelJustification: 'Pagamento estornado no FloraClin.',
      })
      mocks.gateway.cancel.mockRejectedValueOnce(new NfseGatewayError('provider_error', 'Sefin Nacional indisponível. Tentaremos de novo.'))

      await runNfseCron(Date.now() + 60_000)
      expect(await row(id)).toMatchObject({ status: 'issued', cancelAttemptCount: 1 })

      await runNfseCron(Date.now() + 60_000)
      expect(await row(id)).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('updateRetryIntent', () => {
    it.each([
      ['invalid_request', MAY_HAVE_REACHED_SEFIN.dpsId, 'today' as const, brToday()],
      ['missing_taker_data', MAY_HAVE_REACHED_SEFIN.dpsId, 'today' as const, '2026-10-01'],
      ['missing_taker_data', null, 'service' as const, '2026-10-30'],
      ['provider_error', null, 'today' as const, brToday()],
      ['provider_error', MAY_HAVE_REACHED_SEFIN.dpsId, 'today' as const, '2026-10-01'],
    ])('after %s with DPS %s and competence %s sets competence %s', async (errorCode, dpsId, competence, expected) => {
      const id = await insertDoc(PAY_1, { status: 'failed', errorCode, dpsId, competenceDate: '2026-10-01' })

      await updateRetryIntent(TENANT, id, { competence, emailRequested: true })

      expect(await row(id)).toMatchObject({ competenceDate: expected, emailRequested: true })
    })

    it("does not touch another tenant's note", async () => {
      const id = await insertDoc(PAY_1, { status: 'failed', errorCode: 'missing_taker_data' })

      await expect(updateRetryIntent(TENANT_OTHER, id, { competence: 'today', emailRequested: true })).rejects.toMatchObject({
        code: 'NFSE_NOT_FOUND',
      })
      expect((await row(id)).emailRequested).toBe(false)
    })
  })

  describe('runNfseCron', () => {
    it('runs cancellations before retries so a slow retry batch cannot starve them', async () => {
      const deadline = Date.now() + 60_000
      const cancelling = await insertDoc(PAY_1, {
        status: 'issued',
        accessKey: ACCESS_KEY,
        cancelRequestedAt: new Date(),
        cancelReason: 2,
        cancelJustification: 'Pagamento estornado no FloraClin.',
      })
      await insertDoc(PAY_2)
      const now = vi.spyOn(Date, 'now')
      mocks.gateway.emit.mockImplementation(async () => {
        now.mockReturnValue(deadline + 1)
        return { accessKey: ACCESS_KEY, nfseXml: NFSE_XML }
      })

      try {
        await runNfseCron(deadline)
      } finally {
        now.mockRestore()
      }

      expect((await row(cancelling)).status).toBe('cancelled')
    })

    it('hands a stale claim with no attempts left to a person', async () => {
      const id = await insertDoc(PAY_1, { status: 'processing', claimedAt: new Date(Date.now() - 20 * 60_000), attemptCount: 5 })

      await runNfseCron(Date.now() + 60_000)

      expect(await row(id)).toMatchObject({ status: 'failed', errorCode: 'provider_error', claimedAt: null })
      expect(mocks.gateway.emit).not.toHaveBeenCalled()
    })

    it('backfills an always-mode payment whose row was never written', async () => {
      await saveFiscalSettings(TENANT, USER, { ...fiscal, emissionMode: 'always', emailPatient: true })
      await db.update(paymentRecords).set({ recordedAt: new Date('2026-01-01T00:00:00Z') }).where(inArray(paymentRecords.id, PAYMENTS))
      await db.update(paymentRecords).set({ recordedAt: new Date(Date.now() + 60_000) }).where(eq(paymentRecords.id, PAY_1))

      const result = await runNfseCron(Date.now() + 60_000)

      expect(result.backfilled).toBeGreaterThanOrEqual(1)
      const [doc] = await db.select().from(nfseDocuments).where(eq(nfseDocuments.paymentRecordId, PAY_1))
      expect(doc).toMatchObject({ status: 'issued', emailRequested: true, createdBy: USER })
      const untouched = await db.select().from(nfseDocuments).where(inArray(nfseDocuments.paymentRecordId, [PAY_2, PAY_3]))
      expect(untouched).toEqual([])
    })
  })
})
