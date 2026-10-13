import type { Role } from '@/types'

interface BlockOwnership {
  source: 'google' | 'manual'
  practitionerId: string | null
}

/** Google rows come back on the next sync, so only manual rows are deletable. */
export function canDeleteBlock(block: BlockOwnership, role: Role, userId: string): boolean {
  if (block.source !== 'manual') return false
  if (role === 'owner') return true
  return role === 'practitioner' && block.practitionerId === userId
}
