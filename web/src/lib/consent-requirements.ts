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
