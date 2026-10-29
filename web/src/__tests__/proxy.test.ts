// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Middleware had no test at all before this change, which is uncomfortable
 * for the file that decides who gets into the app.
 *
 * The cases below are the ones that would take production down rather than
 * merely misbehave. Two of them are lockouts that nearly shipped:
 *
 *   - A token minted before `emailVerified` existed carries `undefined`. The
 *     session used to coerce that to `false`, which would have redirected
 *     every already-logged-in customer to /confirm-email, forever, with no
 *     email to click because none was ever sent to them.
 *
 *   - An old token must still be let through. There was a check here that
 *     redirected anything below the current version to /login and deleted the
 *     session cookie. It took production down: the deletion did not stick, so
 *     every request from an existing session redirected to /login, which
 *     redirected again, forever. The claims it was protecting are all gated on
 *     an explicit value, so an old token carrying `undefined` is already safe.
 */

// `auth` is used as a higher-order wrapper: `export default auth((req) => ...)`.
// Returning the handler unchanged lets the tests call it with a synthetic
// request, without standing up Auth.js.
vi.mock('@/lib/auth-config', () => ({
  auth: (handler: unknown) => handler,
}))

import { NextRequest, type NextResponse } from 'next/server'
import proxy from '../proxy'

const TOKEN_VERSION = 3

function req(pathname: string, session: Record<string, unknown> | null) {
  return {
    nextUrl: new URL(`https://app.floraclin.com.br${pathname}`),
    url: `https://app.floraclin.com.br${pathname}`,
    method: 'GET',
    headers: new Headers(),
    auth: session,
    cookies: { delete: vi.fn() },
  } as never
}

function session(over: Record<string, unknown> = {}) {
  return {
    v: TOKEN_VERSION,
    tenantId: 'tenant-1',
    tenantStatus: 'active',
    subscriptionStatus: 'active',
    emailVerified: true,
    ...over,
  }
}

function locationOf(res: { headers: Headers } | undefined) {
  return res?.headers?.get('location') ?? null
}

/** Auth.js's wrapper takes (req, ctx); the handler ignores ctx. */
function run(pathname: string, s: Record<string, unknown> | null) {
  return (proxy as unknown as (r: unknown, c: unknown) => { headers: Headers })(
    req(pathname, s),
    {},
  )
}

beforeEach(() => vi.clearAllMocks())

describe('proxy: email confirmation gate', () => {
  it('sends an unconfirmed user to /confirm-email', () => {
    const res = run('/dashboard', session({ emailVerified: false }))
    expect(locationOf(res)).toContain('/confirm-email')
  })

  it('lets an unconfirmed user reach /confirm-email itself', () => {
    const res = run('/confirm-email', session({ emailVerified: false }))
    expect(locationOf(res)).toBeNull()
  })

  it('lets a confirmed user through', () => {
    const res = run('/dashboard', session({ emailVerified: true }))
    expect(locationOf(res)).toBeNull()
  })

  it('does NOT gate a token that predates the claim', () => {
    // The lockout that nearly shipped. `emailVerified` absent must mean
    // "unknown", never "unverified": every existing customer's token looked
    // exactly like this.
    const s = session()
    delete (s as Record<string, unknown>).emailVerified
    const res = run('/dashboard', s)
    expect(locationOf(res) ?? '').not.toContain('/confirm-email')
  })
})

describe('proxy: an old token is not a reason to redirect', () => {
  it('lets a session minted before the current claims through', () => {
    // The outage. A version check here sent this token to /login and deleted
    // the cookie; the deletion missed, so /login redirected to /login without
    // end. Nothing may bounce an authenticated user on the strength of a
    // version alone.
    const res = run('/dashboard', session({ v: TOKEN_VERSION - 1 }))
    expect(locationOf(res)).toBeNull()
  })

  it('lets a session with no version claim at all through', () => {
    const res = run('/dashboard', session({ v: undefined }))
    expect(locationOf(res)).toBeNull()
  })

  it('does not send an old token to the page it was just redirected from', () => {
    // The loop, stated directly: whatever /login does with this session, it
    // must not be "go to /login".
    const res = run('/login', session({ v: TOKEN_VERSION - 1 }))
    expect(locationOf(res) ?? '').not.toContain('/login')
  })
})

