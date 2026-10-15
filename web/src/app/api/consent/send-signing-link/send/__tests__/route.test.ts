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

vi.mock('@/db/queries/whatsapp', () => ({
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  getTemplateForTenant: vi.fn(),
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(() => 'body'),
}))

vi.mock('@/lib/plans', () => ({
  SubscriptionExpiredError: class SubscriptionExpiredError extends Error {},
  SUBSCRIPTION_EXPIRED_RESPONSE: { body: { error: 'expired' }, status: 402 },
}))

import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { upsertConversation, createMessage } from '@/db/queries/whatsapp'
import { getTemplateForTenant, sendTemplateMessage } from '@/lib/whatsapp'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const URL = 'https://app.example.com/sign/abc'

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/consent/send-signing-link/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Clínica',
    settings: {},
  } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: PATIENT_ID, fullName: 'Maria Silva', phone: '11999990000' } as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'consent_link',
    language: 'pt_BR',
    status: 'APPROVED',
    components: [],
  } as never)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
})

describe('POST /api/consent/send-signing-link/send', () => {
  it('sends the template with the link as the third parameter for a shared-number clinic without the whatsapp_enabled flag', async () => {
    const res = await post({ patientId: PATIENT_ID, url: URL })

    expect(res.status).toBe(200)
    expect(getTemplateForTenant).toHaveBeenCalledWith('tenant-1', 'consent_signing_link')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      'consent_link',
      'pt_BR',
      { '1': 'Maria', '2': 'Clínica', '3': URL },
    )
  })

  it('refuses an own-number clinic that has not enabled WhatsApp', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica',
      settings: { whatsapp_mode: 'own' },
    } as never)

    const res = await post({ patientId: PATIENT_ID, url: URL })

    expect(res.status).toBe(403)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('answers 503 with the reason when WhatsApp is not configured', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(
      new BusinessError('WHATSAPP_NOT_CONFIGURED', 'WhatsApp da FloraClin não configurado neste ambiente (FLORACLIN_WA_*).'),
    )

    const res = await post({ patientId: PATIENT_ID, url: URL })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'WhatsApp da FloraClin não configurado neste ambiente (FLORACLIN_WA_*).',
      code: 'WHATSAPP_NOT_CONFIGURED',
    })
    expect(upsertConversation).not.toHaveBeenCalled()
  })

  it.each([
    ['a relative link', '/sign/abc'],
    ['a link to another site', 'https://evil.example/sign/abc'],
    ['a host that only starts with the app host', 'https://app.example.com.evil.example/sign/abc'],
  ])('rejects %s', async (_case, url) => {
    const res = await post({ patientId: PATIENT_ID, url })

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
})
