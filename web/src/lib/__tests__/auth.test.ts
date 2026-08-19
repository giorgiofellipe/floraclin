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

// `getAuthContext` attaches the caller to the Sentry scope. Mocked explicitly
// rather than relying on the real SDK no-opping without an initialized client,
// so the assertions below test our call and not an SDK internal.
const setUserMock = vi.fn()
const setTagsMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  setUser: (...args: unknown[]) => setUserMock(...args),
  setTags: (...args: unknown[]) => setTagsMock(...args),
}))

import { db } from '@/db/client'
import { getAuthContext, requireRole } from '@/lib/auth'
import { ForbiddenError } from '@/lib/errors'

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

      // The class is the contract: `handleApiError` answers 403 on
      // `ForbiddenError` and reports anything else to Sentry, so a plain
      // `Error` with the same message would now be a reported 500.
      await expect(requireRole('owner')).rejects.toThrow(ForbiddenError)
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

  describe('Sentry context', () => {
    it('tags the caller and clinic, with ids only', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-9' } })

      setupDbMemberships([
        {
          tenantId: 'tenant-9',
          role: 'receptionist',
          fullName: 'Recep Cionista',
          email: 'recep@clinica.com.br',
        },
      ])

      await getAuthContext()

      expect(setUserMock).toHaveBeenCalledWith({ id: 'user-9' })
      expect(setTagsMock).toHaveBeenCalledWith({
        tenant_id: 'tenant-9',
        role: 'receptionist',
      })

      // sendDefaultPii is off and this is a health product: nothing that
      // names a human may travel with the report.
      const sent = JSON.stringify([setUserMock.mock.calls, setTagsMock.mock.calls])
      expect(sent).not.toContain('Recep Cionista')
      expect(sent).not.toContain('recep@clinica.com.br')
    })
  })
})
