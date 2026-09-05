import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
}))

vi.mock('@/db/queries/consent-signing-tokens', () => ({
  getValidSigningToken: vi.fn(),
  markSigningTokenUsed: vi.fn(),
  getTemplatesForToken: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/consent', () => ({
  acceptConsent: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { isSubscriptionActive } from '@/lib/plans'
import {
  getValidSigningToken,
  markSigningTokenUsed,
  getTemplatesForToken,
} from '@/db/queries/consent-signing-tokens'
import { getPatient } from '@/db/queries/patients'
import { acceptConsent } from '@/db/queries/consent'
import { POST } from '../route'

const VALID_TOKEN = 'a'.repeat(64)
const TOKEN_TENANT_ID = 'tenant-from-token'
const OTHER_TENANT_ID = 'some-other-tenant'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/consent/sign', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    token: VALID_TOKEN,
    signatures: [
      {
        consentTemplateId: '11111111-1111-4111-8111-111111111111',
        signatureData: 'data:image/png;base64,abc',
        deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      },
    ],
    ...overrides,
  }
}

const TOKEN_DATA = {
  id: 'signing-token-1',
  token: VALID_TOKEN,
  tenantId: TOKEN_TENANT_ID,
  patientId: 'patient-1',
  procedureRecordId: 'procedure-1',
  consentTemplateIds: ['11111111-1111-4111-8111-111111111111'],
  renderedContents: {},
  createdBy: 'practitioner-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getValidSigningToken).mockResolvedValue(TOKEN_DATA as never)
  vi.mocked(getPatient).mockResolvedValue({ cpf: '12345678900' } as never)
  vi.mocked(getTemplatesForToken).mockResolvedValue([
    { id: '11111111-1111-4111-8111-111111111111', type: 'general', title: 'Termo', content: '...', version: 1 },
  ] as never)
  vi.mocked(markSigningTokenUsed).mockResolvedValue({ id: 'signing-token-1' } as never)
  vi.mocked(acceptConsent).mockResolvedValue({ id: 'acceptance-1' } as never)
})

describe('POST /api/consent/sign', () => {
  it('returns 403 when the token tenant subscription is inactive', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(false)

    const response = await POST(makeRequest(makeBody()))

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toBe('Esta clínica não está aceitando assinaturas no momento.')
    expect(acceptConsent).not.toHaveBeenCalled()
    expect(markSigningTokenUsed).not.toHaveBeenCalled()
  })

  it('checks the subscription for the tenant the token resolves to, not any other tenant', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    await POST(makeRequest(makeBody()))

    expect(isSubscriptionActive).toHaveBeenCalledWith(TOKEN_TENANT_ID)
    expect(isSubscriptionActive).not.toHaveBeenCalledWith(OTHER_TENANT_ID)
  })

  it('proceeds normally when the token tenant subscription is active', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    const response = await POST(makeRequest(makeBody()))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(acceptConsent).toHaveBeenCalled()
  })
})
