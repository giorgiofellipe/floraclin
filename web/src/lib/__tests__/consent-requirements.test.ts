import { describe, it, expect } from 'vitest'
import { requiredConsentTypes, pendingConsentTypes } from '../consent-requirements'

describe('requiredConsentTypes', () => {
  it('maps category aliases to one consent type and appends the contract last', () => {
    expect(
      requiredConsentTypes({
        categories: ['botox', 'toxina_botulinica', 'skincare'],
        hasActiveContractTemplate: true,
      }),
    ).toEqual(['general', 'botox', 'service_contract'])
  })

  it('requires only the general consent without categories or contract template', () => {
    expect(requiredConsentTypes({ categories: [], hasActiveContractTemplate: false })).toEqual(['general'])
  })
})

describe('pendingConsentTypes', () => {
  it('returns required types that are not signed, in required order', () => {
    expect(pendingConsentTypes(['general', 'botox'], ['botox'])).toEqual(['general'])
  })
})
