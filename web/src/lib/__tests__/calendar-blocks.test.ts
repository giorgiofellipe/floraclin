import { describe, it, expect } from 'vitest'
import { canDeleteBlock } from '../calendar-blocks'

const USER_ID = 'user-1'

function makeBlock(overrides: Partial<{ source: 'google' | 'manual'; practitionerId: string | null }> = {}) {
  return { source: 'manual' as const, practitionerId: USER_ID, ...overrides }
}

describe('canDeleteBlock', () => {
  // Google blocks come back on the next sync, so the UI must never offer delete.
  it('never allows deleting a Google block', () => {
    const block = makeBlock({ source: 'google' })
    expect(canDeleteBlock(block, 'owner', USER_ID)).toBe(false)
    expect(canDeleteBlock(block, 'practitioner', USER_ID)).toBe(false)
  })

  // Clinic-wide blocks are owner only, matching the route.
  it('allows only the owner to delete a clinic-wide block', () => {
    const block = makeBlock({ practitionerId: null })
    expect(canDeleteBlock(block, 'owner', USER_ID)).toBe(true)
    expect(canDeleteBlock(block, 'practitioner', USER_ID)).toBe(false)
  })

  // A practitioner may only remove blocks on their own agenda.
  it('limits a practitioner to their own blocks', () => {
    expect(canDeleteBlock(makeBlock(), 'practitioner', USER_ID)).toBe(true)
    expect(canDeleteBlock(makeBlock({ practitionerId: 'user-2' }), 'practitioner', USER_ID)).toBe(false)
    expect(canDeleteBlock(makeBlock({ practitionerId: 'user-2' }), 'owner', USER_ID)).toBe(true)
  })

  it('never allows receptionist or financial', () => {
    expect(canDeleteBlock(makeBlock(), 'receptionist', USER_ID)).toBe(false)
    expect(canDeleteBlock(makeBlock(), 'financial', USER_ID)).toBe(false)
  })
})
