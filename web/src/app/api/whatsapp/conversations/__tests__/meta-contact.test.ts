import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/db/queries/whatsapp', () => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
  getTemplateByPurpose: vi.fn(),
  getTemplateByName: vi.fn(),
  getQueuedCount: vi.fn(),
  createQueuedMessage: vi.fn(),
  expireStaleQueuedMessages: vi.fn(),
}))

vi.mock('@/lib/whatsapp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
  return {
    ...actual,
    sendTextMessage: vi.fn(),
    sendTemplateMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    resolveTemplateBody: vi.fn(),
  }
})

vi.mock('@/lib/plans', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plans')>('@/lib/plans')
  return {
    ...actual,
    isSubscriptionActive: vi.fn(),
  }
})

vi.mock('@/db/queries/prospects', () => ({
  getProspect: vi.fn(),
  updateProspect: vi.fn(),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTextMessage } from '@/lib/whatsapp'
import { isSubscriptionActive } from '@/lib/plans'
import { getProspect, updateProspect } from '@/db/queries/prospects'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { POST } from '../[id]/messages/route'

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    tenantId: 'tenant-1',
    phoneNumber: '+5511999999999',
    profileName: 'Maria Souza',
    prospectId: 'prospect-1',
    patientId: null,
    lastMessageAt: new Date(),
    lastInboundAt: new Date(),
    unreadCount: 0,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function prospect(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prospect-1',
    tenantId: 'tenant-1',
    phone: '+5511999999999',
    name: 'Maria Souza',
    stage: 'novo',
    source: 'whatsapp',
    assignedUserId: null,
    notes: null,
    lostReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    whatsappConversationId: 'conv-1',
    ...overrides,
  }
}

function request(body: Record<string, unknown> = { body: 'Olá, tudo bem?' }) {
  return new Request('https://app.floraclin.com.br/api/whatsapp/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: 'conv-1' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getTenant).mockResolvedValue({
    id: 'tenant-1',
    name: 'Clínica Flora',
    settings: { whatsapp_mode: 'own', whatsapp_enabled: true },
  } as never)
  vi.mocked(isSubscriptionActive).mockResolvedValue(true)
  vi.mocked(sendTextMessage).mockResolvedValue({ metaMessageId: 'wamid-1' } as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
})

describe('POST /api/whatsapp/conversations/[id]/messages - Contact emission', () => {
  it('sending to a novo prospect emits one Contact with eventId contact:<prospectId>', async () => {
    vi.mocked(getConversation).mockResolvedValue(conversation() as never)
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'novo' }) as never)
    vi.mocked(updateProspect).mockResolvedValue(prospect({ stage: 'contatado' }) as never)

    const res = await POST(request(), params())
    expect(res!.status).toBe(201)

    expect(updateProspect).toHaveBeenCalledWith('tenant-1', 'prospect-1', { stage: 'contatado' })
    expect(pushSseEvent).toHaveBeenCalledWith('tenant-1', 'prospect_updated', {
      prospectId: 'prospect-1',
      stage: 'contatado',
    })
    expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventName: 'Contact',
        eventId: 'contact:prospect-1',
        prospectId: 'prospect-1',
        actionSource: 'business_messaging',
        contact: { phone: '+5511999999999', fullName: 'Maria Souza' },
      }),
    )
  })

  it('sending to a prospect already at contatado emits nothing', async () => {
    vi.mocked(getConversation).mockResolvedValue(conversation() as never)
    vi.mocked(getProspect).mockResolvedValue(prospect({ stage: 'contatado' }) as never)

    const res = await POST(request(), params())
    expect(res!.status).toBe(201)

    expect(updateProspect).not.toHaveBeenCalled()
    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })

  it('sending to a conversation with no prospect emits nothing', async () => {
    vi.mocked(getConversation).mockResolvedValue(conversation({ prospectId: null }) as never)

    const res = await POST(request(), params())
    expect(res!.status).toBe(201)

    expect(getProspect).not.toHaveBeenCalled()
    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })
})
