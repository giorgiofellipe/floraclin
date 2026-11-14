import type { Role } from '@/types'

export const RECEIVABLES_VIEWER_ROLES = ['owner', 'financial', 'receptionist', 'practitioner'] as const satisfies readonly Role[]
export const CHARGE_PAYER_ROLES = ['owner', 'receptionist', 'financial'] as const satisfies readonly Role[]
export const CHARGE_MANAGER_ROLES = ['owner', 'financial'] as const satisfies readonly Role[]
export const LEDGER_VIEWER_ROLES = ['owner', 'financial', 'receptionist'] as const satisfies readonly Role[]

export function hasRole(roles: readonly Role[], role: string | null | undefined): boolean {
  return (roles as readonly string[]).includes(role ?? '')
}
