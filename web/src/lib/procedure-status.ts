import type { ProcedureStatus } from '@/types'

/**
 * Compute the planning status of a procedure based on whether it has
 * everything approval requires.
 *
 *   "planned" = financialPlan with a positive total (diagram points optional —
 *               non-injectable procedures like limpeza de pele don't use them)
 *   "draft"   = anything less
 *
 * Used by the wizard's "Salvar e sair" flow so that incomplete procedures reopen
 * at the planning step (step 3) while complete ones go straight to approval
 * (step 4). Only the draft↔planned transition is handled here — 'approved',
 * 'in_progress', 'completed', and 'cancelled' are reserved for dedicated
 * lifecycle actions.
 */
export function computePlanningStatus(input: {
  financialPlan?: { totalAmount?: number | string | null } | null
  diagrams?: Array<{ points?: unknown[] | null } | null | undefined> | null
}): 'draft' | 'planned' {
  const totalAmount = input.financialPlan?.totalAmount
  const numericTotal =
    typeof totalAmount === 'number'
      ? totalAmount
      : typeof totalAmount === 'string'
        ? parseFloat(totalAmount)
        : 0
  const hasFinancialPlan = !!input.financialPlan && numericTotal > 0

  return hasFinancialPlan ? 'planned' : 'draft'
}

/**
 * "Open" = procedure is still in the active lifecycle (not terminal).
 * Includes draft, planned, approved, and in_progress.
 */
export function isOpenStatus(status: ProcedureStatus): boolean {
  return status === 'draft' || status === 'planned' || status === 'approved' || status === 'in_progress'
}

/**
 * "Closed" = procedure has reached a terminal status (completed or cancelled).
 */
export function isClosedStatus(status: ProcedureStatus): boolean {
  return status === 'completed' || status === 'cancelled'
}
