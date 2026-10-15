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
import { POST } from '../route'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'

function post(url: string) {
  return POST(
    new Request(`http://localhost/api/patients/${PATIENT_ID}/anamnesis-link/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
    { params: Promise.resolve({ id: PATIENT_ID }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', name: 'Clínica', settings: {} } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: PATIENT_ID, fullName: 'Maria Silva', phone: '11999990000' } as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'platform_anamnesis_link',
    language: 'pt_BR',
    status: 'APPROVED',
    components: [],
  } as never)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
})

describe('POST /api/patients/[id]/anamnesis-link/send', () => {
  it('sends for a shared-number clinic without the whatsapp_enabled flag', async () => {
    const res = await post('https://app.example.com/a/tok-123')

    expect(res.status).toBe(201)
    expect(getTemplateForTenant).toHaveBeenCalledWith('tenant-1', 'anamnese_link')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      { actor: { type: 'user', userId: 'user-1' }, recipient: { patientId: PATIENT_ID, name: 'Maria Silva' } },
      expect.any(String),
      'platform_anamnesis_link',
      'pt_BR',
      { '1': 'Maria', '2': 'Clínica' },
      [{ index: 0, subType: 'url', parameters: [{ type: 'text', text: 'tok-123' }] }],
    )
  })

  it('refuses an own-number clinic that has not enabled WhatsApp', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      name: 'Clínica',
      settings: { whatsapp_mode: 'own' },
    } as never)

    const res = await post('https://app.example.com/a/tok-123')

    expect(res.status).toBe(403)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('answers 404 when the clinic does not exist', async () => {
    vi.mocked(getTenant).mockResolvedValue(null as never)

    const res = await post('https://app.example.com/a/tok-123')

    expect(res.status).toBe(404)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['a link to another site', 'https://evil.example/a/tok-123'],
    ['a host that only starts with the app host', 'https://app.example.com.evil.example/a/tok-123'],
  ])('rejects %s', async (_case, url) => {
    const res = await post(url)

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
})
