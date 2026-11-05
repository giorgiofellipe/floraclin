// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { saveCertificate, saveFiscalSettings } from '@/db/queries/nfse'
import { ForbiddenError } from '@/lib/errors'
import { createAuditLog } from '@/lib/audit'
import { brToday } from '@/lib/dates'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const auth = vi.hoisted(() => ({ tenantId: '', userId: '', role: 'owner' }))
const mocks = vi.hoisted(() => ({
  gateway: { emit: vi.fn(), reconcile: vi.fn(), cancel: vi.fn() },
  createNfseGateway: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(async () => ({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role })),
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new ForbiddenError()
    return { tenantId: auth.tenantId, userId: auth.userId, role: auth.role }
  }),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/plans', () => ({ subscriptionGate: vi.fn(async () => null) }))
vi.mock('@/lib/email', () => ({ sendEmailWithAttachments: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/nfse/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nfse/gateway')>()),
  createNfseGateway: mocks.createNfseGateway,
}))
vi.mock('@bullcode/fiscal/nfse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bullcode/fiscal/nfse')>()),
  renderDanfse: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
}))

import { GET as listEmission, POST as emit } from '../route'
import { GET as getPdf } from '../[id]/pdf/route'
import { POST as cancel } from '../[id]/cancel/route'
import { GET as cron } from '../../cron/nfse-retry/route'
import { GET as getFinancialEntryRoute } from '../../financial/[id]/route'

const TENANT = '00000000-0000-0000-0000-0000000f8a01'
const TENANT_OTHER = '00000000-0000-0000-0000-0000000f8a02'
const USER = '00000000-0000-0000-0000-0000000f8b01'
const PATIENT = '00000000-0000-0000-0000-0000000f8c01'
const PATIENT_BARE = '00000000-0000-0000-0000-0000000f8c02'
const PATIENT_OTHER = '00000000-0000-0000-0000-0000000f8c03'
const ENTRY = '00000000-0000-0000-0000-0000000f8d01'
const ENTRY_BARE = '00000000-0000-0000-0000-0000000f8d02'
const ENTRY_OTHER = '00000000-0000-0000-0000-0000000f8d03'
const INST = '00000000-0000-0000-0000-0000000f8e01'
const INST_BARE = '00000000-0000-0000-0000-0000000f8e02'
const INST_OTHER = '00000000-0000-0000-0000-0000000f8e03'
const PAY_1 = '00000000-0000-0000-0000-0000000f8f01'
const PAY_2 = '00000000-0000-0000-0000-0000000f8f02'
const PAY_BARE = '00000000-0000-0000-0000-0000000f8f03'
const PAY_OTHER = '00000000-0000-0000-0000-0000000f8f04'
const PAYMENTS = [PAY_1, PAY_2, PAY_BARE, PAY_OTHER]
const TENANTS = [TENANT, TENANT_OTHER]
const CNPJ = '99111222000144'
const ACCESS_KEY = '42082032264643544000154000000000000426100762796533'
const NFSE_XML = '<NFSe><infNFSe><nNFSe>7</nNFSe></infNFSe></NFSe>'

