import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { nfseSettings, tenants } from '@/db/schema'
import { ForbiddenError } from '@/lib/errors'
import { createAuditLog } from '@/lib/audit'
import { buildTestPfx } from '@/tests/factories/nfse-certificate'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const auth = vi.hoisted(() => ({ tenantId: '', userId: '', role: 'owner' }))
vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(async () => ({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role })),
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new ForbiddenError()
    return { tenantId: auth.tenantId, userId: auth.userId, role: auth.role }
  }),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/plans', () => ({ subscriptionGate: vi.fn(async () => null) }))

import { DELETE, GET as getCertificate, PUT as putCertificate } from '../certificate/route'
import { GET as getSettings, PUT as putSettings } from '../settings/route'

const CNPJ = '11222333000181'
const PASSWORD = 'senha-segura'

const fiscalBody = {
  municipalityCode: '3550308',
  municipalRegistration: null,
  simplesNacionalOption: 1,
  simplesNacionalRegime: null,
  simplesNacionalTaxRate: null,
  servicePreset: 'estetica',
  advancedCodes: null,
  issRate: 2,
  issWithheld: false,
  emissionMode: 'ask',
  emailPatient: true,
}

function json(method: string, body?: unknown) {
  return new Request('http://localhost/api/nfse', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function upload(options: { cnpj?: string; validFrom?: Date; validTo?: Date; password?: string } = {}) {
  const password = options.password ?? PASSWORD
  return json('PUT', {
    pfxBase64: buildTestPfx({ cnpj: options.cnpj ?? CNPJ, password, validFrom: options.validFrom, validTo: options.validTo }),
    password,
  })
}

describeIntegration('NFS-e certificate and settings API (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  beforeEach(async () => {
    auth.tenantId = randomUUID()
    auth.userId = randomUUID()
    auth.role = 'owner'
    vi.mocked(createAuditLog).mockClear()
    await db.insert(tenants).values({
      id: auth.tenantId,
      name: 'Clínica Teste',
      slug: `nfse-${auth.tenantId}`,
      address: { city: 'São Paulo', state: 'SP' },
    })
    tenantIds.push(auth.tenantId)
  })

  afterEach(async () => {
    await db.delete(nfseSettings).where(inArray(nfseSettings.tenantId, tenantIds))
    await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it('rejects an expired certificate', async () => {
    const res = await putCertificate(upload({ validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2021-01-01T00:00:00Z') }))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('CERTIFICATE_EXPIRED')
  })

  it('rejects a non-owner', async () => {
    auth.role = 'receptionist'

    expect((await putCertificate(upload())).status).toBe(403)
    expect((await putSettings(json('PUT', fiscalBody))).status).toBe(403)
    expect((await DELETE(json('DELETE'))).status).toBe(403)
  })

  it('stores the certificate and never returns pfx or password', async () => {
    const put = await putCertificate(upload())
    const get = await getCertificate(json('GET'))
    const settings = await getSettings(json('GET'))

    expect(put.status).toBe(200)
    expect((await put.clone().json()).data.cnpj).toBe(CNPJ)
    for (const res of [put, get, settings]) {
      const text = await res.text()
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toMatch(/pfx/i)
    }
  })

  it('rejects a replacement certificate with another CNPJ', async () => {
    await putCertificate(upload())

    const res = await putCertificate(upload({ cnpj: '45723174000110' }))

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CERTIFICATE_CNPJ_CHANGED')
  })

  it('rejects settings before a certificate', async () => {
    const res = await putSettings(json('PUT', fiscalBody))

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CERTIFICATE_REQUIRED')
  })

  it('requires regime and rate for ME/EPP', async () => {
    await putCertificate(upload())

    const res = await putSettings(json('PUT', { ...fiscalBody, simplesNacionalOption: 3 }))

    expect(res.status).toBe(400)
    const fields = (await res.json()).fieldErrors
    expect(fields.simplesNacionalRegime).toBeDefined()
    expect(fields.simplesNacionalTaxRate).toBeDefined()
  })

  it('rejects an unknown municipality code', async () => {
    await putCertificate(upload())

    const res = await putSettings(json('PUT', { ...fiscalBody, municipalityCode: '9999999' }))

    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.municipalityCode).toBeDefined()
  })

  it('saves valid settings and suggests the municipality from the clinic address', async () => {
    await putCertificate(upload())

    const put = await putSettings(json('PUT', fiscalBody))
    const get = await getSettings(json('GET'))

    expect(put.status).toBe(200)
    const body = await get.json()
    expect(body.data.configured).toBe(true)
    expect(body.data.municipalityName).toBe('São Paulo')
    expect(body.suggestedMunicipalityCode).toBe('3550308')
  })

  it('removes the certificate and settings', async () => {
    await putCertificate(upload())

    expect((await DELETE(json('DELETE'))).status).toBe(200)
    expect((await (await getCertificate(json('GET'))).json()).data).toBeNull()
  })

  it('audit log has no secrets', async () => {
    await putCertificate(upload())
    await putSettings(json('PUT', fiscalBody))
    await DELETE(json('DELETE'))

    const rows = vi.mocked(createAuditLog).mock.calls.map(([entry]) => entry)

    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'delete'])
    expect(rows.every((r) => r.entityType === 'nfse_settings')).toBe(true)
    const text = JSON.stringify(rows)
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toMatch(/pfx/i)
  })
})
