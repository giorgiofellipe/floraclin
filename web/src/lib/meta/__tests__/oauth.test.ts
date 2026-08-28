import { createHmac } from 'crypto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  buildAuthUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForLongLivedToken,
  type MetaOAuthStatePayload,
} from '../oauth'
import { META_GRAPH_VERSION } from '../types'

const ENV = {
  META_APP_ID: 'app-123',
  META_APP_SECRET: 'super-secret',
  META_OAUTH_REDIRECT_URI: 'https://floraclin.example/api/integrations/meta/auth/callback',
}

describe('meta/oauth', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.META_APP_ID = ENV.META_APP_ID
    process.env.META_APP_SECRET = ENV.META_APP_SECRET
    process.env.META_OAUTH_REDIRECT_URI = ENV.META_OAUTH_REDIRECT_URI
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  describe('signOAuthState / verifyOAuthState', () => {
    const payload: MetaOAuthStatePayload = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      acknowledgementVersion: '2026-08-v1',
    }

    it('round-trips a fresh signed state back to the original payload', () => {
      const state = signOAuthState(payload)
      const result = verifyOAuthState(state)

      expect(result).toMatchObject(payload)
    })

    it('rejects a state older than the 10 minute window', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-08-28T12:00:00Z'))
        const state = signOAuthState(payload)

        vi.setSystemTime(new Date('2026-08-28T12:09:00Z'))
        expect(verifyOAuthState(state)).toMatchObject(payload)

        vi.setSystemTime(new Date('2026-08-28T12:10:01Z'))
        expect(verifyOAuthState(state)).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects a correctly signed state that carries no issuedAt', () => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const signature = createHmac('sha256', ENV.META_APP_SECRET).update(encoded).digest('base64url')

      expect(verifyOAuthState(`${encoded}.${signature}`)).toBeNull()
    })

    it('rejects a state with a tampered payload segment', () => {
      const state = signOAuthState(payload)
      const [encoded, signature] = state.split('.')

      // Flip one character in the encoded payload without touching the signature.
      const flippedChar = encoded[0] === 'a' ? 'b' : 'a'
      const tamperedEncoded = flippedChar + encoded.slice(1)
      const tamperedState = `${tamperedEncoded}.${signature}`

      expect(verifyOAuthState(tamperedState)).toBeNull()
    })

    it('rejects a state with a tampered signature segment', () => {
      const state = signOAuthState(payload)
      const [encoded, signature] = state.split('.')

      const flippedChar = signature[0] === 'a' ? 'b' : 'a'
      const tamperedSignature = flippedChar + signature.slice(1)
      const tamperedState = `${encoded}.${tamperedSignature}`

      expect(verifyOAuthState(tamperedState)).toBeNull()
    })

    it('rejects a state with no separator instead of throwing', () => {
      expect(() => verifyOAuthState('not-a-valid-state')).not.toThrow()
      expect(verifyOAuthState('not-a-valid-state')).toBeNull()
    })

    it('rejects an empty string state instead of throwing', () => {
      expect(() => verifyOAuthState('')).not.toThrow()
      expect(verifyOAuthState('')).toBeNull()
    })

    it('rejects a state signed under a different app secret', () => {
      const state = signOAuthState(payload)

      process.env.META_APP_SECRET = 'a-different-secret'

      expect(verifyOAuthState(state)).toBeNull()
    })
  })

  describe('buildAuthUrl', () => {
    it('includes the required scopes, app id, redirect uri, state, and pinned graph version', () => {
      const url = new URL(buildAuthUrl('the-state-value'))

      expect(url.origin).toBe('https://www.facebook.com')
      expect(url.pathname).toBe(`/${META_GRAPH_VERSION}/dialog/oauth`)
      expect(url.pathname).not.toContain('v1.0') // not an inline/unpinned version
      expect(url.searchParams.get('client_id')).toBe(ENV.META_APP_ID)
      expect(url.searchParams.get('redirect_uri')).toBe(ENV.META_OAUTH_REDIRECT_URI)
      expect(url.searchParams.get('state')).toBe('the-state-value')
      expect(url.searchParams.get('scope')).toBe('business_management,ads_management')
      expect(url.searchParams.get('response_type')).toBe('code')
    })
  })

  describe('exchangeCodeForLongLivedToken', () => {
    it('exchanges the code for a short-lived token, then a long-lived token', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('fb_exchange_token')) {
          return new Response(
            JSON.stringify({ access_token: 'long-lived-token', expires_in: 5184000 }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const before = Date.now()
      const result = await exchangeCodeForLongLivedToken('auth-code')

      expect(result.accessToken).toBe('long-lived-token')
      expect(result.expiresAt).not.toBeNull()
      expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5184000 * 1000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('returns a null expiresAt when the long-lived response has no expires_in', async () => {
      global.fetch = vi.fn(async (url: string) => {
        if (url.includes('fb_exchange_token')) {
          return new Response(JSON.stringify({ access_token: 'long-lived-token' }), { status: 200 })
        }
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      }) as unknown as typeof fetch

      const result = await exchangeCodeForLongLivedToken('auth-code')

      expect(result.expiresAt).toBeNull()
    })

    it('sends the app secret as client_secret on both exchange calls', async () => {
      const fetchMock = vi.fn(async (_url: string) =>
        new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
      )
      global.fetch = fetchMock as unknown as typeof fetch

      await exchangeCodeForLongLivedToken('auth-code')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const call of fetchMock.mock.calls) {
        const calledUrl = new URL(call[0] as string)
        expect(calledUrl.searchParams.get('client_secret')).toBe(ENV.META_APP_SECRET)
      }
    })

    it('handles a Meta error response on the short-lived exchange without an unhandled rejection', async () => {
      global.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid verification code format.' } }), {
          status: 400,
        }),
      ) as unknown as typeof fetch

      await expect(exchangeCodeForLongLivedToken('bad-code')).rejects.toThrow(
        'Invalid verification code format.',
      )
    })

    it('handles a Meta error response on the long-lived exchange without an unhandled rejection', async () => {
      global.fetch = vi.fn(async (url: string) => {
        if (url.includes('fb_exchange_token')) {
          return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), {
            status: 401,
          })
        }
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      }) as unknown as typeof fetch

      await expect(exchangeCodeForLongLivedToken('auth-code')).rejects.toThrow(
        'Invalid OAuth access token.',
      )
    })

    it('falls back to an HTTP-status message when the error body is unparsable', async () => {
      global.fetch = vi.fn(async () =>
        new Response('not json', { status: 500 }),
      ) as unknown as typeof fetch

      await expect(exchangeCodeForLongLivedToken('auth-code')).rejects.toThrow(
        'Meta token exchange failed: HTTP 500',
      )
    })
  })
})
