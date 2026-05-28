import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────
//
// Everything that talks to a real backend (auth, tenants, db, the Meta
// Instagram client, etc.) is mocked. We replace the db client with a
// chained-builder mock matching the shape used by the queries module.

const getAuthContextMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthContext: (...a: unknown[]) => getAuthContextMock(...a),
}))

const getTenantMock = vi.fn()
vi.mock('@/db/queries/tenants', () => ({
  getTenant: (...a: unknown[]) => getTenantMock(...a),
}))

const getConversationByIdMock = vi.fn()
const getConversationByIgsidMock = vi.fn()
const listMessagesMock = vi.fn()
const listConversationsMock = vi.fn()
const createMessageMock = vi.fn()
const markConversationReadMock = vi.fn()
const linkPatientMock = vi.fn()
const unlinkPatientMock = vi.fn()
const pushSseEventMock = vi.fn()
const getProspectByIgsidMock = vi.fn()
vi.mock('@/db/queries/instagram', () => ({
  getConversationById: (...a: unknown[]) => getConversationByIdMock(...a),
  getConversationByIgsid: (...a: unknown[]) => getConversationByIgsidMock(...a),
  listMessages: (...a: unknown[]) => listMessagesMock(...a),
  listConversations: (...a: unknown[]) => listConversationsMock(...a),
  createMessage: (...a: unknown[]) => createMessageMock(...a),
  markConversationRead: (...a: unknown[]) => markConversationReadMock(...a),
  linkPatient: (...a: unknown[]) => linkPatientMock(...a),
  unlinkPatient: (...a: unknown[]) => unlinkPatientMock(...a),
  pushSseEvent: (...a: unknown[]) => pushSseEventMock(...a),
  getProspectByIgsid: (...a: unknown[]) => getProspectByIgsidMock(...a),
}))

const getPatientMock = vi.fn()
vi.mock('@/db/queries/patients', () => ({
  getPatient: (...a: unknown[]) => getPatientMock(...a),
}))

const updateProspectMock = vi.fn()
vi.mock('@/db/queries/prospects', () => ({
  updateProspect: (...a: unknown[]) => updateProspectMock(...a),
}))

const sendTextMessageMock = vi.fn()
const sendMediaMessageMock = vi.fn()
vi.mock('@/lib/instagram', () => ({
  sendTextMessage: (...a: unknown[]) => sendTextMessageMock(...a),
  sendMediaMessage: (...a: unknown[]) => sendMediaMessageMock(...a),
}))

// drizzle-orm helpers — we only need stubs for usage in the route module's
// import surface. The route uses `and`/`eq` against the instagramConversations
// table for db.update(...). Both are passed straight through to the mocked
// db builder, which doesn't actually evaluate them.
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _kind: 'and', args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _kind: 'eq', a, b })),
}))

vi.mock('@/db/schema', () => ({
  instagramConversations: {
    id: 'id',
    tenantId: 'tenant_id',
    lastMessageAt: 'last_message_at',
    updatedAt: 'updated_at',
  },
}))

const dbUpdateSetWhere = vi.fn().mockResolvedValue(undefined)
vi.mock('@/db/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: dbUpdateSetWhere,
      })),
    })),
  },
}))

import { computeWindowTag } from '../[id]/messages/route'

const TENANT_ID = 'tenant-1'
const CONVERSATION_ID = 'conv-1'
const IGSID = 'igsid-99'

const VALID_SETTINGS = {
  instagram_enabled: true,
  instagram_allowed_roles: ['owner'],
}

function mockOwnerAuth() {
  getAuthContextMock.mockResolvedValue({
    userId: 'user-1',
    tenantId: TENANT_ID,
    role: 'owner',
    email: 'a@b.c',
    fullName: 'A',
    isPlatformAdmin: false,
  })
  getTenantMock.mockResolvedValue({ id: TENANT_ID, settings: VALID_SETTINGS })
}

function mockBaseConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    igsid: IGSID,
    igHandle: 'someone',
    igProfileName: 'Someone',
    lastInboundAt: null,
    lastMessageAt: new Date('2026-05-01T00:00:00Z'),
    prospectId: null,
    patientId: null,
    unreadCount: 0,
    status: 'active',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbUpdateSetWhere.mockResolvedValue(undefined)
  pushSseEventMock.mockResolvedValue(undefined)
  createMessageMock.mockImplementation(async (input) => ({
    id: 'msg-1',
    ...input,
  }))
  sendTextMessageMock.mockResolvedValue({ metaMessageId: 'mid_abc' })
  sendMediaMessageMock.mockResolvedValue({ metaMessageId: 'mid_xyz' })
})

afterEach(() => {
  vi.useRealTimers()
})

