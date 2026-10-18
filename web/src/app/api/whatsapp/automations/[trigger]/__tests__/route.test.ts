import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  upsertAutomation: vi.fn(),
  getTemplateById: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { upsertAutomation } from '@/db/queries/whatsapp'
import { PATCH } from '../route'

function patch(trigger: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/whatsapp/automations/${trigger}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ trigger }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 't1', userId: 'u1', role: 'owner' } as never)
  vi.mocked(requireWrite).mockResolvedValue({ blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: null } as never)
  vi.mocked(upsertAutomation).mockImplementation(async (_t, trigger, data) => ({ trigger, ...data }) as never)
})

describe('PATCH /api/whatsapp/automations/[trigger]', () => {
  it('rejects a day count outside the allowed range instead of saving it', async () => {
    const res = await patch('payment_reminder', { enabled: true, config: { daysBeforeDue: -3 } })

    expect(res.status).toBe(400)
    expect(upsertAutomation).not.toHaveBeenCalled()
  })

  it('saves the config with the trigger defaults filled in', async () => {
    const res = await patch('follow_up', { enabled: true, config: {} })

    expect(res.status).toBe(200)
    expect(upsertAutomation).toHaveBeenCalledWith('t1', 'follow_up', {
      enabled: true,
      config: { daysAfterProcedure: 7 },
    })
  })
})
