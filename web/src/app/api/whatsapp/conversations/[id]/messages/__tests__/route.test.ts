import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/prospects', () => ({ getProspect: vi.fn(), updateProspect: vi.fn() }))
vi.mock('@/lib/meta/events', () => ({ enqueueMetaEvent: vi.fn() }))

vi.mock('@/db/queries/whatsapp', () => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
  getSendableTemplate: vi.fn(),
  getQueuedCount: vi.fn(),
  createQueuedMessage: vi.fn(),
  expireStaleQueuedMessages: vi.fn(),
}))

vi.mock('@/lib/whatsapp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
  return {
    resolveTemplateBody: actual.resolveTemplateBody,
    pendingQueueCost: actual.pendingQueueCost,
    sendTextMessage: vi.fn(),
    sendTemplateMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    requireCredits: vi.fn(),
    getTemplateForTenant: vi.fn(),
  }
})

import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import {
  createMessage,
  createQueuedMessage,
  expireStaleQueuedMessages,
  getConversation,
  getQueuedCount,
  getSendableTemplate,
} from '@/db/queries/whatsapp'
import { getTemplateForTenant, sendTemplateMessage } from '@/lib/whatsapp'
import { POST } from '../route'

const AUTH_CTX = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

// Seeded under another tenant: the shared number's templates are never the
// sending clinic's own rows.
const SYSTEM_RESUME_TEMPLATE = {
  id: 'tpl-system',
  tenantId: 'tenant-floraclin',
  systemTemplate: true,
  name: 'clinica_floraclin_resume_conversation',
  language: 'pt_BR',
  status: 'APPROVED',
  purposeKey: 'resume_conversation',
  variableMapping: null,
  components: [{ type: 'BODY', text: 'Olá, {{1}}! Podemos retomar nossa conversa?' }],
}

function post(body: unknown) {
  return POST(
    new Request('https://app.floraclin.com.br/api/whatsapp/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'conv-1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue(AUTH_CTX as never)
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_CTX, blocked: null } as never)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Flora Clinic',
    settings: { whatsapp_mode: 'floraclin' },
  } as never)
  vi.mocked(getConversation).mockResolvedValue({
    id: 'conv-1',
    phoneNumber: '5547988443635',
    profileName: 'Maria Silva',
    patientId: 'patient-1',
    prospectId: null,
    lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  } as never)
  vi.mocked(expireStaleQueuedMessages).mockResolvedValue([] as never)
  vi.mocked(getQueuedCount).mockResolvedValue(0 as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue(SYSTEM_RESUME_TEMPLATE as never)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
  vi.mocked(createMessage).mockImplementation(async (_t, _c, data) => ({ id: 'msg-1', ...data }) as never)
  vi.mocked(createQueuedMessage).mockResolvedValue({ id: 'queued-1', createdAt: new Date() } as never)
})

describe('POST /api/whatsapp/conversations/[id]/messages', () => {
  it('reopens a closed window on the shared number with the system resume template', async () => {
    const res = await post({ body: 'Oi Maria, tudo bem?' })

    expect(res?.status).toBe(201)
    expect(getTemplateForTenant).toHaveBeenCalledWith('tenant-1', 'resume_conversation')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'tenant-1',
      expect.anything(),
      '5547988443635',
      'clinica_floraclin_resume_conversation',
      'pt_BR',
      { '1': 'Maria' },
    )
    expect(createQueuedMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conv-1',
      expect.objectContaining({ body: 'Oi Maria, tudo bem?', resumeMetaMessageId: 'wamid.1' }),
    )
  })

  it('stores the rendered body of a system template the clinic sent from the picker', async () => {
    vi.mocked(getSendableTemplate).mockResolvedValue(SYSTEM_RESUME_TEMPLATE as never)

    await post({
      templateName: 'clinica_floraclin_resume_conversation',
      language: 'pt_BR',
      params: { '1': 'Maria' },
    })

    expect(createMessage).toHaveBeenCalledWith(
      'tenant-1',
      'conv-1',
      expect.objectContaining({ body: 'Olá, Maria! Podemos retomar nossa conversa?' }),
    )
  })
})