describe('proxy: API routes are not gated here', () => {
  it('passes API requests through untouched', () => {
    // Write enforcement lives in requireWrite, against the database and the
    // caller's real tenant. Middleware only sees a JWT that refreshes on
    // sign-in and carries an arbitrary first membership, so gating writes
    // here would enforce nothing for an already-logged-in user.
    const res = run('/api/patients', session({ subscriptionStatus: 'expired' }))
    expect(locationOf(res)).toBeNull()
  })

  it('passes unauthenticated webhook requests through', () => {
    const res = run('/api/webhooks/whatsapp', null)
    expect(locationOf(res)).toBeNull()
  })
})

describe('proxy: the approval gate is gone', () => {
  it('never redirects to /pending-approval', () => {
    for (const status of ['active', 'pending_approval', 'suspended']) {
      const res = run('/dashboard', session({ tenantStatus: status }))
      expect(locationOf(res) ?? '').not.toContain('/pending-approval')
    }
  })
})

describe('proxy: the web app manifest is public', () => {
  it('does not redirect an unauthenticated request for /manifest.webmanifest', () => {
    // Chrome fetches the manifest without cookies before it decides the app
    // is installable. A redirect to /login here means no install prompt, ever.
    const res = run('/manifest.webmanifest', null)
    expect(locationOf(res)).toBeNull()
  })
})

describe('proxy: the Sentry tunnel is public', () => {
  it('does not redirect an unauthenticated POST to /monitoring', () => {
    // An anonymous visitor's client-side errors go through this tunnel. A
    // redirect to /login turned every one of them into a 405 and dropped it.
    const res = run('/monitoring?o=1&p=2&r=us', null)
    expect(locationOf(res)).toBeNull()
  })

  it('still sends unauthenticated requests for other pages to /login', () => {
    const res = run('/monitoring-dashboard', null)
    expect(locationOf(res)).toContain('/login')
  })
})

describe('proxy: referral and first-touch cookies on /signup', () => {
  const ENABLED = {
    REFERRAL_ENROLLMENT_ENABLED: 'true',
    STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_1',
    STRIPE_REFERRER_COUPON_IDS: 'c20,c40,c60,c80,c100',
  }

  function enable(over: Record<string, string> = {}) {
    for (const [k, v] of Object.entries({ ...ENABLED, ...over })) vi.stubEnv(k, v)
  }

  async function signupRun(pathAndQuery: string, session: Record<string, unknown> | null = null) {
    const { NextRequest } = await import('next/server')
    const request = new NextRequest(`https://app.floraclin.com.br${pathAndQuery}`, {
      headers: { 'sec-fetch-dest': 'document' },
    })
    const res = (proxy as unknown as (r: unknown, c: unknown) => Response)(
      Object.assign(request, { auth: session }),
      {},
    ) as Response & { cookies: { get(n: string): { value: string } | undefined } }
    return res
  }

  afterEach(() => vi.unstubAllEnvs())

  it('sets floraclin_ref on /signup?ref= with the switch on', async () => {
    enable()
    const res = await signupRun('/signup?ref=meca7k')
    expect(res.cookies.get('floraclin_ref')?.value).toBe('MECA7K')
  })

  it('sets nothing with the switch off', async () => {
    const res = await signupRun('/signup?ref=MECA7K')
    expect(res.cookies.get('floraclin_ref')).toBeUndefined()
  })

  it('sets nothing when the switch is on but the promotion code is not configured', async () => {
    enable({ STRIPE_REFERRAL_PROMOTION_CODE_ID: '' })
    const res = await signupRun('/signup?ref=MECA7K')
    expect(res.cookies.get('floraclin_ref')).toBeUndefined()
  })

  it('sets nothing for a malformed or missing code', async () => {
    enable()
    expect((await signupRun('/signup?ref=%21%21')).cookies.get('floraclin_ref')).toBeUndefined()
    expect((await signupRun('/signup')).cookies.get('floraclin_ref')).toBeUndefined()
  })

  it('only captures on /signup, not on /login', async () => {
    enable()
    const res = await signupRun('/login?ref=MECA7K')
    expect(res.cookies.get('floraclin_ref')).toBeUndefined()
  })

  it('does not capture for an authenticated user, who is redirected away', async () => {
    enable()
    const res = await signupRun('/signup?ref=MECA7K', session())
    expect(locationOf(res)).toContain('/dashboard')
    expect(res.cookies.get('floraclin_ref')).toBeUndefined()
  })

  it('keeps writing first-touch on /signup regardless of the referral switch', async () => {
    const res = await signupRun('/signup?utm_source=google')
    const touch = JSON.parse(res.cookies.get('floraclin_ft')!.value)
    expect(touch).toMatchObject({ utmSource: 'google', landingPath: '/signup' })
    expect(res.cookies.get('floraclin_ref')).toBeUndefined()
  })
})

