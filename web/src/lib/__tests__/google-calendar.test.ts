import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

// Set env vars before module evaluation
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.CALENDAR_STATE_SECRET = 'test-state-secret'

vi.mock('googleapis', () => {
  const mockOAuth2Instance = {
    generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock'),
    getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600000 } }),
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue({ credentials: { access_token: 'new-at', refresh_token: 'new-rt', expiry_date: Date.now() + 3600000 } }),
    revokeToken: vi.fn().mockResolvedValue(undefined),
  }

  function OAuth2() {
    return mockOAuth2Instance
  }

  return {
    google: {
      auth: { OAuth2 },
      calendar: vi.fn().mockReturnValue({
        events: {
          watch: vi.fn().mockResolvedValue({ data: { resourceId: 'res-123', expiration: String(Date.now() + 86400000) } }),
        },
        channels: {
          stop: vi.fn().mockResolvedValue(undefined),
        },
      }),
    },
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/db/schema', () => ({
  calendarConnections: { id: 'id' },
}))

import {
  signOAuthState,
  verifyOAuthState,
  generateFeedToken,
  buildAuthUrl,
  isGoogleAuthFailure,
  reportCalendarFailure,
} from '../google-calendar'

describe('signOAuthState / verifyOAuthState', () => {
  const payload = { userId: 'user-1', tenantId: 'tenant-1', type: 'practitioner' as const }

  it('should sign and verify a valid state', () => {
    const state = signOAuthState(payload)
    const result = verifyOAuthState(state)
    expect(result).toEqual(payload)
  })

  it('should return null for tampered state', () => {
    const state = signOAuthState(payload)
    const tampered = state.slice(0, -3) + 'xxx'
    expect(verifyOAuthState(tampered)).toBeNull()
  })

  it('should return null for state without dot separator', () => {
    expect(verifyOAuthState('nodothere')).toBeNull()
  })

  it('should return null for invalid JSON in payload', () => {
    expect(verifyOAuthState('not-base64.invalid-sig')).toBeNull()
  })

  it('should handle clinic type', () => {
    const clinicPayload = { userId: 'user-1', tenantId: 'tenant-1', type: 'clinic' as const }
    const state = signOAuthState(clinicPayload)
    const result = verifyOAuthState(state)
    expect(result).toEqual(clinicPayload)
  })
})

describe('generateFeedToken', () => {
  it('should generate a 64-character hex string', () => {
    const token = generateFeedToken()
    expect(token).toHaveLength(64)
    expect(/^[a-f0-9]+$/.test(token)).toBe(true)
  })

  it('should generate unique tokens', () => {
    const token1 = generateFeedToken()
    const token2 = generateFeedToken()
    expect(token1).not.toEqual(token2)
  })
})

describe('buildAuthUrl', () => {
  it('should return a Google OAuth URL', () => {
    const url = buildAuthUrl('test-state')
    expect(url).toContain('accounts.google.com')
  })
})

describe('isGoogleAuthFailure', () => {
  it('recognizes a revoked refresh token', () => {
    expect(isGoogleAuthFailure(new Error('invalid_grant: Token has been expired or revoked.'))).toBe(
      true,
    )
  })

  it.each([401, 403])('recognizes a %i from Google, wherever gaxios put it', status => {
    expect(isGoogleAuthFailure(Object.assign(new Error('Request failed'), { status }))).toBe(true)
    expect(isGoogleAuthFailure(Object.assign(new Error('Request failed'), { code: status }))).toBe(
      true,
    )
    // gaxios sometimes reports the code as a string
    expect(
      isGoogleAuthFailure(Object.assign(new Error('Request failed'), { code: String(status) })),
    ).toBe(true)
    expect(
      isGoogleAuthFailure(Object.assign(new Error('Request failed'), { response: { status } })),
    ).toBe(true)
  })

  it('does not swallow a real failure', () => {
    expect(isGoogleAuthFailure(new Error('socket hang up'))).toBe(false)
    expect(isGoogleAuthFailure(Object.assign(new Error('boom'), { status: 500 }))).toBe(false)
    expect(isGoogleAuthFailure(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))).toBe(false)
    expect(isGoogleAuthFailure('not an error')).toBe(false)
  })
})

describe('reportCalendarFailure', () => {
  beforeEach(() => captureExceptionMock.mockClear())

  it('stays quiet when the clinic simply has to reconnect', () => {
    // This fires on every appointment write while a connection is broken, so
    // reporting it would drown the sync failures that are ours to fix.
    reportCalendarFailure(new Error('invalid_grant'), 'push_appointment', { appointmentId: 'a1' })

    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('reports anything else, tagged for triage', () => {
    const boom = new Error('socket hang up')

    reportCalendarFailure(boom, 'push_appointment', { appointmentId: 'a1' })

    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      tags: { area: 'calendar-sync', step: 'push_appointment' },
      extra: { appointmentId: 'a1' },
    })
  })
})
