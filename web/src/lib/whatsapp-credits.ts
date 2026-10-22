// Meta bills a Brazil marketing template ~9x a utility one. 3 credits keeps a
// tenant that spends its whole quota on marketing within the plan's cost margin.
export const MARKETING_CREDIT_COST = 3
export const DEFAULT_CREDIT_COST = 1
export const UNLIMITED_CREDITS = -1

/** plan + bonus; -1 stays -1 (unlimited never gets a bonus). */
export function periodCreditsTotal(planLimit: number, bonusCredits: number): number {
  return planLimit === UNLIMITED_CREDITS ? UNLIMITED_CREDITS : planLimit + bonusCredits
}

export function templateCreditCost(category: string): number {
  return category === 'MARKETING' ? MARKETING_CREDIT_COST : DEFAULT_CREDIT_COST
}

export class CreditExhaustedError extends Error {
  constructor(
    public readonly creditsUsed: number,
    public readonly creditsTotal: number,
    public readonly creditsRequired: number,
  ) {
    super(`WhatsApp credits insufficient (${creditsUsed}/${creditsTotal}, needs ${creditsRequired})`)
    this.name = 'CreditExhaustedError'
  }
}

export class WhatsAppTemplateNotFoundError extends Error {
  constructor(templateName: string, language: string) {
    super(`WhatsApp template not found: ${templateName} (${language})`)
    this.name = 'WhatsAppTemplateNotFoundError'
  }
}
