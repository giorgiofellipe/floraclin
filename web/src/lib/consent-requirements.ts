export const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

export function requiredConsentTypes(input: {
  categories: string[]
  hasActiveContractTemplate: boolean
}): string[] {
  const types = ['general']
  for (const category of input.categories) {
    const mapped = CATEGORY_TO_CONSENT[category]
    if (mapped && !types.includes(mapped)) types.push(mapped)
  }
  if (input.hasActiveContractTemplate) types.push('service_contract')
  return types
}

export function pendingConsentTypes(required: string[], signed: string[]): string[] {
  return required.filter((type) => !signed.includes(type))
}

export type ConsentCoverage =
  | { kind: 'all' }
  | { kind: 'approval' }
  | { kind: 'procedures'; names: string[] }
  | { kind: 'manual' }

export interface CoverageProcedureType {
  name: string
  category: string
  isActive: boolean
}

// Mirrors requiredConsentTypes: which procedures make the approval ask for this template.
export function consentCoverage(
  type: string,
  procedureTypes: CoverageProcedureType[],
): ConsentCoverage {
  if (type === 'general') return { kind: 'all' }
  if (type === 'service_contract') return { kind: 'approval' }
  const categories = Object.keys(CATEGORY_TO_CONSENT).filter((c) => CATEGORY_TO_CONSENT[c] === type)
  if (categories.length === 0) return { kind: 'manual' }
  return {
    kind: 'procedures',
    names: procedureTypes
      .filter((pt) => pt.isActive && categories.includes(pt.category))
      .map((pt) => pt.name),
  }
}
