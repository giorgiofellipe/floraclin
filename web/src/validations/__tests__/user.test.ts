import { describe, expect, it } from 'vitest'
import { inviteUserSchema, updateUserRoleSchema } from '../user'

describe('inviteUserSchema', () => {
  // Regression: the invite form offered "Proprietário" and the API accepted it,
  // so an owner could create a second owner by accident.
  it('rejects an owner invite', () => {
    const parsed = inviteUserSchema.safeParse({ email: 'ana@clinica.test', fullName: 'Ana', role: 'owner' })
    expect(parsed.success).toBe(false)
  })

  it('accepts a receptionist invite', () => {
    const parsed = inviteUserSchema.safeParse({ email: 'ana@clinica.test', fullName: 'Ana', role: 'receptionist' })
    expect(parsed.success).toBe(true)
  })
})

describe('updateUserRoleSchema', () => {
  it('rejects promoting a member to owner', () => {
    const parsed = updateUserRoleSchema.safeParse({ userId: '00000000-0000-4000-a000-000000000001', role: 'owner' })
    expect(parsed.success).toBe(false)
  })
})
