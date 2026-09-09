/**
 * Tests for `requireWrite`, the role-plus-subscription wrapper every
 * mutating route calls. Pins the two things it must get right: a forbidden
 * role short-circuits before the subscription is ever consulted, and the
 * `{ ctx, blocked }` shape mirrors exactly what `subscriptionGate` returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRoleMock = vi.fn()
const subscriptionGateMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: (...roles: string[]) => requireRoleMock(...roles),
}))

vi.mock('@/lib/plans', () => ({
  subscriptionGate: (ctx: unknown) => subscriptionGateMock(ctx),
}))

import { requireWrite } from '@/lib/write-access'

const CTX = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'owner' as const,
  email: 'owner@test.com',
  fullName: 'Owner User',
  isPlatformAdmin: false,
}

const BLOCKED_RESPONSE = { status: 402 } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireWrite', () => {
  it('throws for a forbidden role without consulting the subscription gate', async () => {
    const forbidden = new Error('Forbidden: insufficient permissions')
    requireRoleMock.mockRejectedValue(forbidden)

    await expect(requireWrite('owner')).rejects.toThrow(forbidden)
    expect(subscriptionGateMock).not.toHaveBeenCalled()
  })

  it('returns the context when the role is allowed and the subscription is active', async () => {
    requireRoleMock.mockResolvedValue(CTX)
    subscriptionGateMock.mockResolvedValue(null)

    const result = await requireWrite('owner', 'practitioner')

    expect(requireRoleMock).toHaveBeenCalledWith('owner', 'practitioner')
    expect(subscriptionGateMock).toHaveBeenCalledWith(CTX)
    expect(result).toEqual({ ctx: CTX, blocked: null })
  })

  it('returns the 402 response and a null ctx when the subscription is inactive', async () => {
    requireRoleMock.mockResolvedValue(CTX)
    subscriptionGateMock.mockResolvedValue(BLOCKED_RESPONSE)

    const result = await requireWrite('owner')

    expect(result).toEqual({ ctx: null, blocked: BLOCKED_RESPONSE })
  })

  it('never blocks a platform admin', async () => {
    const adminCtx = { ...CTX, isPlatformAdmin: true }
    requireRoleMock.mockResolvedValue(adminCtx)
    // Mirrors subscriptionGate's own contract: platform admins short-circuit
    // to null without a DB read. requireWrite must not add a check on top.
    subscriptionGateMock.mockResolvedValue(null)

    const result = await requireWrite('owner')

    expect(result).toEqual({ ctx: adminCtx, blocked: null })
  })
})
