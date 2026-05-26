import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [
          {
            id: 'q-1',
            tenantId: 't-1',
            conversationId: 'c-1',
            body: 'Hello',
            mediaType: null,
            mediaUrl: null,
            status: 'queued',
            resumeMetaMessageId: 'meta-1',
            createdAt: new Date('2026-05-26T10:00:00Z'),
            sentAt: null,
            expiredAt: null,
          },
        ]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => [
            {
              id: 'q-1',
              status: 'sent',
              sentAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  whatsappQueuedMessages: {
    id: 'id',
    tenantId: 'tenant_id',
    conversationId: 'conversation_id',
    body: 'body',
    mediaType: 'media_type',
    mediaUrl: 'media_url',
    status: 'status',
    resumeMetaMessageId: 'resume_meta_message_id',
    createdAt: 'created_at',
    sentAt: 'sent_at',
    expiredAt: 'expired_at',
  },
  whatsappConversations: {},
  whatsappMessages: {},
  whatsappTemplates: {},
  whatsappAutomations: {},
  sseEvents: {},
}))

describe('whatsapp queue queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createQueuedMessage inserts and returns a record', async () => {
    const { createQueuedMessage } = await import('../whatsapp')
    const result = await createQueuedMessage('t-1', 'c-1', {
      body: 'Hello',
      resumeMetaMessageId: 'meta-1',
    })
    expect(result).toBeDefined()
    expect(result.id).toBe('q-1')
    expect(result.status).toBe('queued')
    expect(result.body).toBe('Hello')
  })

  it('getQueuedMessages returns array', async () => {
    const { getQueuedMessages } = await import('../whatsapp')
    const result = await getQueuedMessages('t-1', 'c-1')
    expect(Array.isArray(result)).toBe(true)
  })

  it('updateQueuedMessageStatus updates and returns record', async () => {
    const { updateQueuedMessageStatus } = await import('../whatsapp')
    const result = await updateQueuedMessageStatus('t-1', 'q-1', 'sent')
    expect(result).toBeDefined()
    expect(result?.status).toBe('sent')
  })
})
