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
  it('keeps UTMs and the ad click id, and drops anything else', () => {
    expect(campaignParams(AD_QUERY).toString()).toBe(
      'utm_source=meta&utm_medium=paid_social&utm_campaign=fc_meta_trial&utm_content=video_1&utm_term=adset_a&fbclid=fb-1',
    )
  })

  it('caps each value so the app cookie stays under the browser limit', () => {
    expect(campaignParams(`?utm_campaign=${'x'.repeat(500)}`).get('utm_campaign')).toHaveLength(200)
  })
})

describe('signupUrlWithCampaign', () => {
  it('forwards the landing page UTMs and ad click id to the app signup', () => {
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: AD_QUERY, storage: null }))
    expect(url.origin + url.pathname).toBe(SIGNUP)
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_content')).toBe('video_1')
    expect(url.searchParams.get('utm_term')).toBe('adset_a')
    expect(url.searchParams.get('fbclid')).toBe('fb-1')
  })

  it('falls back to the params remembered from the landing page after browsing elsewhere', () => {
    const storage = memoryStorage()
    rememberLandingParams(AD_QUERY, storage)
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: '', storage }))
    expect(url.searchParams.get('utm_campaign')).toBe('fc_meta_trial')
    expect(url.searchParams.get('fbclid')).toBe('fb-1')
  })

  it('keeps the landing UTMs when a later page carries only a click id', () => {
    const storage = memoryStorage()
    rememberLandingParams(AD_QUERY, storage)
    const url = new URL(signupUrlWithCampaign(SIGNUP, { search: '?fbclid=fb-2', storage }))
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('fbclid')).toBe('fb-2')
  })

  it('returns the bare signup URL when the visit carried no campaign', () => {
    expect(signupUrlWithCampaign(SIGNUP, { search: '?q=1', storage: memoryStorage() })).toBe(SIGNUP)
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
    expect(signupUrlWithCampaign(SIGNUP, { search: '', storage })).toBe(SIGNUP)
  })
})

describe('rememberLandingParams', () => {
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
