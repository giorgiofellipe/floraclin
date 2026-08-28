import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/meta-connections', () => ({
  getMetaConnectionRaw: vi.fn(),
  upsertMetaConnection: vi.fn(),
  updateMetaConnectionSettings: vi.fn(),
  deleteMetaConnection: vi.fn(),
  recordAcknowledgement: vi.fn(),
  markConnectionVerified: vi.fn(),
}))

vi.mock('@/db/queries/meta-events', () => ({
  listRecentEvents: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: vi.fn(),
}))

vi.mock('@/lib/meta/oauth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/oauth')>('@/lib/meta/oauth')
  return {
    ...actual,
    verifyOAuthState: vi.fn(),
    exchangeCodeForLongLivedToken: vi.fn(),
    signOAuthState: vi.fn(),
    buildAuthUrl: vi.fn(),
  }
})

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: vi.fn(),
}))

import { getAuthContext, requireRole } from '@/lib/auth'
import { ForbiddenError } from '@/lib/errors'
import {
  getMetaConnectionRaw,
  upsertMetaConnection,
  updateMetaConnectionSettings,
  deleteMetaConnection,
  recordAcknowledgement,
  markConnectionVerified,
  type MetaConnection,
} from '@/db/queries/meta-connections'
import { listRecentEvents } from '@/db/queries/meta-events'
import { createAuditLog } from '@/lib/audit'
import { postEvents } from '@/lib/meta/capi-client'
import {
  verifyOAuthState,
  exchangeCodeForLongLivedToken,
  signOAuthState,
  buildAuthUrl,
} from '@/lib/meta/oauth'
import { reportSideEffectFailure } from '@/lib/observability'
import { ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'
import { GET, PUT, DELETE } from '../connection/route'
import { POST as testConnection } from '../connection/test/route'
import { GET as callback } from '../auth/callback/route'
import { GET as connect } from '../auth/connect/route'
import { POST as listDatasets } from '../datasets/route'

function connection(overrides: Partial<MetaConnection> = {}): MetaConnection {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    datasetId: 'dataset-1',
    accessToken: 'secret-token',
    businessId: null,
    connectionType: 'manual',
    tokenExpiresAt: null,
    testEventCode: null,
    advancedMatchingEnabled: true,
    status: 'active',
    acknowledgedAt: null,
    acknowledgementVersion: null,
    acknowledgedBy: null,
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MetaConnection
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
    email: 'owner@clinica.com',
    fullName: 'Dona Clínica',
    isPlatformAdmin: false,
  })
  vi.mocked(requireRole).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
    email: 'owner@clinica.com',
    fullName: 'Dona Clínica',
    isPlatformAdmin: false,
  })
  vi.mocked(listRecentEvents).mockResolvedValue([])
})

describe('GET /api/integrations/meta/connection', () => {
  it('rejects a non-owner with 403 and reads nothing', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await GET(new Request('http://localhost/api/integrations/meta/connection'))

    expect(res.status).toBe(403)
    expect(getMetaConnectionRaw).not.toHaveBeenCalled()
    expect(listRecentEvents).not.toHaveBeenCalled()
  })

  it('requires the owner role rather than bare authentication', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection())

    await GET(new Request('http://localhost/api/integrations/meta/connection'))

    expect(requireRole).toHaveBeenCalledWith('owner')
    expect(getAuthContext).not.toHaveBeenCalled()
  })

  it('never returns accessToken', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection())

    const res = await GET(new Request('http://localhost/api/integrations/meta/connection'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).not.toHaveProperty('accessToken')
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('renders a disabled or invalid connection instead of hiding it', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection({ status: 'invalid_token' }))

    const res = await GET(new Request('http://localhost/api/integrations/meta/connection'))
    const body = await res.json()

    expect(body.data.status).toBe('invalid_token')
  })

  it('includes the last events for the diagnostics panel', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection())
    vi.mocked(listRecentEvents).mockResolvedValue([
      {
        id: 'evt-1',
        prospectId: null,
        eventName: 'Lead',
        eventId: 'lead-1',
        status: 'sent',
        skipReason: null,
        attempts: 1,
        lastError: null,
        fbTraceId: 'trace-1',
        sentAt: new Date(),
        createdAt: new Date(),
      },
    ])

    const res = await GET(new Request('http://localhost/api/integrations/meta/connection'))
    const body = await res.json()

    expect(body.events).toHaveLength(1)
    expect(listRecentEvents).toHaveBeenCalledWith('tenant-1', 20)
  })
})

