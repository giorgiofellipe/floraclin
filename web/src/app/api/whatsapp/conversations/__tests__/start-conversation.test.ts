import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/db/queries/marketing-consent', () => ({ isMarketingOptedOut: vi.fn() }))
vi.mock('@/db/queries/whatsapp', () => ({
  listConversations: vi.fn(),
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
  getSendableTemplate: vi.fn(),
}))
vi.mock('@/lib/whatsapp', () => ({
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { isMarketingOptedOut } from '@/db/queries/marketing-consent'
import { getSendableTemplate, upsertConversation } from '@/db/queries/whatsapp'
import { sendTemplateMessage } from '@/lib/whatsapp'
import { POST } from '../route'

const AUTH_CTX = { tenantId: 't1', userId: 'u1', role: 'owner' }
const PATIENT_ID = '7b0c5a43-58c4-4b5e-9a39-0d0b7f2a6c11'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue(AUTH_CTX as never)
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_CTX, blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: { whatsapp_enabled: true } } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: PATIENT_ID, fullName: 'Maria Silva', phone: '11999991234' } as never)
  vi.mocked(isMarketingOptedOut).mockResolvedValue(true)
  vi.mocked(getSendableTemplate).mockResolvedValue({
    name: 'clinica_floraclin_birthday_greeting',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [],
  } as never)
})

describe('POST /api/whatsapp/conversations', () => {
  // Regression: the birthday button sending a promotional template to a patient who opted out.
  it('refuses a marketing template for an opted-out patient before anything is sent or created', async () => {
    const res = await POST(new Request('https://app.floraclin.com.br/api/whatsapp/conversations', {
      method: 'POST',
      body: JSON.stringify({
        patientId: PATIENT_ID,
        templateName: 'clinica_floraclin_birthday_greeting',
        language: 'pt_BR',
        params: { '1': 'Maria', '2': 'Clínica Lume' },
      }),
    }))

    expect(res?.status).toBe(409)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(upsertConversation).not.toHaveBeenCalled()
  })

  it('still sends a utility template to an opted-out patient', async () => {
    vi.mocked(getSendableTemplate).mockResolvedValue({ name: 'confirm_appointment', language: 'pt_BR', category: 'UTILITY', components: [] } as never)
    vi.mocked(upsertConversation).mockResolvedValue({ id: 'c1' } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)

    const res = await POST(new Request('https://app.floraclin.com.br/api/whatsapp/conversations', {
      method: 'POST',
      body: JSON.stringify({ patientId: PATIENT_ID, templateName: 'confirm_appointment', language: 'pt_BR', params: {} }),
    }))

    expect(res?.status).toBe(201)
    expect(sendTemplateMessage).toHaveBeenCalled()
  })
})
