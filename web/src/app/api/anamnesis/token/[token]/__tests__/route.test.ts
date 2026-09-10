import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  getValidToken: vi.fn(),
  markTokenUsed: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis', () => ({
  upsertAnamnesis: vi.fn(),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { isSubscriptionActive } from '@/lib/plans'
import { getValidToken, markTokenUsed } from '@/db/queries/anamnesis-tokens'
import { upsertAnamnesis } from '@/db/queries/anamnesis'
import { GET, PUT } from '../route'

const TOKEN = 'anamnesis-token-1'
const TOKEN_TENANT_ID = 'tenant-from-token'
const OTHER_TENANT_ID = 'some-other-tenant'

function makeRequest(method: string, body?: unknown) {
  return new Request(`http://localhost/api/anamnesis/token/${TOKEN}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function makeParams() {
  return { params: Promise.resolve({ token: TOKEN }) }
}

const TOKEN_ROW = {
  id: 'token-row-1',
  token: TOKEN,
  patientId: 'patient-1',
  tenantId: TOKEN_TENANT_ID,
  createdBy: 'practitioner-1',
  usedAt: null,
  patientName: 'Maria Silva',
}

// Every field on anamnesisSchema has a default, so an empty object is valid
// input and lets these tests focus on the subscription gate, not the form shape.
const ANAMNESIS_BODY = {}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getValidToken).mockResolvedValue(TOKEN_ROW as never)
  vi.mocked(markTokenUsed).mockResolvedValue({ id: 'token-row-1' } as never)
  vi.mocked(upsertAnamnesis).mockResolvedValue({ id: 'anamnesis-1' } as never)
})

describe('GET /api/anamnesis/token/[token]', () => {
  it('returns 403 when the token tenant subscription is inactive', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(false)

    const response = await GET(makeRequest('GET'), makeParams())

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toBe('Esta clínica não está aceitando envios no momento.')
  })

  it('checks the subscription for the tenant the token resolves to, not any other tenant', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    await GET(makeRequest('GET'), makeParams())

    expect(isSubscriptionActive).toHaveBeenCalledWith(TOKEN_TENANT_ID)
    expect(isSubscriptionActive).not.toHaveBeenCalledWith(OTHER_TENANT_ID)
  })

  it('proceeds normally when the token tenant subscription is active', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    const response = await GET(makeRequest('GET'), makeParams())

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.firstName).toBe('Maria')
  })
})

describe('PUT /api/anamnesis/token/[token]', () => {
  it('returns 403 when the token tenant subscription is inactive', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(false)

    const response = await PUT(makeRequest('PUT', ANAMNESIS_BODY), makeParams())

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toBe('Esta clínica não está aceitando envios no momento.')
    expect(upsertAnamnesis).not.toHaveBeenCalled()
    expect(markTokenUsed).not.toHaveBeenCalled()
  })

  it('checks the subscription for the tenant the token resolves to, not any other tenant', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    await PUT(makeRequest('PUT', ANAMNESIS_BODY), makeParams())

    expect(isSubscriptionActive).toHaveBeenCalledWith(TOKEN_TENANT_ID)
    expect(isSubscriptionActive).not.toHaveBeenCalledWith(OTHER_TENANT_ID)
  })

  it('proceeds normally when the token tenant subscription is active', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    const response = await PUT(makeRequest('PUT', ANAMNESIS_BODY), makeParams())

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(upsertAnamnesis).toHaveBeenCalled()
  })
})
