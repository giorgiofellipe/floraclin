import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

function get(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://floraclin.com.br${path}`, {
    headers: { 'sec-fetch-dest': 'document', ...headers },
  })
}

const ref = (res: Response) => (res as never as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get('floraclin_ref')?.value
const ft = (res: Response) => (res as never as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get('floraclin_ft')?.value

afterEach(() => vi.unstubAllEnvs())

describe('site middleware: referral cookie', () => {
  it('sets floraclin_ref from ?ref= with the switch on', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    expect(ref(middleware(get('/?ref=meca7k')))).toBe('MECA7K')
  })

  it('sets floraclin_ref from /indicacao/{code} with the switch on', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    expect(ref(middleware(get('/indicacao/MECA7K')))).toBe('MECA7K')
  })

  it('sets nothing with the switch off', () => {
    expect(ref(middleware(get('/indicacao/MECA7K')))).toBeUndefined()
    expect(ref(middleware(get('/?ref=MECA7K')))).toBeUndefined()
  })

  it('sets nothing for a malformed or missing code', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    expect(ref(middleware(get('/indicacao/!!!')))).toBeUndefined()
    expect(ref(middleware(get('/?ref=toolongcode123')))).toBeUndefined()
    expect(ref(middleware(get('/')))).toBeUndefined()
  })

  it('does not set it on prefetch / non-document requests', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    expect(ref(middleware(get('/?ref=MECA7K', { 'sec-fetch-dest': 'empty' })))).toBeUndefined()
  })
})

describe('site middleware: first touch is unchanged', () => {
  it('still writes first-touch from UTMs with the switch off', () => {
    const res = middleware(get('/?utm_source=google'))
    expect(JSON.parse(ft(res)!)).toMatchObject({ utmSource: 'google', landingPath: '/' })
    expect(ref(res)).toBeUndefined()
  })

  it('writes both cookies independently with the switch on', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    const res = middleware(get('/indicacao/MECA7K?utm_source=wa'))
    expect(JSON.parse(ft(res)!)).toMatchObject({ utmSource: 'wa', landingPath: '/indicacao/MECA7K' })
    expect(ref(res)).toBe('MECA7K')
  })
})
