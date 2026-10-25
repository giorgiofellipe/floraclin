// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { FIRST_TOUCH_COOKIE, captureFirstTouch } from '../first-touch'

const NOW = '2026-10-14T12:00:00.000Z'
const DENIED = JSON.stringify({ necessary: true, marketing: false, version: 1 })

function visit(
  url: string,
  { cookies = {}, headers = {} }: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')
  const request = new NextRequest(url, {
    headers: { 'sec-fetch-dest': 'document', ...(cookieHeader ? { cookie: cookieHeader } : {}), ...headers },
  })
  const response = NextResponse.next()
  captureFirstTouch(request, response)
  const written = response.cookies.get(FIRST_TOUCH_COOKIE)
  return { written, touch: written ? JSON.parse(written.value) : null }
}

describe('captureFirstTouch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records UTMs, the bare landing path and the referrer origin, never other params', () => {
    const { written, touch } = visit(
      'https://floraclin.com.br/precos?utm_source=meta&utm_campaign=hof&token=secret',
      { headers: { referer: 'https://l.facebook.com/l.php?u=private' } },
    )

    expect(touch).toEqual({
      utmSource: 'meta',
      utmCampaign: 'hof',
      landingPath: '/precos',
      referrer: 'https://l.facebook.com',
      capturedAt: NOW,
    })
    expect(written).toMatchObject({ httpOnly: true, domain: '.floraclin.com.br', path: '/' })
  })

  // Regression: ad clicks landing before the banner was answered lost fbclid, so CAPI sent no fbc.
  it.each([
    ['the banner was never answered', {}],
    ['marketing was refused', { floraclin_cookie_consent: DENIED }],
  ])('records click ids whatever the banner says: %s', (_name, cookies) => {
    const { touch } = visit('https://floraclin.com.br/?fbclid=fb-1&gclid=g-1', { cookies })

    expect(touch).toMatchObject({ fbclid: 'fb-1', gclid: 'g-1' })
  })

  it('ignores referrers from FloraClin domains', () => {
    const { touch } = visit('https://app.floraclin.com.br/signup', {
      headers: { referer: 'https://floraclin.com.br/precos' },
    })

    expect(touch).not.toHaveProperty('referrer')
  })

  const organic = { landingPath: '/', capturedAt: '2026-10-01T00:00:00.000Z' }
  const google = { utmSource: 'google', landingPath: '/', capturedAt: '2026-10-01T00:00:00.000Z' }

  const paidLater = 'https://floraclin.com.br/precos?utm_source=meta&utm_campaign=bf'

  it.each([
    ['a paid visit replaces an earlier organic one whole', organic, paidLater, { utmSource: 'meta', utmCampaign: 'bf', landingPath: '/precos', capturedAt: NOW }],
    ['a later paid visit never mixes into an earlier paid one', google, paidLater, undefined],
    ['a later organic visit keeps the earlier organic one', organic, 'https://floraclin.com.br/precos', undefined],
  ])('%s', (_name, stored, laterUrl, expected) => {
    const { touch } = visit(laterUrl, { cookies: { floraclin_ft: JSON.stringify(stored) } })

    expect(touch ?? undefined).toEqual(expected)
  })

  it.each([
    ['client navigation fetch', { 'sec-fetch-dest': 'empty' }],
    ['RSC request without fetch metadata', { 'sec-fetch-dest': '', rsc: '1', accept: '*/*' }],
  ])('ignores a %s', (_name, headers) => {
    const { written } = visit('https://floraclin.com.br/?utm_source=meta', { headers })

    expect(written).toBeUndefined()
  })
})
