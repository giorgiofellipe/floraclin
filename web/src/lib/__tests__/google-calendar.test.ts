import { describe, it, expect, vi, beforeEach } from 'vitest'

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
