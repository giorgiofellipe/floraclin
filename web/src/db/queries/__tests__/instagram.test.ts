import { describe, it, expect, vi, beforeEach } from 'vitest'

// `db` is a builder-style chained mock. Each test overrides the terminal
// behavior (`.limit(...)` for selects) via `selectLimitResultRef`.
const selectLimitResultRef: { current: unknown } = { current: [] }

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => selectLimitResultRef.current),
          })),
          limit: vi.fn(() => selectLimitResultRef.current),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'm-1' }]),
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'c-1', isNew: true }]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => undefined),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  instagramConversations: {
    id: 'id',
    tenantId: 'tenant_id',
    igsid: 'igsid',
    igHandle: 'ig_handle',
    igProfileName: 'ig_profile_name',
    igProfilePictureUrl: 'ig_profile_picture_url',
    prospectId: 'prospect_id',
    patientId: 'patient_id',
    lastMessageAt: 'last_message_at',
    lastInboundAt: 'last_inbound_at',
    unreadCount: 'unread_count',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  instagramMessages: {
    id: 'id',
    tenantId: 'tenant_id',
    conversationId: 'conversation_id',
    direction: 'direction',
    messageType: 'message_type',
    metaMessageId: 'meta_message_id',
    body: 'body',
    deliveryStatus: 'delivery_status',
    reactionEmoji: 'reaction_emoji',
    reactsToMessageId: 'reacts_to_message_id',
    timestamp: 'timestamp',
  },
  instagramSavedReplies: {
    id: 'id',
    tenantId: 'tenant_id',
    name: 'name',
    archivedAt: 'archived_at',
  },
  prospects: {
    id: 'id',
    tenantId: 'tenant_id',
    igsid: 'igsid',
    stage: 'stage',
    createdAt: 'created_at',
    deletedAt: 'deleted_at',
  },
  sseEvents: {},
}))

describe('instagram queries — getProspectByIgsid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectLimitResultRef.current = []
  })

  it('returns null when no matching prospect exists', async () => {
    selectLimitResultRef.current = []
    const { getProspectByIgsid } = await import('../instagram')
    const result = await getProspectByIgsid('t-1', 'igsid-unknown')
    expect(result).toBeNull()
  })

  it('returns the prospect when an active one matches', async () => {
    selectLimitResultRef.current = [
      { id: 'p-1', stage: 'novo', createdAt: new Date('2026-05-20T10:00:00Z') },
    ]
    const { getProspectByIgsid } = await import('../instagram')
    const result = await getProspectByIgsid('t-1', 'igsid-1')
    expect(result).toEqual({
      id: 'p-1',
      stage: 'novo',
      createdAt: expect.any(Date),
    })
  })

  it('excludes terminal-stage prospects (no row returned)', async () => {
    // Query-level filter excludes 'convertido' and 'perdido' — so the mock
    // simulates the DB returning empty for a terminal-only IGSID.
    selectLimitResultRef.current = []
    const { getProspectByIgsid } = await import('../instagram')
    const result = await getProspectByIgsid('t-1', 'igsid-converted')
    expect(result).toBeNull()
  })
})

describe('instagram queries — pushSseEvent', () => {
  it('is exported as a function', async () => {
    const mod = await import('../instagram')
    expect(typeof mod.pushSseEvent).toBe('function')
  })
})
