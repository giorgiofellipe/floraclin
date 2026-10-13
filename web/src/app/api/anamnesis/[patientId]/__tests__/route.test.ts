import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/anamnesis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/queries/anamnesis')>()),
  getAnamnesis: vi.fn(),
  upsertAnamnesis: vi.fn(),
}))
vi.mock('@/db/queries/anamnesis-templates', () => ({ getCurrentAnamnesisTemplate: vi.fn() }))

import { requireWrite } from '@/lib/write-access'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { getCurrentAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
import { PUT } from '../route'

const PATIENT = 'patient-1'

function put(body: unknown) {
  return PUT(new Request(`http://localhost/api/anamnesis/${PATIENT}`, { method: 'PUT', body: JSON.stringify(body) }), {
    params: Promise.resolve({ patientId: PATIENT }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as Awaited<ReturnType<typeof requireWrite>>)
  vi.mocked(getAnamnesis).mockResolvedValue(null)
  vi.mocked(getCurrentAnamnesisTemplate).mockResolvedValue({ version: 3, sections: [] })
})

describe('PUT /api/anamnesis/[patientId]', () => {
  it('rejects the old { formData } body with 400 and never writes', async () => {
    // Regression: a stale browser bundle blanking the record.
    const res = await put({ formData: { mainComplaint: 'x' } })

    expect(res.status).toBe(400)
    expect(upsertAnamnesis).not.toHaveBeenCalled()
  })

  // Regression: a save without a lock token skipped the optimistic lock and overwrote newer answers.
  it('rejects a save naming neither expectedUpdatedAt nor expectNoRow with 400 and never writes', async () => {
    const res = await put({ templateVersion: 3, responses: {} })

    expect(res.status).toBe(400)
    expect(upsertAnamnesis).not.toHaveBeenCalled()
  })

  it('answers 409 template_changed when the body names another template version', async () => {
    const res = await put({ templateVersion: 1, responses: {}, expectNoRow: true })

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('template_changed')
    expect(upsertAnamnesis).not.toHaveBeenCalled()
  })

  it('answers 409 stale when the optimistic lock fails', async () => {
    vi.mocked(upsertAnamnesis).mockRejectedValue(new StaleDataError())

    const res = await put({ templateVersion: 3, responses: {}, expectNoRow: true })

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('stale')
  })
})
