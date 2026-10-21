import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ enabled: true, cookie: undefined as string | undefined, cookies: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: () => {
    m.cookies()
    return Promise.resolve({ get: () => (m.cookie === undefined ? undefined : { value: m.cookie }) })
  },
}))
vi.mock('../config', () => ({ isReferralEnrollmentEnabled: () => m.enabled }))

import { signupReferralDefaults } from '../signup-default'

const params = (ref?: string | string[]) => Promise.resolve(ref === undefined ? {} : { ref })

beforeEach(() => {
  m.enabled = true
  m.cookie = undefined
  m.cookies.mockReset()
})

describe('signupReferralDefaults', () => {
  it('reads nothing while enrollment is off', async () => {
    m.enabled = false
    m.cookie = 'MECA7K'
    expect(await signupReferralDefaults(params('MECA7K'))).toEqual({ referralEnabled: false, defaultReferralCode: null })
    expect(m.cookies).not.toHaveBeenCalled()
  })

  it('prefers a valid ?ref (first of several) over the cookie, normalised', async () => {
    m.cookie = 'ABC234'
    expect(await signupReferralDefaults(params(' meca7k '))).toEqual({ referralEnabled: true, defaultReferralCode: 'MECA7K' })
    expect((await signupReferralDefaults(params(['meca7k', 'ABC234']))).defaultReferralCode).toBe('MECA7K')
  })

  it('falls back to the cookie when ?ref is missing or malformed', async () => {
    m.cookie = 'abc234'
    expect((await signupReferralDefaults(params())).defaultReferralCode).toBe('ABC234')
    expect((await signupReferralDefaults(params('0O1IL'))).defaultReferralCode).toBe('ABC234')
  })

  it('is null with neither', async () => {
    expect(await signupReferralDefaults(params())).toEqual({ referralEnabled: true, defaultReferralCode: null })
  })
})