// ───────────────────────────────────────────────────────────────────
// computeWindowTag — pure window math
// ───────────────────────────────────────────────────────────────────

describe('computeWindowTag', () => {
  const NOW = new Date('2026-05-27T12:00:00Z').getTime()

  it('returns tag=null with no prior inbound', () => {
    expect(computeWindowTag(null, NOW)).toEqual({
      outsideWindow: false,
      tag: null,
    })
  })

  it('returns tag=null at exactly 0h since last inbound', () => {
    const lastInbound = new Date(NOW)
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: null,
    })
  })

  it('returns tag=null at 23h59m since last inbound (inside 24h window)', () => {
    const lastInbound = new Date(NOW - (24 * 3_600_000 - 60_000))
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: null,
    })
  })

  it('returns tag=null at exactly 24h since last inbound (boundary inclusive)', () => {
    const lastInbound = new Date(NOW - 24 * 3_600_000)
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: null,
    })
  })

  it('returns HUMAN_AGENT at 24h+1s since last inbound', () => {
    const lastInbound = new Date(NOW - (24 * 3_600_000 + 1_000))
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: 'HUMAN_AGENT',
    })
  })

  it('returns HUMAN_AGENT at 26h since last inbound', () => {
    const lastInbound = new Date(NOW - 26 * 3_600_000)
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: 'HUMAN_AGENT',
    })
  })

  it('returns HUMAN_AGENT at exactly 168h since last inbound (boundary inclusive)', () => {
    const lastInbound = new Date(NOW - 168 * 3_600_000)
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: false,
      tag: 'HUMAN_AGENT',
    })
  })

  it('returns outsideWindow=true at 168h+1s since last inbound', () => {
    const lastInbound = new Date(NOW - (168 * 3_600_000 + 1_000))
    expect(computeWindowTag(lastInbound, NOW)).toEqual({
      outsideWindow: true,
      tag: null,
    })
  })
})

// ───────────────────────────────────────────────────────────────────
// POST /api/instagram/conversations/[id]/messages — window-driven send
// ───────────────────────────────────────────────────────────────────

