import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateWhere = vi.fn()

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'user-1' }, blocked: null })),
}))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/client', () => ({
  db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })) },
}))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
  updateTenant: vi.fn(),
  updateTenantSettings: vi.fn(),
  createProcedureType: vi.fn(),
  listProcedureTypes: vi.fn(async () => []),
}))
vi.mock('@/db/queries/admin-tenants', () => ({
  findAvailableSlug: vi.fn(),
  generateSlug: vi.fn(),
}))

import { updateTenant } from '@/db/queries/tenants'
import { DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { POST } from '../route'

function postOnboarding(clinic: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ clinic, procedureTypes: [], selectedProducts: [] }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/onboarding', () => {
  // Regression: a taken booking link failed onboarding with a generic 500.
  it('answers 409 with a clear message when the slug is taken, before changing the clinic', async () => {
    updateWhere.mockRejectedValue(
      new Error('Failed query', { cause: { code: '23505', constraint_name: 'tenants_slug_unique' } }),
    )

    const res = await postOnboarding({ name: 'Clinica Bela', slug: 'clinica-bela', workingHours: DEFAULT_WORKING_HOURS })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Este link já está em uso. Escolha outro.')
    expect(updateTenant).not.toHaveBeenCalled()
  })
})
