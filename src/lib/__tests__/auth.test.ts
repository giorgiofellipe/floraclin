import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }),
}))

// Mock auth() from auth-config
vi.mock('@/lib/auth-config', () => ({
  auth: mockAuth,
}))

import { db } from '@/db/client'
import { requireRole } from '@/lib/auth'

function setupDbMemberships(memberships: Array<{ tenantId: string; role: string; fullName: string; email: string }>) {
  // getAuthContext chains: db.select({...}).from(tenantUsers).innerJoin(users, ...).where(and(...))
  // The where() is the terminal call and the result is awaited directly
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(memberships),
      }),
    }),
  } as never)
}

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('requireRole', () => {
    it('throws for unauthorized roles', async () => {
      mockAuth.mockResolvedValue({
        user: { id: 'user-1' },
      })

      setupDbMemberships([
        {
          tenantId: 'tenant-1',
          role: 'receptionist',
          fullName: 'Test User',
          email: 'test@test.com',
        },
      ])

      await expect(requireRole('owner')).rejects.toThrow('Forbidden: insufficient permissions')
    })

    it('passes for authorized roles', async () => {
      mockAuth.mockResolvedValue({
        user: { id: 'user-1' },
      })

      setupDbMemberships([
        {
          tenantId: 'tenant-1',
          role: 'owner',
          fullName: 'Owner User',
          email: 'owner@test.com',
        },
      ])

      const context = await requireRole('owner', 'practitioner')
      expect(context.role).toBe('owner')
      expect(context.userId).toBe('user-1')
      expect(context.tenantId).toBe('tenant-1')
    })

    it('redirects to /login when user is not authenticated', async () => {
      mockAuth.mockResolvedValue({
        user: null,
      })

      await expect(requireRole('owner')).rejects.toThrow('REDIRECT:/login')
    })

    it('allows multiple roles and uses the first matching membership', async () => {
      mockAuth.mockResolvedValue({
        user: { id: 'user-2' },
      })

      setupDbMemberships([
        {
          tenantId: 'tenant-2',
          role: 'practitioner',
          fullName: 'Practitioner User',
          email: 'doc@test.com',
        },
      ])

      const context = await requireRole('owner', 'practitioner')
      expect(context.role).toBe('practitioner')
      expect(context.tenantId).toBe('tenant-2')
    })
  })
})
