import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  getValidToken: vi.fn(),
  markTokenUsed: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis', async (importOriginal) => ({
  StaleDataError: (await importOriginal<typeof import('@/db/queries/anamnesis')>()).StaleDataError,
  getAnamnesis: vi.fn(),
  upsertAnamnesis: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))

vi.mock('@/db/queries/anamnesis-templates', () => ({
  getCurrentAnamnesisTemplate: vi.fn(),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { isSubscriptionActive } from '@/lib/plans'
import { getValidToken, markTokenUsed } from '@/db/queries/anamnesis-tokens'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { createAuditLog } from '@/lib/audit'
import { getCurrentAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
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

const TEMPLATE = {
  version: 5,
  sections: [
    {
      id: 's1',
      title: 'Geral',
      order: 0,
      questions: [{ id: 'q1', label: 'Queixa', type: 'text' as const, required: false, order: 0 }],
    },
  ],
}

const ANAMNESIS_BODY = { templateVersion: 5, responses: {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getValidToken).mockResolvedValue(TOKEN_ROW as never)
  vi.mocked(markTokenUsed).mockResolvedValue({ id: 'token-row-1' } as never)
  vi.mocked(getAnamnesis).mockResolvedValue(null)
  vi.mocked(upsertAnamnesis).mockResolvedValue({ id: 'anamnesis-1' } as never)
  vi.mocked(getCurrentAnamnesisTemplate).mockResolvedValue(TEMPLATE)
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

  it('returns 400 and saves nothing when the body has no responses', async () => {
    // Regression: a pre-deploy bundle sending the old shape blanked the record.
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    const response = await PUT(makeRequest('PUT', { mainComplaint: 'x' }), makeParams())

    expect(response.status).toBe(400)
    expect(upsertAnamnesis).not.toHaveBeenCalled()
    expect(markTokenUsed).not.toHaveBeenCalled()
  })

  it('saves with the current template of the token tenant', async () => {
    // Regression: writing with another tenant's (or the default) template.
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)

    await PUT(makeRequest('PUT', { templateVersion: 5, responses: { q1: 'Manchas' } }), makeParams())

    expect(getCurrentAnamnesisTemplate).toHaveBeenCalledWith(TOKEN_TENANT_ID)
    expect(upsertAnamnesis).toHaveBeenCalledWith(
      TOKEN_TENANT_ID,
      'patient-1',
      'practitioner-1',
      { templateVersion: 5, templateSnapshot: TEMPLATE.sections, responses: { q1: 'Manchas' } },
      undefined,
    )
  })

  it('retries once when a staff insert races the submit, so the patient does not get a 500', async () => {
    // Regression: the patient_id conflict from a concurrent staff insert surfaced as a 500.
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    vi.mocked(upsertAnamnesis).mockRejectedValueOnce(new StaleDataError())

    const response = await PUT(makeRequest('PUT', { templateVersion: 5, responses: { q1: 'Manchas' } }), makeParams())

    expect(response.status).toBe(200)
    expect(upsertAnamnesis).toHaveBeenCalledTimes(2)
    expect(getAnamnesis).toHaveBeenCalledTimes(2)
    expect(markTokenUsed).toHaveBeenCalledWith(TOKEN)
  })

  // Regression: a second StaleDataError on the retry surfaced as a 500.
  it('answers 409 with the stale message when the retry is stale too, and keeps the token usable', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    vi.mocked(upsertAnamnesis).mockRejectedValue(new StaleDataError())

    const response = await PUT(makeRequest('PUT', { templateVersion: 5, responses: { q1: 'Manchas' } }), makeParams())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(new StaleDataError().message)
    expect(markTokenUsed).not.toHaveBeenCalled()
  })

  // Regression: the public write left no audit trail, and the audit must not copy health answers.
  it('merges over the existing record under its lock and audits the write as the token creator without answers', async () => {
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    const updatedAt = new Date('2026-10-12T15:00:00.123Z')
    vi.mocked(getAnamnesis).mockResolvedValue({
      id: 'anamnesis-1', patientId: 'patient-1', templateVersion: 5, templateSnapshot: TEMPLATE.sections,
      responses: { q1: 'Resposta da equipe' }, updatedBy: 'practitioner-1', createdAt: updatedAt, updatedAt,
    })

    await PUT(makeRequest('PUT', { templateVersion: 5, responses: { q1: '' } }), makeParams())

    expect(upsertAnamnesis).toHaveBeenCalledWith(
      TOKEN_TENANT_ID,
      'patient-1',
      'practitioner-1',
      { templateVersion: 5, templateSnapshot: TEMPLATE.sections, responses: { q1: 'Resposta da equipe' } },
      updatedAt,
    )
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TOKEN_TENANT_ID, userId: 'practitioner-1', action: 'update', entityType: 'anamnesis', entityId: 'anamnesis-1',
    }))
    expect(JSON.stringify(vi.mocked(createAuditLog).mock.calls)).not.toContain('Resposta')
  })
})