describe('PUT /api/integrations/meta/connection', () => {
  const validBody = {
    datasetId: 'dataset-1',
    accessToken: 'token-abc',
    acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
  }

  it('rejects a non-owner with 403', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify(validBody),
      }),
    )

    expect(res.status).toBe(403)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
  })

  it('returns 400 and writes no connection when acknowledgementVersion is missing', async () => {
    const { acknowledgementVersion: _ack, ...bodyWithoutAck } = validBody

    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify(bodyWithoutAck),
      }),
    )

    expect(res.status).toBe(400)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
    expect(recordAcknowledgement).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 when acknowledgementVersion is not the server constant', async () => {
    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify({ ...validBody, acknowledgementVersion: 'i-agree-to-nothing' }),
      }),
    )

    expect(res.status).toBe(400)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
    expect(recordAcknowledgement).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('returns 400 for an over-long datasetId instead of failing at insert time', async () => {
    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify({ ...validBody, datasetId: 'd'.repeat(65) }),
      }),
    )

    expect(res.status).toBe(400)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
  })

  it('returns 400 for an over-long testEventCode', async () => {
    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify({ ...validBody, testEventCode: 't'.repeat(33) }),
      }),
    )

    expect(res.status).toBe(400)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed body instead of a 500', async () => {
    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: 'not json',
      }),
    )

    expect(res.status).toBe(400)
    expect(upsertMetaConnection).not.toHaveBeenCalled()
  })

  it('audits the server constant, never a client-supplied string', async () => {
    vi.mocked(upsertMetaConnection).mockResolvedValue(connection())

    await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify(validBody),
      }),
    )

    expect(recordAcknowledgement).toHaveBeenCalledWith('tenant-1', 'user-1', ACKNOWLEDGEMENT_VERSION)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { acknowledgementVersion: { old: null, new: ACKNOWLEDGEMENT_VERSION } },
      }),
    )
  })

  it('writes an audit_logs row containing the accepted version on success', async () => {
    vi.mocked(upsertMetaConnection).mockResolvedValue(connection())

    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify(validBody),
      }),
    )

    expect(res.status).toBe(200)
    expect(upsertMetaConnection).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ datasetId: 'dataset-1', accessToken: 'token-abc', connectionType: 'manual' }),
    )
    expect(recordAcknowledgement).toHaveBeenCalledWith('tenant-1', 'user-1', '2026-08-v1')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'consent_accepted',
        entityType: 'meta_connection',
        changes: { acknowledgementVersion: { old: null, new: '2026-08-v1' } },
      }),
    )
  })

  it('never returns accessToken in the response body', async () => {
    vi.mocked(upsertMetaConnection).mockResolvedValue(connection())

    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify(validBody),
      }),
    )
    const body = await res.json()

    expect(body.data).not.toHaveProperty('accessToken')
  })

  describe('partial update without an accessToken', () => {
    const partialBody = {
      datasetId: 'dataset-1',
      advancedMatchingEnabled: false,
      acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
    }

    it('keeps the stored token and the connection type', async () => {
      vi.mocked(updateMetaConnectionSettings).mockResolvedValue(
        connection({ connectionType: 'oauth', advancedMatchingEnabled: false }),
      )

      const res = await PUT(
        new Request('http://localhost/api/integrations/meta/connection', {
          method: 'PUT',
          body: JSON.stringify(partialBody),
        }),
      )
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(upsertMetaConnection).not.toHaveBeenCalled()
      expect(updateMetaConnectionSettings).toHaveBeenCalledWith('tenant-1', {
        advancedMatchingEnabled: false,
        testEventCode: undefined,
      })
      expect(body.data.connectionType).toBe('oauth')
      expect(body.data).not.toHaveProperty('accessToken')
    })

    it('still records the acknowledgement', async () => {
      vi.mocked(updateMetaConnectionSettings).mockResolvedValue(connection({ connectionType: 'oauth' }))

      await PUT(
        new Request('http://localhost/api/integrations/meta/connection', {
          method: 'PUT',
          body: JSON.stringify(partialBody),
        }),
      )

      expect(recordAcknowledgement).toHaveBeenCalledWith('tenant-1', 'user-1', ACKNOWLEDGEMENT_VERSION)
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'consent_accepted', entityType: 'meta_connection' }),
      )
    })

    it('returns 400 for a forged acknowledgementVersion and writes nothing', async () => {
      const res = await PUT(
        new Request('http://localhost/api/integrations/meta/connection', {
          method: 'PUT',
          body: JSON.stringify({ ...partialBody, acknowledgementVersion: 'i-agree-to-nothing' }),
        }),
      )

      expect(res.status).toBe(400)
      expect(updateMetaConnectionSettings).not.toHaveBeenCalled()
      expect(upsertMetaConnection).not.toHaveBeenCalled()
      expect(recordAcknowledgement).not.toHaveBeenCalled()
      expect(createAuditLog).not.toHaveBeenCalled()
    })

    it('returns 404 when there is no connection to update', async () => {
      vi.mocked(updateMetaConnectionSettings).mockResolvedValue(null)

      const res = await PUT(
        new Request('http://localhost/api/integrations/meta/connection', {
          method: 'PUT',
          body: JSON.stringify(partialBody),
        }),
      )

      expect(res.status).toBe(404)
      expect(recordAcknowledgement).not.toHaveBeenCalled()
      expect(createAuditLog).not.toHaveBeenCalled()
    })
  })

  it('sets connectionType to manual when a token is pasted', async () => {
    vi.mocked(upsertMetaConnection).mockResolvedValue(connection())

    const res = await PUT(
      new Request('http://localhost/api/integrations/meta/connection', {
        method: 'PUT',
        body: JSON.stringify({ ...validBody, advancedMatchingEnabled: false }),
      }),
    )

    expect(res.status).toBe(200)
    expect(updateMetaConnectionSettings).not.toHaveBeenCalled()
    expect(upsertMetaConnection).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ accessToken: 'token-abc', connectionType: 'manual' }),
    )
  })
})

