import { describe, it, expect, afterEach, vi } from 'vitest'
import sitemap from '../sitemap'

const urls = () => sitemap().map((e) => e.url)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sitemap /indique', () => {
  it('is omitted with the switch off and no end date', () => {
    expect(urls()).not.toContain('https://floraclin.com.br/indique')
    expect(urls()).toContain('https://floraclin.com.br/termos')
  })

  it('is omitted when the switch is not exactly "true"', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'false')
    expect(urls()).not.toContain('https://floraclin.com.br/indique')
  })

  it('is included with the switch on', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    expect(urls()).toContain('https://floraclin.com.br/indique')
  })

  it('is included while winding down (end date set, switch off)', () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', '2027-01-15T02:00:00-03:00')
    expect(urls()).toContain('https://floraclin.com.br/indique')
  })

  it('ignores an unparseable end date', () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', 'not-a-date')
    expect(urls()).not.toContain('https://floraclin.com.br/indique')
  })
})
