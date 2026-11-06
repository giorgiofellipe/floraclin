import type { Role } from '@/types'

/**
 * Who manages accounts, transfers and (later) bank reconciliation: the owner
 * and the Financeiro role, on every plan including trial. Giorgio's decision on
 * https://github.com/giorgiofellipe/floraclin/issues/88#issuecomment-6644428106 .
 */
export const ACCOUNT_MANAGER_ROLES = ['owner', 'financial'] as const satisfies readonly Role[]

export function canManageAccounts(role: string): boolean {
  return (ACCOUNT_MANAGER_ROLES as readonly string[]).includes(role)
}
