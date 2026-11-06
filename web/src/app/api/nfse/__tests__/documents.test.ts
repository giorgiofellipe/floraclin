// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import { strFromU8, unzipSync } from 'fflate'
import { db } from '@/db/client'
import { financialEntries, installments, nfseDocuments, patients, paymentRecords, tenants } from '@/db/schema'
import { ForbiddenError } from '@/lib/errors'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const auth = vi.hoisted(() => ({ tenantId: '', userId: '', role: 'owner' }))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new ForbiddenError()
    return { tenantId: auth.tenantId, userId: auth.userId, role: auth.role }
  }),
}))

import { GET as list } from '../documents/route'
import { GET as exportZip } from '../documents/export/route'

const TENANT = '00000000-0000-0000-0000-0000000fa001'
const TENANT_OTHER = '00000000-0000-0000-0000-0000000fa002'
const USER = '00000000-0000-0000-0000-0000000fa101'
const PATIENT = '00000000-0000-0000-0000-0000000fa201'
const PATIENT_OTHER = '00000000-0000-0000-0000-0000000fa202'
const ENTRY = '00000000-0000-0000-0000-0000000fa301'
const ENTRY_OTHER = '00000000-0000-0000-0000-0000000fa302'
const INST = '00000000-0000-0000-0000-0000000fa401'
const INST_OTHER = '00000000-0000-0000-0000-0000000fa402'
const PAY = (n: number) => `00000000-0000-0000-0000-0000000fa5${String(n).padStart(2, '0')}`
const PAYMENTS = [1, 2, 3, 4, 5, 6].map(PAY)
const TENANTS = [TENANT, TENANT_OTHER]

// 23:30 BRT on 05/11 is already 06/11 in UTC.
const LATE_ON_NOV_5 = new Date('2026-11-06T02:30:00Z')
const NOV_3 = new Date('2026-11-03T15:00:00Z')

const url = (path: string, params: Record<string, string>) =>
  new Request(`http://localhost/api/nfse/${path}?${new URLSearchParams(params)}`)
const november = { dateFrom: '2026-11-01', dateTo: '2026-11-30' }

type DocInput = Partial<typeof nfseDocuments.$inferInsert> & { paymentRecordId: string }

function doc(input: DocInput): typeof nfseDocuments.$inferInsert {
  return {
    tenantId: TENANT,
    patientId: PATIENT,
    environment: 'production',
    value: '150.00',
    competenceDate: '2026-11-03',
    status: 'issued',
    createdBy: USER,
    createdAt: NOV_3,
    ...input,
  }
}