describe('DELETE /api/integrations/meta/connection', () => {
  it('rejects a non-owner with 403', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await DELETE(new Request('http://localhost/api/integrations/meta/connection', { method: 'DELETE' }))

    expect(res.status).toBe(403)
    expect(deleteMetaConnection).not.toHaveBeenCalled()
  })

  it('scopes the delete to the tenant on the auth context, not to a request value', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      tenantId: 'tenant-2',
      userId: 'user-2',
      role: 'owner',
      email: 'owner@outra.com',
      fullName: 'Outra Clínica',
      isPlatformAdmin: false,
    })

    const res = await DELETE(
      new Request('http://localhost/api/integrations/meta/connection?tenantId=tenant-1', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(200)
    expect(deleteMetaConnection).toHaveBeenCalledTimes(1)
    // Exactly one argument: a second, wider call signature would mean the
    // delete no longer narrows to a single tenant.
    expect(deleteMetaConnection).toHaveBeenCalledWith('tenant-2')
    expect(vi.mocked(deleteMetaConnection).mock.calls[0]).toHaveLength(1)
  })
})

describe('POST /api/integrations/meta/connection/test', () => {
  it('rejects a non-owner with 403 before firing a Conversions API call', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await testConnection(
      new Request('http://localhost/api/integrations/meta/connection/test', { method: 'POST' }),
    )

    expect(res.status).toBe(403)
    expect(getMetaConnectionRaw).not.toHaveBeenCalled()
    expect(postEvents).not.toHaveBeenCalled()
    expect(markConnectionVerified).not.toHaveBeenCalled()
  })

  it('requires the owner role rather than bare authentication', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection({ testEventCode: 'TEST12345' }))
    vi.mocked(postEvents).mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-abc' })

    await testConnection(
      new Request('http://localhost/api/integrations/meta/connection/test', { method: 'POST' }),
    )

    expect(requireRole).toHaveBeenCalledWith('owner')
    expect(getAuthContext).not.toHaveBeenCalled()
  })

  it('reports Meta error message verbatim on failure', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection({ testEventCode: 'TEST12345' }))
    vi.mocked(postEvents).mockResolvedValue({
      ok: false,
      kind: 'invalid',
      message: 'Param account_id must be a valid dataset id.',
      fbTraceId: 'trace-xyz',
    })

    const res = await testConnection(
      new Request('http://localhost/api/integrations/meta/connection/test', { method: 'POST' }),
    )
    const body = await res.json()

    expect(body.message).toBe('Param account_id must be a valid dataset id.')
    expect(markConnectionVerified).not.toHaveBeenCalled()
  })

  it('marks the connection verified on success', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection({ testEventCode: 'TEST12345' }))
    vi.mocked(postEvents).mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-abc' })

    const res = await testConnection(
      new Request('http://localhost/api/integrations/meta/connection/test', { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    expect(markConnectionVerified).toHaveBeenCalledWith('tenant-1')
  })
})

