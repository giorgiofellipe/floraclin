import { describe, it, expect } from 'vitest'
import { requiredConsentTypes, pendingConsentTypes, consentCoverage } from '../consent-requirements'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'
import { consentTypes } from '@/validations/consent'

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

describe('consentCoverage', () => {
  // The settings list tells the owner which procedures ask for each term; a new rule in
  // requiredConsentTypes that this helper does not mirror would make that list lie.
  it.each(consentTypes.filter((t) => t !== 'general' && t !== 'service_contract'))(
    '%s covers exactly the categories whose approval requires it',
    (type) => {
      const categories = [...PROCEDURE_CATEGORIES, 'toxina_botulinica', 'preenchimento', 'bioestimulador']
      const procedureTypes = categories.map((category) => ({ name: category, category, isActive: true }))
      const coverage = consentCoverage(type, procedureTypes)
      const covered = coverage.kind === 'procedures' ? coverage.names : []

      const required = categories.filter((category) =>
        requiredConsentTypes({ categories: [category], hasActiveContractTemplate: false }).includes(type),
      )
      expect(covered).toEqual(required)
    },
  )
})