async function importMessagesPost(): Promise<(req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>> {
  const mod = await import('../[id]/messages/route')
  return mod.POST as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/instagram/conversations/x/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST messages — window tag application', () => {
  it('leaves messageTag null when sending 4h after last inbound (inside 24h)', async () => {
    const now = new Date('2026-05-27T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(
      mockBaseConversation({
        lastInboundAt: new Date(now.getTime() - 4 * 3_600_000),
      }),
    )

    const POST = await importMessagesPost()
    const res = await POST(
      makeRequest({ type: 'text', body: 'oi' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(201)
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1)
    expect(sendTextMessageMock.mock.calls[0]?.[3]).toEqual({ tag: undefined })
    expect(createMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock.mock.calls[0]?.[0]).toMatchObject({
      messageTag: null,
      direction: 'outbound',
      deliveryStatus: 'sent',
    })
  })

  it('sets messageTag=HUMAN_AGENT when sending 26h after last inbound', async () => {
    const now = new Date('2026-05-27T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(
      mockBaseConversation({
        lastInboundAt: new Date(now.getTime() - 26 * 3_600_000),
      }),
    )

    const POST = await importMessagesPost()
    const res = await POST(
      makeRequest({ type: 'text', body: 'follow up' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(201)
    expect(sendTextMessageMock.mock.calls[0]?.[3]).toEqual({ tag: 'HUMAN_AGENT' })
    expect(createMessageMock.mock.calls[0]?.[0]).toMatchObject({
      messageTag: 'HUMAN_AGENT',
    })
  })

  it('returns 422 outside_messaging_window past 168h and inserts no message row', async () => {
    const now = new Date('2026-05-27T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(
      mockBaseConversation({
        lastInboundAt: new Date(now.getTime() - (168 * 3_600_000 + 60_000)),
      }),
    )

    const POST = await importMessagesPost()
    const res = await POST(
      makeRequest({ type: 'text', body: 'late reply' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('outside_messaging_window')
    expect(sendTextMessageMock).not.toHaveBeenCalled()
    expect(sendMediaMessageMock).not.toHaveBeenCalled()
    expect(createMessageMock).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────
// Auth gate — access denied when instagram_enabled is false
// ───────────────────────────────────────────────────────────────────

describe('access control', () => {
  it('returns 403 when instagram_enabled is false', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'u',
      tenantId: TENANT_ID,
      role: 'owner',
      email: 'a@b.c',
      fullName: 'A',
      isPlatformAdmin: false,
    })
    getTenantMock.mockResolvedValue({
      id: TENANT_ID,
      settings: { ...VALID_SETTINGS, instagram_enabled: false },
    })

    const POST = await importMessagesPost()
    const res = await POST(
      makeRequest({ type: 'text', body: 'hello' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(403)
    expect(getConversationByIdMock).not.toHaveBeenCalled()
    expect(sendTextMessageMock).not.toHaveBeenCalled()
  })

  it('returns 403 when user role is not in instagram_allowed_roles', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'u',
      tenantId: TENANT_ID,
      role: 'receptionist',
      email: 'a@b.c',
      fullName: 'A',
      isPlatformAdmin: false,
    })
    getTenantMock.mockResolvedValue({
      id: TENANT_ID,
      settings: { instagram_enabled: true, instagram_allowed_roles: ['owner'] },
    })

    const POST = await importMessagesPost()
    const res = await POST(
      makeRequest({ type: 'text', body: 'hello' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(403)
  })
})

// ───────────────────────────────────────────────────────────────────
// PATCH link_patient — cross-tenant rejection
// ───────────────────────────────────────────────────────────────────

describe('PATCH link_patient', () => {
  async function importPatch(): Promise<(req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>> {
    const mod = await import('../[id]/route')
    return mod.PATCH as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  }

  function makePatchRequest(body: unknown): Request {
    return new Request('http://test.local/api/instagram/conversations/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects link_patient with 404 when patient belongs to another tenant', async () => {
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(mockBaseConversation())
    // getPatient is tenant-scoped; a foreign patient returns null.
    getPatientMock.mockResolvedValue(null)

    const PATCH = await importPatch()
    const res = await PATCH(
      makePatchRequest({ action: 'link_patient', patientId: '11111111-1111-4111-8111-111111111111' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(404)
    expect(linkPatientMock).not.toHaveBeenCalled()
  })

  it('links a patient that belongs to the same tenant', async () => {
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(mockBaseConversation())
    getPatientMock.mockResolvedValue({ id: 'p-1', tenantId: TENANT_ID, fullName: 'P' })
    linkPatientMock.mockResolvedValue(undefined)

    const PATCH = await importPatch()
    const res = await PATCH(
      makePatchRequest({ action: 'link_patient', patientId: '11111111-1111-4111-8111-111111111111' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(200)
    expect(linkPatientMock).toHaveBeenCalledWith(
      TENANT_ID,
      CONVERSATION_ID,
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('mark_read calls markConversationRead', async () => {
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(mockBaseConversation())
    markConversationReadMock.mockResolvedValue(undefined)

    const PATCH = await importPatch()
    const res = await PATCH(
      makePatchRequest({ action: 'mark_read' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(200)
    expect(markConversationReadMock).toHaveBeenCalledWith(TENANT_ID, CONVERSATION_ID)
  })

  it('unlink_patient calls unlinkPatient', async () => {
    mockOwnerAuth()
    getConversationByIdMock.mockResolvedValue(mockBaseConversation())
    unlinkPatientMock.mockResolvedValue(undefined)

    const PATCH = await importPatch()
    const res = await PATCH(
      makePatchRequest({ action: 'unlink_patient' }),
      paramsFor(CONVERSATION_ID),
    )

    expect(res.status).toBe(200)
    expect(unlinkPatientMock).toHaveBeenCalledWith(TENANT_ID, CONVERSATION_ID)
  })
})

// ───────────────────────────────────────────────────────────────────
// POST /api/instagram/conversations — start outbound
// ───────────────────────────────────────────────────────────────────

describe('POST /api/instagram/conversations (start)', () => {
  async function importStart(): Promise<(req: Request) => Promise<Response>> {
    const mod = await import('../route')
    return mod.POST as (req: Request) => Promise<Response>
  }

  function makeStartRequest(body: unknown): Request {
    return new Request('http://test.local/api/instagram/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 422 unknown_igsid when no conversation exists for the IGSID', async () => {
    mockOwnerAuth()
    getConversationByIgsidMock.mockResolvedValue(null)

    const POST = await importStart()
    const res = await POST(
      makeStartRequest({ igsid: 'unknown-igsid', body: 'hello' }),
    )

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('unknown_igsid')
    expect(sendTextMessageMock).not.toHaveBeenCalled()
  })

  it('sends to an existing IGSID and inserts an outbound message', async () => {
    mockOwnerAuth()
    getConversationByIgsidMock.mockResolvedValue(
      mockBaseConversation({ lastInboundAt: new Date() }),
    )

    const POST = await importStart()
    const res = await POST(
      makeStartRequest({ igsid: IGSID, body: 'hi from clinic' }),
    )

    expect(res.status).toBe(201)
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        body: 'hi from clinic',
        deliveryStatus: 'sent',
      }),
    )
  })
})
