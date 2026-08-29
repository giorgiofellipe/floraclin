import { createHash, createHmac } from 'crypto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

import { scrubUrl } from '@/lib/observability'

import {
  buildAuthUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForLongLivedToken,
  createOAuthCsrfToken,
  csrfTokenMatchesHash,
  readOAuthCsrfCookie,
  setOAuthCsrfCookie,
  clearOAuthCsrfCookie,
  OAUTH_CSRF_COOKIE,
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
      csrfHash: createHash('sha256').update('a-csrf-token').digest('hex'),
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

    it('rejects a correctly signed state that carries no csrfHash', () => {
      const { csrfHash: _csrfHash, ...unbound } = payload
      const signed = { ...unbound, issuedAt: Date.now() }
      const encoded = Buffer.from(JSON.stringify(signed)).toString('base64url')
      const signature = createHmac('sha256', ENV.META_APP_SECRET).update(encoded).digest('base64url')

      expect(verifyOAuthState(`${encoded}.${signature}`)).toBeNull()
    })
  })

  describe('csrf binding between the state and the browser cookie', () => {
    function statePayload(csrfHash: string): MetaOAuthStatePayload {
      return {
        userId: 'user-1',
        tenantId: 'tenant-1',
        acknowledgementVersion: '2026-08-v1',
        csrfHash,
      }
    }

    it('round-trips a state signed with a token whose cookie is present', () => {
      const { token, hash } = createOAuthCsrfToken()
      const state = signOAuthState(statePayload(hash))

      const result = verifyOAuthState(state)

      expect(result).not.toBeNull()
      expect(csrfTokenMatchesHash(token, result!.csrfHash)).toBe(true)
    })

    it('never puts the token itself in the state, only its digest', () => {
      const { token, hash } = createOAuthCsrfToken()
      const state = signOAuthState(statePayload(hash))

      expect(state).not.toContain(token)
      expect(Buffer.from(state.split('.')[0], 'base64url').toString('utf-8')).not.toContain(token)
    })

    it('rejects a valid, correctly signed state when no cookie came with the request', () => {
      const { hash } = createOAuthCsrfToken()
      const state = signOAuthState(statePayload(hash))
      const payload = verifyOAuthState(state)

      const request = new Request('http://localhost/api/integrations/meta/auth/callback')

      expect(payload).not.toBeNull()
      expect(readOAuthCsrfCookie(request)).toBeNull()
    })

    // The attack: whoever captured the redirect holds the state, never the
    // cookie of the browser that started the flow.
    it('rejects a valid state presented with a different browser cookie', () => {
      const { hash } = createOAuthCsrfToken()
      const attacker = createOAuthCsrfToken()
      const state = signOAuthState(statePayload(hash))

      const payload = verifyOAuthState(state)

      expect(payload).not.toBeNull()
      expect(csrfTokenMatchesHash(attacker.token, payload!.csrfHash)).toBe(false)
    })

    it('does not throw on a hash of a different length', () => {
      expect(csrfTokenMatchesHash('some-token', 'short')).toBe(false)
      expect(csrfTokenMatchesHash('some-token', '')).toBe(false)
    })

    it('issues a distinct token per authorization', () => {
      const first = createOAuthCsrfToken()
      const second = createOAuthCsrfToken()

      expect(first.token).not.toBe(second.token)
      expect(first.hash).not.toBe(second.hash)
      expect(first.hash).toBe(createHash('sha256').update(first.token).digest('hex'))
    })

    describe('readOAuthCsrfCookie', () => {
      function requestWithCookie(header: string): Request {
        return new Request('http://localhost/api/integrations/meta/auth/callback', {
          headers: { cookie: header },
        })
      }

      it('reads the token out of a header holding several cookies', () => {
        const value = readOAuthCsrfCookie(
          requestWithCookie(`sb-access-token=abc; ${OAUTH_CSRF_COOKIE}=the-token; tenant_id=t-1`),
        )

        expect(value).toBe('the-token')
      })

      it('returns null for an empty value and for an unrelated cookie', () => {
        expect(readOAuthCsrfCookie(requestWithCookie(`${OAUTH_CSRF_COOKIE}=`))).toBeNull()
        expect(readOAuthCsrfCookie(requestWithCookie('other=value'))).toBeNull()
      })

      // A cookie whose name merely ends in the same suffix must not answer.
      it('matches the cookie name exactly', () => {
        expect(readOAuthCsrfCookie(requestWithCookie(`not_${OAUTH_CSRF_COOKIE}=nope`))).toBeNull()
      })
    })

    describe('cookie attributes', () => {
      function setCookieHeader(mutate: (response: NextResponse) => void): string {
        const response = NextResponse.redirect('http://localhost/configuracoes')
        mutate(response)
        return response.headers.get('set-cookie') ?? ''
      }

      it('sets an httpOnly, lax, path-scoped cookie that expires with the state', () => {
        const header = setCookieHeader((res) => setOAuthCsrfCookie(res, 'the-token'))

        expect(header).toContain(`${OAUTH_CSRF_COOKIE}=the-token`)
        expect(header).toContain('HttpOnly')
        expect(header).toContain('SameSite=lax')
        expect(header).toContain('Path=/api/integrations/meta')
        expect(header).toContain('Max-Age=600')
      })

      it('clears the cookie with the same path so the browser drops it', () => {
        const header = setCookieHeader(clearOAuthCsrfCookie)

        expect(header).toContain(`${OAUTH_CSRF_COOKIE}=;`)
        expect(header).toContain('Path=/api/integrations/meta')
        expect(header).toContain('Max-Age=0')
      })
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
    function params(init: RequestInit): URLSearchParams {
      return new URLSearchParams(init.body as string)
    }

    function isLongLivedLeg(init: RequestInit): boolean {
      return params(init).get('grant_type') === 'fb_exchange_token'
    }

    it('exchanges the code for a short-lived token, then a long-lived token', async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        if (isLongLivedLeg(init)) {
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

      // The second leg trades exactly the token the first leg returned.
      expect(params(fetchMock.mock.calls[0][1]).get('code')).toBe('auth-code')
      expect(params(fetchMock.mock.calls[1][1]).get('fb_exchange_token')).toBe('short-lived-token')
    })

    it('returns a null expiresAt when the long-lived response has no expires_in', async () => {
      global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        if (isLongLivedLeg(init)) {
          return new Response(JSON.stringify({ access_token: 'long-lived-token' }), { status: 200 })
        }
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      }) as unknown as typeof fetch

      const result = await exchangeCodeForLongLivedToken('auth-code')

      expect(result.expiresAt).toBeNull()
    })

    it('sends the app secret as client_secret in the form body on both exchange calls', async () => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
      )
      global.fetch = fetchMock as unknown as typeof fetch

      await exchangeCodeForLongLivedToken('auth-code')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const [, init] of fetchMock.mock.calls) {
        expect(init.method).toBe('POST')
        expect((init.headers as Record<string, string>)['content-type']).toBe(
          'application/x-www-form-urlencoded',
        )
        expect(params(init).get('client_secret')).toBe(ENV.META_APP_SECRET)
      }
    })

    it('never puts the app secret, the code, or a token in the request url', async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        if (isLongLivedLeg(init)) {
          return new Response(JSON.stringify({ access_token: 'long-lived-token' }), { status: 200 })
        }
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      })
      global.fetch = fetchMock as unknown as typeof fetch

      await exchangeCodeForLongLivedToken('auth-code')

      for (const [calledUrl] of fetchMock.mock.calls) {
        const url = calledUrl as string
        expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`)
        expect(url).not.toContain('?')
        expect(url).not.toContain(ENV.META_APP_SECRET)
        expect(url).not.toContain('auth-code')
        expect(url).not.toContain('short-lived-token')
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
      global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        if (isLongLivedLeg(init)) {
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

    it('labels a long-lived leg failure distinctly from the short-lived one', async () => {
      global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        if (isLongLivedLeg(init)) return new Response('not json', { status: 500 })
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      }) as unknown as typeof fetch

      await expect(exchangeCodeForLongLivedToken('auth-code')).rejects.toThrow(
        'Meta long-lived token exchange failed: HTTP 500',
      )
    })
  })

  // Belt and braces for the exchange above: even if a Meta URL with these
  // parameters reaches Sentry from somewhere else (an SDK fetch breadcrumb, a
  // trace span), the values must not travel with it.
  describe('scrubUrl on Meta token-exchange parameters', () => {
    it('masks client_secret, code, access_token and fb_exchange_token', () => {
      const scrubbed = scrubUrl(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token` +
          '?client_id=app-123&client_secret=super-secret&code=auth-code' +
          '&access_token=short-lived-token&fb_exchange_token=short-lived-token',
      )

      expect(scrubbed).not.toContain('super-secret')
      expect(scrubbed).not.toContain('auth-code')
      expect(scrubbed).not.toContain('short-lived-token')
      expect(scrubbed).toContain('client_id=app-123')
    })
  })
})