describe('proxy: first-touch capture outside /signup', () => {
  // An ad pointing at the app root, or a visitor who goes / -> /login and then
  // follows the client-side "Criar conta" link, never made a document request
  // to /signup, so signup_attribution came out empty.
  const AD_QUERY = '?utm_source=meta&utm_medium=paid_social&utm_campaign=fc_trial&utm_content=video_1'

  function documentRequest(pathname: string) {
    const request = new NextRequest(`https://app.floraclin.com.br${pathname}`, {
      headers: { 'sec-fetch-dest': 'document', referer: 'https://l.instagram.com/' },
    }) as NextRequest & { auth: unknown }
    request.auth = null
    return (proxy as unknown as (r: unknown, c: unknown) => NextResponse)(request, {})
  }

  function firstTouchOf(res: NextResponse) {
    const written = res.cookies.get('floraclin_ft')
    return written ? JSON.parse(written.value) : null
  }

  it('records the UTMs on the redirect from the app root to /login', () => {
    const res = documentRequest(`/${AD_QUERY}`)
    expect(locationOf(res)).toContain('/login')
    expect(firstTouchOf(res)).toMatchObject({
      landingPath: '/',
      utmSource: 'meta',
      utmMedium: 'paid_social',
      utmCampaign: 'fc_trial',
      utmContent: 'video_1',
      referrer: 'https://l.instagram.com',
    })
    expect(res.cookies.get('floraclin_ft')?.domain).toBe('.floraclin.com.br')
  })

  it('records a first touch on /login', () => {
    const res = documentRequest(`/login${AD_QUERY}`)
    expect(locationOf(res)).toBeNull()
    expect(firstTouchOf(res)).toMatchObject({ landingPath: '/login', utmSource: 'meta' })
  })

  it('still records a first touch on /signup', () => {
    expect(firstTouchOf(documentRequest(`/signup${AD_QUERY}`))).toMatchObject({
      landingPath: '/signup',
      utmCampaign: 'fc_trial',
    })
  })

  it('leaves API requests alone', () => {
    expect(firstTouchOf(documentRequest(`/api/tenant${AD_QUERY}`))).toBeNull()
  })
})

describe('proxy: the destination survives the trip through /login', () => {
  it('carries a logged-out lifecycle link to /onboarding, UTMs included, in callbackUrl', () => {
    const res = run('/onboarding?utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=trial_setup_incomplete', null)
    const location = new URL(locationOf(res)!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('callbackUrl')).toBe(
      '/onboarding?utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=trial_setup_incomplete',
    )
  })

  it('adds no callbackUrl for the app root', () => {
    const location = new URL(locationOf(run('/', null))!)
    expect(location.searchParams.has('callbackUrl')).toBe(false)
  })

  it('sends a signed-in user on /login to the callbackUrl', () => {
    const res = run('/login?callbackUrl=%2Fonboarding', session())
    expect(locationOf(res)).toBe('https://app.floraclin.com.br/onboarding')
  })

  it.each(['https%3A%2F%2Fevil.example%2F', '%2F.%2F%2Fevil.example', '%2F%2Fevil.example'])(
    'ignores an off-site callbackUrl for a signed-in user: %s',
    (callbackUrl) => {
      const res = run(`/login?callbackUrl=${callbackUrl}`, session())
      expect(locationOf(res)).toBe('https://app.floraclin.com.br/dashboard')
    },
  )
})
