import { describe, it, expect, afterEach, vi } from 'vitest'
import sitemap from '../sitemap'

const urls = async () => (await sitemap()).map((e) => e.url)
const appSays = (enrollmentOpen: boolean) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enrollmentOpen, rewardsActive: true }))))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sitemap /indique', async () => {
  it('is omitted with the switch off and no end date', async () => {
    expect(await urls()).not.toContain('https://floraclin.com.br/indique')
    expect(await urls()).toContain('https://floraclin.com.br/termos')
  })

  it('is omitted when the switch is not exactly "true"', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'false')
    expect(await urls()).not.toContain('https://floraclin.com.br/indique')
  })

  it('is included with the switch on', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    appSays(true)
    expect(await urls()).toContain('https://floraclin.com.br/indique')
  })

  it('is omitted with the switch on while the app is not fully configured', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    appSays(false)
    expect(await urls()).not.toContain('https://floraclin.com.br/indique')
  })

  it('is included while winding down (end date set, switch off)', async () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', '2027-01-15T02:00:00-03:00')
    expect(await urls()).toContain('https://floraclin.com.br/indique')
  })

  it('ignores an unparseable end date', async () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', 'not-a-date')
    expect(await urls()).not.toContain('https://floraclin.com.br/indique')
  })
})