describe('GET /api/integrations/meta/auth/callback', () => {
  it('redirects with meta=denied when the user cancels', async () => {
    const res = await callback(
      new Request('http://localhost/api/integrations/meta/auth/callback?error=access_denied'),
    )

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('meta=denied')
    expect(exchangeCodeForLongLivedToken).not.toHaveBeenCalled()
  })

  it('redirects with meta=error when the state is invalid', async () => {
    vi.mocked(verifyOAuthState).mockReturnValue(null)

    const res = await callback(
      new Request('http://localhost/api/integrations/meta/auth/callback?code=abc&state=bad'),
    )

    expect(res.headers.get('location')).toContain('meta=error')
  })

  it('redirects with meta=connected and records the acknowledgement on success', async () => {
    vi.mocked(verifyOAuthState).mockReturnValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      acknowledgementVersion: '2026-08-v1',
      datasetId: 'dataset-1',
    })
    vi.mocked(exchangeCodeForLongLivedToken).mockResolvedValue({ accessToken: 'long-lived-token', expiresAt: null })
    vi.mocked(upsertMetaConnection).mockResolvedValue(connection({ connectionType: 'oauth' }))

    const res = await callback(
      new Request('http://localhost/api/integrations/meta/auth/callback?code=abc&state=good'),
    )

    expect(res.headers.get('location')).toContain('meta=connected')
    expect(upsertMetaConnection).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ datasetId: 'dataset-1', accessToken: 'long-lived-token', connectionType: 'oauth' }),
    )
    expect(recordAcknowledgement).toHaveBeenCalledWith('tenant-1', 'user-1', '2026-08-v1')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_accepted', entityType: 'meta_connection' }),
    )
  })

  it('redirects with meta=error and reports the failure when the token exchange throws', async () => {
    vi.mocked(verifyOAuthState).mockReturnValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      acknowledgementVersion: '2026-08-v1',
      datasetId: 'dataset-1',
    })
    vi.mocked(exchangeCodeForLongLivedToken).mockRejectedValue(new Error('invalid_grant'))

    const res = await callback(
      new Request('http://localhost/api/integrations/meta/auth/callback?code=abc&state=good'),
    )

    expect(res.headers.get('location')).toContain('meta=error')
    expect(reportSideEffectFailure).toHaveBeenCalled()
    expect(upsertMetaConnection).not.toHaveBeenCalled()
  })
})

