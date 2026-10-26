import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The callback trusted the signed state alone. Any owner could start a
 * connect, send the Google link to a practitioner of another clinic, and the
 * victim's approval stored the victim's Google tokens in the attacker's
 * tenant, pulling every event (patient names included) into it. The browser
 * that finishes the flow must be the member the state names.
 */

process.env.CALENDAR_STATE_SECRET = 'test-state-secret'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/google-calendar', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/google-calendar')>()),
  exchangeCodeForTokens: vi.fn(async () => ({ access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600_000 })),
  registerWebhookChannel: vi.fn(async () => ({ channelId: 'ch', resourceId: 'res', expiration: new Date() })),
  reportCalendarFailure: vi.fn(),
}))
vi.mock('@/db/queries/calendar', () => ({
  upsertConnection: vi.fn(async () => ({ id: 'conn-1', calendarId: 'primary' })),
  updateConnection: vi.fn(async () => undefined),
}))
vi.mock('@/lib/google-calendar-pull', () => ({ runInitialSync: vi.fn(async () => undefined) }))

import { getAuthContext } from '@/lib/auth'
import { signOAuthState, reportCalendarFailure } from '@/lib/google-calendar'
import { upsertConnection } from '@/db/queries/calendar'
import { GET } from '../route'

function callback(state: string) {
  return GET(new Request(`http://localhost/api/calendar/auth/callback?code=c&state=${encodeURIComponent(state)}`))
}

const practitionerState = () => signOAuthState({ userId: 'user-a', tenantId: 'tenant-a', type: 'practitioner' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/calendar/auth/callback', () => {
  it('stores the connection for the member who started the flow', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: 'user-a', tenantId: 'tenant-a', role: 'practitioner' } as never)

    const res = await callback(practitionerState())

    expect(res.headers.get('location')).toContain('calendar=connected')
    expect(upsertConnection).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }))
  })

  it.each([
    ['another clinic finishes the flow', { userId: 'user-b', tenantId: 'tenant-b', role: 'practitioner' }],
    ['there is no session', null],
  ])('refuses when %s', async (_label, ctx) => {
    if (ctx) vi.mocked(getAuthContext).mockResolvedValue(ctx as never)
    else vi.mocked(getAuthContext).mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }))

    const res = await callback(practitionerState())

    expect(res.headers.get('location')).toContain('calendar=error')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('refuses a clinic connection when the member is no longer the owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: 'user-a', tenantId: 'tenant-a', role: 'practitioner' } as never)

    const res = await callback(signOAuthState({ userId: 'user-a', tenantId: 'tenant-a', type: 'clinic' }))

    expect(res.headers.get('location')).toContain('calendar=error')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  // Swallowing every auth failure as "no session" hid a broken auth database
  // behind the same generic error a logged-out user gets.
  it('reports a session lookup that fails for another reason', async () => {
    vi.mocked(getAuthContext).mockRejectedValue(new Error('connection terminated'))

    const res = await callback(practitionerState())

    expect(res.headers.get('location')).toContain('calendar=error')
    expect(reportCalendarFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection terminated' }), 'callback')
    expect(upsertConnection).not.toHaveBeenCalled()
  })
})
