// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { captureReferralCode } from '../cookie'

const ON = {
  REFERRAL_ENROLLMENT_ENABLED: 'true',
  STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_test',
  STRIPE_REFERRER_COUPON_IDS: 'a,b,c,d,e',
}
const OFF = { STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_test', STRIPE_REFERRER_COUPON_IDS: 'a,b,c,d,e' }

function visit(
  url: string,
  {
    cookies = {},
    headers = {},
    env = ON,
    method = 'GET',
  }: { cookies?: Record<string, string>; headers?: Record<string, string>; env?: Record<string, string>; method?: string } = {},
) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
  const request = new NextRequest(url, {
    method,
    headers: { 'sec-fetch-dest': 'document', ...(cookie ? { cookie } : {}), ...headers },
  })
  const response = NextResponse.next()
  captureReferralCode(request, response, env)
  return response.cookies.get('floraclin_ref')
}

describe('captureReferralCode', () => {
  it('sets the normalised code with the expected options', () => {
    const written = visit('https://app.floraclin.com.br/signup?ref=meca7k')
    expect(written).toMatchObject({
      name: 'floraclin_ref',
      value: 'MECA7K',
      maxAge: 60 * 24 * 60 * 60,
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
      domain: '.floraclin.com.br',
    })
  })

  it('sets nothing for a malformed code', () => {
    expect(visit('https://app.floraclin.com.br/signup?ref=MEC-7K')).toBeUndefined()
    expect(visit('https://app.floraclin.com.br/signup')).toBeUndefined()
  })

  it('sets nothing with the switch off', () => {
    expect(visit('https://app.floraclin.com.br/signup?ref=MECA7K', { env: OFF })).toBeUndefined()
  })

  it('sets nothing on non-document requests', () => {
    const url = 'https://app.floraclin.com.br/signup?ref=MECA7K'
    expect(visit(url, { headers: { 'sec-fetch-dest': 'image' } })).toBeUndefined()
    expect(visit(url, { headers: { 'sec-fetch-dest': '', rsc: '1', accept: 'text/html' } })).toBeUndefined()
  })

  it('overwrites a different stored code but does not rewrite an identical one', () => {
    const url = 'https://app.floraclin.com.br/signup?ref=MECA7K'
    expect(visit(url, { cookies: { floraclin_ref: 'ZZZZZZ' } })?.value).toBe('MECA7K')
    expect(visit(url, { cookies: { floraclin_ref: 'MECA7K' } })).toBeUndefined()
  })

  it('sets the domain only on floraclin.com.br hosts', () => {
    expect(visit('https://floraclin.com.br/signup?ref=MECA7K')?.domain).toBe('.floraclin.com.br')
    const local = visit('http://localhost:3000/signup?ref=MECA7K')
    expect(local?.value).toBe('MECA7K')
    expect(local?.domain).toBeUndefined()
    expect(local?.secure).toBe(false)
  })
})