describeIntegration('NFS-e documents list and export (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO floraclin.users (id, email, full_name) VALUES (${USER}, 'nfse-list@example.com', 'Nfse List') ON CONFLICT DO NOTHING`)
    for (const [id, n] of [[TENANT, 'a'], [TENANT_OTHER, 'b']]) {
      await db.insert(tenants).values({ id, name: `Clinica ${n}`, slug: `nfse-list-${n}`, email: 'clinica@example.com' }).onConflictDoNothing()
    }
    await db.insert(patients).values([
      { id: PATIENT, tenantId: TENANT, phone: '11999992001', fullName: 'Maria Souza' },
      { id: PATIENT_OTHER, tenantId: TENANT_OTHER, phone: '11999992002', fullName: 'Outro Paciente' },
    ]).onConflictDoNothing()
    await db.insert(financialEntries).values([
      { id: ENTRY, tenantId: TENANT, patientId: PATIENT, description: 'Limpeza de pele', totalAmount: '900', createdBy: USER },
      { id: ENTRY_OTHER, tenantId: TENANT_OTHER, patientId: PATIENT_OTHER, description: 'Outro', totalAmount: '150', createdBy: USER },
    ]).onConflictDoNothing()
    const fine = { appliedFineType: 'percentage', appliedFineValue: '2', appliedInterestRate: '1', appliedGracePeriodDays: 0 }
    await db.insert(installments).values([
      { id: INST, tenantId: TENANT, financialEntryId: ENTRY, installmentNumber: 1, amount: '900', dueDate: '2026-11-03', ...fine },
      { id: INST_OTHER, tenantId: TENANT_OTHER, financialEntryId: ENTRY_OTHER, installmentNumber: 1, amount: '150', dueDate: '2026-11-03', ...fine },
    ]).onConflictDoNothing()
    await db.insert(paymentRecords).values(
      PAYMENTS.map((id, i) => ({
        id,
        installmentId: i === 5 ? INST_OTHER : INST,
        amount: '150',
        paymentMethod: 'pix',
        paidAt: NOV_3,
        recordedBy: USER,
      })),
    ).onConflictDoNothing()
  })

  beforeEach(async () => {
    auth.tenantId = TENANT
    auth.userId = USER
    auth.role = 'owner'
    await db.delete(nfseDocuments).where(inArray(nfseDocuments.tenantId, TENANTS))
    await db.insert(nfseDocuments).values([
      doc({ paymentRecordId: PAY(1), nfseNumber: '1', accessKey: 'KEY1', nfseXml: '<NFSe>1</NFSe>', issuedAt: LATE_ON_NOV_5, payloadSnapshot: null }),
      doc({ paymentRecordId: PAY(2), status: 'cancelled', nfseNumber: '2', accessKey: 'KEY2', nfseXml: '<NFSe>2</NFSe>', issuedAt: NOV_3 }),
      doc({ paymentRecordId: PAY(3), status: 'failed', errorCode: 'invalid_request', errorMessage: 'E1235: Falha no esquema' }),
      doc({ paymentRecordId: PAY(4), status: 'pending' }),
      doc({ paymentRecordId: PAY(5), status: 'processing' }),
      doc({ paymentRecordId: PAY(6), tenantId: TENANT_OTHER, patientId: PATIENT_OTHER, nfseNumber: '9', accessKey: 'KEY9', nfseXml: '<NFSe>9</NFSe>', issuedAt: NOV_3 }),
    ])
  })

  afterAll(async () => {
    await db.delete(nfseDocuments).where(inArray(nfseDocuments.tenantId, TENANTS))
    await db.delete(paymentRecords).where(inArray(paymentRecords.id, PAYMENTS))
    await db.delete(installments).where(inArray(installments.id, [INST, INST_OTHER]))
    await db.delete(financialEntries).where(inArray(financialEntries.id, [ENTRY, ENTRY_OTHER]))
    await db.delete(patients).where(inArray(patients.id, [PATIENT, PATIENT_OTHER]))
  })

  describe('GET /api/nfse/documents', () => {
    it("lists only the clinic's notes, newest first, without XML or snapshot", async () => {
      const res = await list(url('documents', november))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(5)
      expect(body.data.map((d: { paymentRecordId: string }) => d.paymentRecordId)[0]).toBe(PAY(1))
      expect(body.data.every((d: { patientName: string }) => d.patientName === 'Maria Souza')).toBe(true)
      for (const row of body.data) {
        expect(row).not.toHaveProperty('nfseXml')
        expect(row).not.toHaveProperty('payloadSnapshot')
      }
      expect(body.data.find((d: { paymentRecordId: string }) => d.paymentRecordId === PAY(3))).toMatchObject({
        status: 'failed',
        errorMessage: 'E1235: Falha no esquema',
        retryable: true,
      })
    })

    it.each([
      { status: 'processing', expected: [PAY(4), PAY(5)] },
      { status: 'issued', expected: [PAY(1)] },
      { status: 'cancelled', expected: [PAY(2)] },
    ])('filters status=$status', async ({ status, expected }) => {
      const body = await (await list(url('documents', { ...november, status }))).json()
      expect(body.data.map((d: { paymentRecordId: string }) => d.paymentRecordId).sort()).toEqual(expected.sort())
    })

    it.each([
      { name: 'ending on that BR day', range: { dateFrom: '2026-11-04', dateTo: '2026-11-05' }, included: true },
      { name: 'starting the next BR day', range: { dateFrom: '2026-11-06', dateTo: '2026-11-30' }, included: false },
    ])('places a note issued at 23:30 BRT on 05/11 in a range $name', async ({ range, included }) => {
      const body = await (await list(url('documents', { ...range, status: 'issued' }))).json()
      expect(body.data.some((d: { paymentRecordId: string }) => d.paymentRecordId === PAY(1))).toBe(included)
    })
  })

  describe('GET /api/nfse/documents/export', () => {
    it("zips the XML of the clinic's issued and cancelled notes", async () => {
      const res = await exportZip(url('documents/export', november))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="notas-fiscais-2026-11-01-a-2026-11-30.zip"')
      const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
      expect(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]))).toEqual({
        'NFS-e-1.xml': '<NFSe>1</NFSe>',
        'NFS-e-2.xml': '<NFSe>2</NFSe>',
      })
    })

    it('refuses a period with more than 1000 notes', async () => {
      await db.insert(nfseDocuments).values(
        Array.from({ length: 1000 }, (_, i) =>
          doc({ paymentRecordId: PAY(2), status: 'cancelled', nfseNumber: `c${i}`, accessKey: `KC${i}`, nfseXml: '<NFSe/>', issuedAt: NOV_3 }),
        ),
      )
      const res = await exportZip(url('documents/export', november))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Mais de 1000 notas/)
    })

    it('is not open to the reception', async () => {
      auth.role = 'receptionist'
      expect((await exportZip(url('documents/export', november))).status).toBe(403)
    })
  })
})