const VALID_ADDRESS = { street: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', zip: '01310-100' }
const TAKER_ADDRESS = { ...VALID_ADDRESS, complement: null }
const CLINIC_ADDRESS = { street: 'Rua XV de Novembro', number: '50', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zip: '80020-310' }

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
  emailPatient: true,
  clinicAddressFallback: false,
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const emitBody = (over: Record<string, unknown> = {}) => ({
  paymentRecordIds: [PAY_1],
  competence: 'service',
  sendEmail: false,
  ...over,
})
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const docsFor = (ids: string[]) => db.select().from(nfseDocuments).where(inArray(nfseDocuments.paymentRecordId, ids))

async function insertIssued(paymentRecordId: string, tenantId = TENANT, patientId = PATIENT) {
  const [row] = await db
    .insert(nfseDocuments)
    .values({
      tenantId,
      paymentRecordId,
      patientId,
      environment: 'restricted',
      value: '100.00',
      competenceDate: '2026-10-30',
      status: 'issued',
      accessKey: ACCESS_KEY,
      nfseXml: NFSE_XML,
      nfseNumber: '7',
      createdBy: USER,
    })
    .returning({ id: nfseDocuments.id })
  return row.id
}

describeIntegration('NFS-e document API (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO floraclin.users (id, email, full_name) VALUES (${USER}, 'nfse-api@example.com', 'Nfse Api') ON CONFLICT DO NOTHING`)
    for (const [id, n] of [[TENANT, 'a'], [TENANT_OTHER, 'b']]) {
      await db.insert(tenants).values({ id, name: `Clinica ${n}`, slug: `nfse-api-${n}`, email: 'clinica@example.com' }).onConflictDoNothing()
    }
    await db.insert(patients).values([
      { id: PATIENT, tenantId: TENANT, phone: '11999991001', fullName: 'Maria Souza', cpf: '529.982.247-25', email: 'maria@example.com', address: VALID_ADDRESS },
      { id: PATIENT_BARE, tenantId: TENANT, phone: '11999991002', fullName: 'Joana Lima' },
      { id: PATIENT_OTHER, tenantId: TENANT_OTHER, phone: '11999991003', fullName: 'Outro' },
    ]).onConflictDoNothing()
    await db.insert(financialEntries).values([
      { id: ENTRY, tenantId: TENANT, patientId: PATIENT, description: 'Limpeza de pele', totalAmount: '200', createdBy: USER },
      { id: ENTRY_BARE, tenantId: TENANT, patientId: PATIENT_BARE, description: 'Peeling', totalAmount: '100', createdBy: USER },
      { id: ENTRY_OTHER, tenantId: TENANT_OTHER, patientId: PATIENT_OTHER, description: 'Outro', totalAmount: '100', createdBy: USER },
    ]).onConflictDoNothing()
    const fine = { appliedFineType: 'percentage', appliedFineValue: '2', appliedInterestRate: '1', appliedGracePeriodDays: 0 }
    await db.insert(installments).values([
      { id: INST, tenantId: TENANT, financialEntryId: ENTRY, installmentNumber: 1, amount: '200', dueDate: '2026-10-30', ...fine },
      { id: INST_BARE, tenantId: TENANT, financialEntryId: ENTRY_BARE, installmentNumber: 1, amount: '100', dueDate: '2026-10-30', ...fine },
      { id: INST_OTHER, tenantId: TENANT_OTHER, financialEntryId: ENTRY_OTHER, installmentNumber: 1, amount: '100', dueDate: '2026-10-30', ...fine },
    ]).onConflictDoNothing()
    const pay = { paymentMethod: 'pix', paidAt: new Date('2026-10-30T15:00:00Z'), recordedBy: USER }
    await db.insert(paymentRecords).values([
      { id: PAY_1, installmentId: INST, amount: '100', ...pay },
      { id: PAY_2, installmentId: INST, amount: '100', ...pay },
      { id: PAY_BARE, installmentId: INST_BARE, amount: '100', ...pay },
      { id: PAY_OTHER, installmentId: INST_OTHER, amount: '100', ...pay },
    ]).onConflictDoNothing()
  })

  async function clean() {
    await db.delete(nfseDocuments).where(inArray(nfseDocuments.tenantId, TENANTS))
    await db.delete(nfseSettings).where(inArray(nfseSettings.tenantId, TENANTS))
    await db.delete(nfseDpsSequences).where(eq(nfseDpsSequences.cnpj, CNPJ))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    auth.tenantId = TENANT
    auth.userId = USER
    auth.role = 'owner'
    await clean()
    await db.update(paymentRecords).set({ reversedAt: null }).where(inArray(paymentRecords.id, PAYMENTS))
    await db.update(patients).set({ cpf: '529.982.247-25', address: VALID_ADDRESS }).where(eq(patients.id, PATIENT))
    await db.update(patients).set({ cpf: null, address: null }).where(eq(patients.id, PATIENT_BARE))
    await saveCertificate(TENANT, USER, cert)
    await saveFiscalSettings(TENANT, USER, fiscal)
    await db.update(tenants).set({ address: CLINIC_ADDRESS }).where(eq(tenants.id, TENANT))
    mocks.createNfseGateway.mockReturnValue(mocks.gateway)
    mocks.gateway.emit.mockResolvedValue({ accessKey: ACCESS_KEY, nfseXml: NFSE_XML })
    mocks.gateway.reconcile.mockResolvedValue({ kind: 'not_found' })
    mocks.gateway.cancel.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await clean()
    await db.delete(paymentRecords).where(inArray(paymentRecords.id, PAYMENTS))
    await db.delete(installments).where(inArray(installments.id, [INST, INST_BARE, INST_OTHER]))
    await db.delete(financialEntries).where(inArray(financialEntries.id, [ENTRY, ENTRY_BARE, ENTRY_OTHER]))
    await db.delete(patients).where(inArray(patients.id, [PATIENT, PATIENT_BARE, PATIENT_OTHER]))
  })

  describe('GET /api/nfse', () => {
    it('groups by patient and lists the missing taker fields', async () => {
      const res = await listEmission(new Request(`http://localhost/api/nfse?paymentRecordIds=${PAY_1},${PAY_2},${PAY_BARE}`))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      const byId = Object.fromEntries(data.patients.map((p: { patientId: string }) => [p.patientId, p]))
      expect(byId[PATIENT]).toMatchObject({ patientName: 'Maria Souza', total: 200, missing: [], email: 'maria@example.com', canEditTaker: true })
      expect(byId[PATIENT].current).toEqual({ cpf: '529.982.247-25', ...VALID_ADDRESS, complement: '' })
      expect(byId[PATIENT_BARE].current).toEqual({ cpf: '', zip: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' })
      expect(byId[PATIENT].paymentRecordIds.sort()).toEqual([PAY_1, PAY_2].sort())
      expect(byId[PATIENT_BARE].missing).toEqual(['cpf', 'zip', 'street', 'number', 'neighborhood', 'city', 'state'])
      expect(data).toMatchObject({ defaultCompetence: '2026-10-30', competenceIsPastMonth: true, settings: { emailPatient: true } })
    })

    it('asks only for the CPF of a patient without address when the clinic address stands in', async () => {
      await saveFiscalSettings(TENANT, USER, { ...fiscal, clinicAddressFallback: true })
      const res = await listEmission(new Request(`http://localhost/api/nfse?paymentRecordIds=${PAY_1},${PAY_BARE}`))
      const { data } = await res.json()
      const byId = Object.fromEntries(data.patients.map((p: { patientId: string }) => [p.patientId, p]))
      expect(byId[PATIENT_BARE]).toMatchObject({ addressSource: 'clinic', missing: ['cpf'] })
      expect(byId[PATIENT]).toMatchObject({ addressSource: 'patient', missing: [] })
    })

    it("rejects a foreign tenant's payment record", async () => {
      const res = await listEmission(new Request(`http://localhost/api/nfse?paymentRecordIds=${PAY_1},${PAY_OTHER}`))
      expect(res.status).toBe(404)
    })

    it('returns 409 NFSE_NOT_CONFIGURED when the certificate is not saved', async () => {
      await db.update(nfseSettings).set({ configuredAt: null }).where(eq(nfseSettings.tenantId, TENANT))
      const res = await listEmission(new Request(`http://localhost/api/nfse?paymentRecordIds=${PAY_1}`))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('NFSE_NOT_CONFIGURED')
    })

    it('hides current taker data from roles that cannot edit it', async () => {
      auth.role = 'financial'
      const res = await listEmission(new Request(`http://localhost/api/nfse?paymentRecordIds=${PAY_1}`))
      const { data } = await res.json()
      expect(data.patients[0]).toMatchObject({ canEditTaker: false, current: null })
    })
  })

  describe('POST /api/nfse', () => {
    it("rejects a foreign tenant's payment record", async () => {
      const res = await emit(post('/api/nfse', emitBody({ paymentRecordIds: [PAY_1, PAY_OTHER] })))
      expect(res.status).toBe(404)
      expect(await docsFor(PAYMENTS)).toHaveLength(0)
    })

    it('rejects a taker for a patient outside the selection', async () => {
      const res = await emit(
        post('/api/nfse', emitBody({ takers: [{ patientId: PATIENT_BARE, cpf: '390.533.447-05', address: TAKER_ADDRESS }] })),
      )
      expect(res.status).toBe(400)
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare.cpf).toBeNull()
      expect(await docsFor(PAYMENTS)).toHaveLength(0)
    })

    it('concurrent POSTs create one row', async () => {
      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      mocks.gateway.emit.mockImplementation(async () => {
        await barrier
        return { accessKey: ACCESS_KEY, nfseXml: NFSE_XML }
      })

      const first = emit(post('/api/nfse', emitBody()))
      await vi.waitFor(() => expect(mocks.gateway.emit).toHaveBeenCalled())
      const second = await emit(post('/api/nfse', emitBody()))
      release()
      const results = [await first, second]

      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const loser = results.find((r) => r.status === 409)!
      expect((await loser.json()).code).toBe('NFSE_ALREADY_ACTIVE')
      expect(mocks.gateway.emit).toHaveBeenCalledTimes(1)
      expect(await docsFor([PAY_1])).toHaveLength(1)
    })

    it('rejects emission for a reversed payment', async () => {
      await db.update(paymentRecords).set({ reversedAt: new Date() }).where(eq(paymentRecords.id, PAY_1))
      const res = await emit(post('/api/nfse', emitBody()))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('PAYMENT_REVERSED')
      expect(await docsFor([PAY_1])).toHaveLength(0)
    })

    it('retries a failed row instead of inserting', async () => {
      const [failed] = await db
        .insert(nfseDocuments)
        .values({
          tenantId: TENANT,
          paymentRecordId: PAY_1,
          patientId: PATIENT,
          environment: 'restricted',
          value: '100.00',
          competenceDate: '2026-10-30',
          status: 'failed',
          errorCode: 'missing_taker_data',
          errorMessage: 'Complete o cadastro do paciente: CPF.',
          createdBy: USER,
        })
        .returning({ id: nfseDocuments.id })

      const res = await emit(post('/api/nfse', emitBody()))

      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual([{ id: failed.id, status: 'issued' }])
      const rows = await docsFor([PAY_1])
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('issued')
    })

    it('saves the taker, audits the patient update and emits', async () => {
      const res = await emit(
        post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '39053344705', address: { ...TAKER_ADDRESS, zip: '01310100' } }] })),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).data[0].status).toBe('issued')
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare.cpf).toBe('390.533.447-05')
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'patient', entityId: PATIENT_BARE, action: 'update', tenantId: TENANT }),
        expect.anything(),
      )
    })

    it('saves only the CPF of a taker that uses the clinic address', async () => {
      await saveFiscalSettings(TENANT, USER, { ...fiscal, clinicAddressFallback: true })
      const res = await emit(post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '39053344705' }] })))
      expect(res.status).toBe(200)
      expect((await res.json()).data[0].status).toBe('issued')
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare).toMatchObject({ cpf: '390.533.447-05', address: null })
    })

    it('rejects a CPF-only taker when the clinic address does not stand in, saving nothing', async () => {
      const res = await emit(post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '39053344705' }] })))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'TAKER_ADDRESS_REQUIRED', error: 'Complete o endereço do paciente.' })
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare.cpf).toBeNull()
      expect(await docsFor([PAY_BARE])).toHaveLength(0)
    })

    it('financial role cannot save taker data', async () => {
      auth.role = 'financial'
      const res = await emit(
        post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '39053344705', address: TAKER_ADDRESS }] })),
      )
      expect(res.status).toBe(403)
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare.cpf).toBeNull()
      expect(await docsFor([PAY_BARE])).toHaveLength(0)
    })

    it('rejects an invalid CPF', async () => {
      const res = await emit(
        post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '111.111.111-11', address: TAKER_ADDRESS }] })),
      )
      expect(res.status).toBe(400)
      expect(await docsFor([PAY_BARE])).toHaveLength(0)
    })

    it('returns 409 NFSE_NOT_CONFIGURED when the certificate is not saved', async () => {
      await db.update(nfseSettings).set({ configuredAt: null }).where(eq(nfseSettings.tenantId, TENANT))
      const res = await emit(post('/api/nfse', emitBody()))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('NFSE_NOT_CONFIGURED')
      expect(await docsFor([PAY_1])).toHaveLength(0)
    })

    it('applies the request competence and email choice when retrying a failed row', async () => {
      const [failed] = await db
        .insert(nfseDocuments)
        .values({
          tenantId: TENANT,
          paymentRecordId: PAY_1,
          patientId: PATIENT,
          environment: 'restricted',
          value: '100.00',
          competenceDate: '2026-10-30',
          emailRequested: false,
          status: 'failed',
          errorCode: 'provider_error',
          errorMessage: 'Falhou',
          createdBy: USER,
        })
        .returning({ id: nfseDocuments.id })

      const res = await emit(post('/api/nfse', emitBody({ competence: 'today', sendEmail: true })))

      expect(res.status).toBe(200)
      const [row] = await db.select().from(nfseDocuments).where(eq(nfseDocuments.id, failed.id))
      expect(row.competenceDate).toBe(brToday())
      expect(row.emailRequested).toBe(true)
    })

    it('rejects a city that does not exist in the state and saves nothing', async () => {
      const res = await emit(
        post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [{ patientId: PATIENT_BARE, cpf: '39053344705', address: { ...TAKER_ADDRESS, city: 'Cidade Inexistente' } }] })),
      )
      expect(res.status).toBe(400)
      const [bare] = await db.select().from(patients).where(eq(patients.id, PATIENT_BARE))
      expect(bare.cpf).toBeNull()
      expect(bare.address).toBeNull()
    })

    it('rejects a repeated taker patient', async () => {
      const taker = { patientId: PATIENT_BARE, cpf: '39053344705', address: TAKER_ADDRESS }
      const res = await emit(post('/api/nfse', emitBody({ paymentRecordIds: [PAY_BARE], takers: [taker, taker] })))
      expect(res.status).toBe(400)
    })

    it('merges the taker address into the existing one', async () => {
      await db
        .update(patients)
        .set({ address: { ...VALID_ADDRESS, reference: 'Ao lado do banco' } })
        .where(eq(patients.id, PATIENT))

      const res = await emit(
        post('/api/nfse', emitBody({ takers: [{ patientId: PATIENT, cpf: '529.982.247-25', address: { ...TAKER_ADDRESS, number: '2000' } }] })),
      )

      expect(res.status).toBe(200)
      const [patient] = await db.select().from(patients).where(eq(patients.id, PATIENT))
      expect(patient.address).toMatchObject({ number: '2000', reference: 'Ao lado do banco' })
    })

    it('uses today as competence when asked', async () => {
      const res = await emit(post('/api/nfse', emitBody({ competence: 'today' })))
      expect(res.status).toBe(200)
      expect((await docsFor([PAY_1]))[0].competenceDate).toBe(brToday())
    })
  })

  describe('cancel', () => {
    it('cancel requires owner or financial', async () => {
      const id = await insertIssued(PAY_1)
      const body = { reason: 2, justification: 'Serviço não foi prestado ao paciente.' }

      auth.role = 'receptionist'
      expect((await cancel(post(`/api/nfse/${id}/cancel`, body), ctx(id))).status).toBe(403)
      expect(mocks.gateway.cancel).not.toHaveBeenCalled()

      auth.role = 'financial'
      const res = await cancel(post(`/api/nfse/${id}/cancel`, body), ctx(id))
      expect(res.status).toBe(200)
      expect((await res.json()).data).toMatchObject({ id, status: 'cancelled' })
    })
  })

  describe('GET /api/financial/[id]', () => {
    it('strips NFS-e metadata from the response for practitioners', async () => {
      await insertIssued(PAY_1)
      const call = async () => {
        const res = await getFinancialEntryRoute(new Request(`http://localhost/api/financial/${ENTRY}`), ctx(ENTRY))
        const body = await res.json()
        return body.installments[0].paymentRecords.find((p: { id: string }) => p.id === PAY_1)
      }

      expect((await call()).nfse).toMatchObject({ status: 'issued' })

      auth.role = 'practitioner'
      expect(await call()).not.toHaveProperty('nfse')
    })
  })

  describe('pdf', () => {
    it('pdf is not served to another tenant', async () => {
      const id = await insertIssued(PAY_1)
      const request = () => new Request(`http://localhost/api/nfse/${id}/pdf`)

      const own = await getPdf(request(), ctx(id))
      expect(own.status).toBe(200)
      expect(own.headers.get('content-type')).toBe('application/pdf')

      auth.tenantId = TENANT_OTHER
      expect((await getPdf(request(), ctx(id))).status).toBe(404)
    })
  })

  describe('cron', () => {
    it('cron rejects a missing secret', async () => {
      vi.stubEnv('CRON_SECRET', 'segredo')
      const res = await cron(new Request('http://localhost/api/cron/nfse-retry'))
      expect(res.status).toBe(401)
    })
  })
})
