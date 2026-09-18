import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/procedures', () => ({
  getProcedure: vi.fn(),
}))

vi.mock('@/db/queries/consent-signing-tokens', () => ({
  createSigningToken: vi.fn(),
  getTemplatesForToken: vi.fn(),
}))

vi.mock('@/db/queries/consent', () => ({
  getActiveConsentForType: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getProcedure } from '@/db/queries/procedures'
import { createSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getActiveConsentForType } from '@/db/queries/consent'
import { POST } from '../route'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const PROCEDURE_ID = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_A = '33333333-3333-4333-8333-333333333333'
const TEMPLATE_B = '44444444-4444-4444-8444-444444444444'

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/consent/send-signing-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1' } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: PATIENT_ID } as never)
  vi.mocked(getProcedure).mockResolvedValue({ id: PROCEDURE_ID, patientId: PATIENT_ID } as never)
  vi.mocked(createSigningToken).mockResolvedValue({
    token: 'tok',
    expiresAt: new Date('2026-09-16T12:00:00Z'),
  } as never)
})

describe('POST /api/consent/send-signing-link', () => {
  describe('by template ids (no procedure)', () => {
    it('creates a token with a null procedure and id-keyed rendered contents', async () => {
      vi.mocked(getTemplatesForToken).mockResolvedValue([{ id: TEMPLATE_A }] as never)

      const res = await post({
        patientId: PATIENT_ID,
        consentTemplateIds: [TEMPLATE_A],
        renderedContents: { [TEMPLATE_A]: 'texto renderizado', [TEMPLATE_B]: 'ignorado' },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ url: expect.stringContaining('/sign/tok') })
      expect(createSigningToken).toHaveBeenCalledWith(
        'tenant-1',
        PATIENT_ID,
        null,
        [TEMPLATE_A],
        'user-1',
        { [TEMPLATE_A]: 'texto renderizado' },
      )
      expect(getProcedure).not.toHaveBeenCalled()
      expect(getActiveConsentForType).not.toHaveBeenCalled()
    })

    it('rejects when the lookup returns fewer templates than requested', async () => {
      vi.mocked(getTemplatesForToken).mockResolvedValue([{ id: TEMPLATE_A }] as never)

      const res = await post({ patientId: PATIENT_ID, consentTemplateIds: [TEMPLATE_A, TEMPLATE_B] })

      expect(res.status).toBe(400)
      expect(createSigningToken).not.toHaveBeenCalled()
    })

    it('deduplicates repeated ids before comparing with the lookup', async () => {
      vi.mocked(getTemplatesForToken).mockResolvedValue([{ id: TEMPLATE_A }] as never)

      const res = await post({ patientId: PATIENT_ID, consentTemplateIds: [TEMPLATE_A, TEMPLATE_A] })

      expect(res.status).toBe(200)
      expect(getTemplatesForToken).toHaveBeenCalledWith('tenant-1', [TEMPLATE_A])
      expect(createSigningToken).toHaveBeenCalledWith(
        'tenant-1',
        PATIENT_ID,
        null,
        [TEMPLATE_A],
        'user-1',
        undefined,
      )
    })
  })

  describe('by consent types (procedure flow)', () => {
    it('resolves every type and links the token to the procedure', async () => {
      vi.mocked(getActiveConsentForType).mockResolvedValue({ id: TEMPLATE_A } as never)

      const res = await post({
        patientId: PATIENT_ID,
        procedureRecordId: PROCEDURE_ID,
        consentTypes: ['service_contract'],
        renderedContents: { service_contract: 'contrato' },
      })

      expect(res.status).toBe(200)
      expect(getProcedure).toHaveBeenCalledWith('tenant-1', PROCEDURE_ID)
      expect(createSigningToken).toHaveBeenCalledWith(
        'tenant-1',
        PATIENT_ID,
        PROCEDURE_ID,
        [TEMPLATE_A],
        'user-1',
        { [TEMPLATE_A]: 'contrato' },
      )
      expect(getTemplatesForToken).not.toHaveBeenCalled()
    })

    it('rejects a type with no active template instead of dropping it', async () => {
      vi.mocked(getActiveConsentForType).mockImplementation(
        (async (_tenantId: string, type: string) => (type === 'botox' ? { id: TEMPLATE_A } : null)) as never,
      )

      const res = await post({
        patientId: PATIENT_ID,
        procedureRecordId: PROCEDURE_ID,
        consentTypes: ['botox', 'service_contract'],
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('service_contract') })
      expect(createSigningToken).not.toHaveBeenCalled()
    })

    it('refuses a procedure that belongs to another patient', async () => {
      vi.mocked(getProcedure).mockResolvedValue({ id: PROCEDURE_ID, patientId: 'someone-else' } as never)

      const res = await post({ patientId: PATIENT_ID, procedureRecordId: PROCEDURE_ID, consentTypes: ['botox'] })

      expect(res.status).toBe(404)
      expect(createSigningToken).not.toHaveBeenCalled()
    })
  })

  it('rejects a body with both selectors', async () => {
    const res = await post({
      patientId: PATIENT_ID,
      procedureRecordId: PROCEDURE_ID,
      consentTypes: ['botox'],
      consentTemplateIds: [TEMPLATE_A],
    })
    expect(res.status).toBe(400)
    expect(createSigningToken).not.toHaveBeenCalled()
  })

  it('rejects consent types without a procedure', async () => {
    const res = await post({ patientId: PATIENT_ID, consentTypes: ['botox'] })
    expect(res.status).toBe(400)
    expect(createSigningToken).not.toHaveBeenCalled()
  })

  it('returns the blocked response untouched', async () => {
    const blocked = new Response(null, { status: 402 })
    vi.mocked(requireWrite).mockResolvedValue({ ctx: null, blocked } as never)

    const res = await post({ patientId: PATIENT_ID, consentTemplateIds: [TEMPLATE_A] })

    expect(res).toBe(blocked)
    expect(createSigningToken).not.toHaveBeenCalled()
  })
})