describe('POST /api/integrations/meta/datasets', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  function datasetsRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/integrations/meta/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('sends the token in an Authorization header, never in the graph url', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: [{ id: '111', name: 'Pixel' }] }), { status: 200 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await listDatasets(datasetsRequest({ businessId: 'biz-1', accessToken: 'token-abc' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ id: '111', name: 'Pixel' }])

    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(calledUrl).not.toContain('token-abc')
    expect(calledUrl).not.toContain('access_token')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-abc')
  })

  it('falls back to the stored connection token when the body has none', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection())
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await listDatasets(datasetsRequest({ businessId: 'biz-1' }))

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
  })

  it('rejects a non-owner with 403 before calling Meta', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await listDatasets(datasetsRequest({ businessId: 'biz-1', accessToken: 'token-abc' }))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when businessId is missing', async () => {
    const res = await listDatasets(datasetsRequest({}))

    expect(res.status).toBe(400)
  })

  it('bounds the graph call with an abort signal so a hung socket cannot hang the page', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await listDatasets(datasetsRequest({ businessId: 'biz-1', accessToken: 'token-abc' }))

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal!.aborted).toBe(false)
  })
})

describe('GET /api/integrations/meta/auth/connect', () => {
  beforeEach(() => {
    vi.mocked(signOAuthState).mockReturnValue('signed-state')
    vi.mocked(buildAuthUrl).mockReturnValue('https://www.facebook.com/dialog/oauth?state=signed-state')
  })

  function connectRequest(query: string) {
    return new Request(`http://localhost/api/integrations/meta/auth/connect?${query}`)
  }

  it('rejects a non-owner with 403 without signing a state', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await connect(
      connectRequest(`acknowledgementVersion=${ACKNOWLEDGEMENT_VERSION}&datasetId=dataset-1`),
    )

    expect(res.status).toBe(403)
    expect(signOAuthState).not.toHaveBeenCalled()
  })

  it('returns 400 when acknowledgementVersion is not the server constant', async () => {
    const res = await connect(
      connectRequest('acknowledgementVersion=i-agree-to-nothing&datasetId=dataset-1'),
    )

    expect(res.status).toBe(400)
    expect(signOAuthState).not.toHaveBeenCalled()
  })

  it('returns 400 when acknowledgementVersion is absent', async () => {
    const res = await connect(connectRequest('datasetId=dataset-1'))

    expect(res.status).toBe(400)
    expect(signOAuthState).not.toHaveBeenCalled()
  })

  it('returns 400 for an over-long datasetId', async () => {
    const res = await connect(
      connectRequest(
        `acknowledgementVersion=${ACKNOWLEDGEMENT_VERSION}&datasetId=${'d'.repeat(65)}`,
      ),
    )

    expect(res.status).toBe(400)
    expect(signOAuthState).not.toHaveBeenCalled()
  })

  it('signs the server constant and redirects to the Meta dialog', async () => {
    const res = await connect(
      connectRequest(`acknowledgementVersion=${ACKNOWLEDGEMENT_VERSION}&datasetId=dataset-1`),
    )

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('www.facebook.com')
    expect(signOAuthState).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      datasetId: 'dataset-1',
    })
  })

  it('falls back to the stored datasetId when the query has none', async () => {
    vi.mocked(getMetaConnectionRaw).mockResolvedValue(connection({ datasetId: 'stored-dataset' }))

    await connect(connectRequest(`acknowledgementVersion=${ACKNOWLEDGEMENT_VERSION}`))

    expect(signOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'stored-dataset' }),
    )
  })
})
