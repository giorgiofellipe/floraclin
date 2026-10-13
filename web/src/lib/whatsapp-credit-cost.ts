// Meta bills a Brazil marketing template ~9x a utility one. 3 credits keeps a
// tenant that spends its whole quota on marketing within the plan's cost margin.
export const MARKETING_CREDIT_COST = 3

export function templateCreditCost(category: string | undefined): number {
  return category === 'MARKETING' ? MARKETING_CREDIT_COST : 1
}
