import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
  claimReactivation: vi.fn(),
  releaseReactivation: vi.fn(),
}))
vi.mock('@/db/queries/marketing-consent', () => ({ isMarketingOptedOut: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ getTemplateForTenant: vi.fn() }))
vi.mock('@/lib/whatsapp-automated-send', () => ({ sendAndRecordTemplate: vi.fn() }))

import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { claimReactivation, getPatient, releaseReactivation } from '@/db/queries/patients'
import { isMarketingOptedOut } from '@/db/queries/marketing-consent'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { POST } from '../route'

const PREVIOUS_SEND = new Date('2026-08-01T12:00:00-03:00')

function post() {
  return POST(
    new Request('https://app.floraclin.com.br/api/patients/p1/reactivation', { method: 'POST' }),
    { params: Promise.resolve({ id: 'p1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: { tenantId: 't1', userId: 'u1', role: 'owner' }, blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: { whatsapp_enabled: true } } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: 'p1', fullName: 'Maria Silva', phone: '11999991234' } as never)
  vi.mocked(isMarketingOptedOut).mockResolvedValue(false)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'reactivation',
    language: 'pt_BR',
    status: 'APPROVED',
    purposeKey: 'reactivation',
    variableMapping: null,
    components: [],
  } as never)
  vi.mocked(claimReactivation).mockResolvedValue({ previous: PREVIOUS_SEND })
  vi.mocked(releaseReactivation).mockResolvedValue()
  vi.mocked(sendAndRecordTemplate).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
})

describe('POST /api/patients/[id]/reactivation', () => {
  it('sends the reactivation template, charged to the user who asked', async () => {
    const res = await post()

    expect(res.status).toBe(201)
    expect(sendAndRecordTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5511999991234',
      params: { '1': 'Maria', '2': 'Clínica Lume' },
      actor: { type: 'user', userId: 'u1' },
    }))
  })

  it.each([
    // Regression: promotional message reaching a patient who opted out.
    ['the patient opted out of marketing', () => vi.mocked(isMarketingOptedOut).mockResolvedValue(true)],
    // Regression: a second click, or a second staff member, sending again within the cooldown.
    ['another reactivation went out within the cooldown', () => vi.mocked(claimReactivation).mockResolvedValue(null)],
  ])('refuses with 409 without sending when %s', async (_label, arrange) => {
    arrange()

    const res = await post()

    expect(res.status).toBe(409)
    expect(sendAndRecordTemplate).not.toHaveBeenCalled()
  })

  // Regression: a failed send keeping the new marker, which blocks the patient for 30 days with nothing sent.
  it('restores the previous marker when the send fails', async () => {
    vi.mocked(sendAndRecordTemplate).mockRejectedValue(new CreditExhaustedError(100, 100, 3))

    const res = await post()

    expect(res.status).toBe(402)
    expect(releaseReactivation).toHaveBeenCalledWith('t1', 'p1', PREVIOUS_SEND)
  })
})
