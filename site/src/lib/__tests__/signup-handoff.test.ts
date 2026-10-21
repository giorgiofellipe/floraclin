import { describe, expect, it } from 'vitest'
import {
  LANDING_PARAMS_STORAGE_KEY,
  campaignParams,
  rememberLandingParams,
  signupUrlWithCampaign,
} from '../signup-handoff'

const SIGNUP = 'https://app.floraclin.com.br/signup'
const AD_QUERY =
  '?utm_source=meta&utm_medium=paid_social&utm_campaign=fc_meta_trial&utm_content=video_1&utm_term=adset_a&fbclid=fb-1&token=secret'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

describe('campaignParams', () => {
  it('keeps UTMs and drops click ids and anything else without marketing consent', () => {
    expect(campaignParams(AD_QUERY, false).toString()).toBe(
      'utm_source=meta&utm_medium=paid_social&utm_campaign=fc_meta_trial&utm_content=video_1&utm_term=adset_a',
    )
  })

  it('adds the ad click id with marketing consent', () => {
    expect(campaignParams(AD_QUERY, true).get('fbclid')).toBe('fb-1')
    expect(campaignParams(AD_QUERY, true).has('token')).toBe(false)
  })

  it('caps each value so the app cookie stays under the browser limit', () => {
    expect(campaignParams(`?utm_campaign=${'x'.repeat(500)}`, false).get('utm_campaign')).toHaveLength(200)
  })
})

describe('signupUrlWithCampaign', () => {
  it('forwards the landing page UTMs to the app signup', () => {
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: AD_QUERY, storage: null, marketingConsent: false }))
    expect(url.origin + url.pathname).toBe(SIGNUP)
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_content')).toBe('video_1')
    expect(url.searchParams.get('utm_term')).toBe('adset_a')
    expect(url.searchParams.has('fbclid')).toBe(false)
  })

  it('forwards the click id only with marketing consent', () => {
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: AD_QUERY, storage: null, marketingConsent: true }))
    expect(url.searchParams.get('fbclid')).toBe('fb-1')
  })

  it('falls back to the params remembered from the landing page after browsing elsewhere', () => {
    const storage = memoryStorage()
    rememberLandingParams(AD_QUERY, storage)
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: '', storage, marketingConsent: false }))
    expect(url.searchParams.get('utm_campaign')).toBe('fc_meta_trial')
    expect(url.searchParams.has('fbclid')).toBe(false)
  })

  it('returns the bare signup URL when the visit carried no campaign', () => {
    expect(signupUrlWithCampaign(SIGNUP, { search: '?q=1', storage: memoryStorage(), marketingConsent: true })).toBe(SIGNUP)
  })

  it('survives storage that throws, as in some in-app browsers', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => rememberLandingParams(AD_QUERY, storage)).not.toThrow()
    expect(signupUrlWithCampaign(SIGNUP, { search: '', storage, marketingConsent: false })).toBe(SIGNUP)
  })
})

describe('rememberLandingParams', () => {
  it('never stores the ad click id, which needs consent first', () => {
    const storage = memoryStorage()
    rememberLandingParams(AD_QUERY, storage)
    expect(storage.data.get(LANDING_PARAMS_STORAGE_KEY)).not.toContain('fbclid')
  })

  it('keeps the first campaign of the tab', () => {
    const storage = memoryStorage()
    rememberLandingParams('?utm_source=meta&utm_campaign=first', storage)
    rememberLandingParams('?utm_source=google&utm_campaign=second', storage)
    expect(storage.data.get(LANDING_PARAMS_STORAGE_KEY)).toBe('utm_source=meta&utm_campaign=first')
  })

  it('stores nothing for a visit without campaign params', () => {
    const storage = memoryStorage()
    rememberLandingParams('?page=2', storage)
    expect(storage.data.size).toBe(0)
  })
})
