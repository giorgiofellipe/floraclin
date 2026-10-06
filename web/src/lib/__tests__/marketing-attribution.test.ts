import { describe, expect, it } from 'vitest'
import { buildFbc, parseSignupAttribution } from '../marketing-attribution'

describe('marketing attribution utilities', () => {
  it('builds Meta fbc from a click id and timestamp', () => {
    expect(buildFbc('IwAR123', 1700000000000)).toBe('fb.1.1700000000000.IwAR123')
  })

  it('normalizes signup attribution from hidden form JSON', () => {
    const parsed = parseSignupAttribution(
      JSON.stringify({
        utmSource: 'meta',
        utmCampaign: 'hof-trial',
        fbclid: 'click-1',
        ignored: 'nope',
        capturedAt: '2026-10-06T00:00:00.000Z',
        expiresAt: '2027-01-04T00:00:00.000Z',
        metaEventId: 'complete_registration:event-1',
      }),
    )

    expect(parsed).toEqual({
      utmSource: 'meta',
      utmCampaign: 'hof-trial',
      fbclid: 'click-1',
      capturedAt: '2026-10-06T00:00:00.000Z',
      expiresAt: '2027-01-04T00:00:00.000Z',
      metaEventId: 'complete_registration:event-1',
    })
  })
})
