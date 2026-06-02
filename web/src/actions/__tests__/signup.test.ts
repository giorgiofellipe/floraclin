import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

vi.mock('next-auth', () => {
  class AuthError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'AuthError'
    }
  }
  return { AuthError }
})

vi.mock('@/lib/auth-config', () => ({
  signIn: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn((fn: any) => fn({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'tenant-1', name: 'Test Clinic', slug: 'test-clinic' }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
  })),
}))

vi.mock('@/db/queries/admin-tenants', () => ({
  createSelfSignupTenant: vi.fn(() => ({ id: 'tenant-1', name: 'Test Clinic' })),
}))

vi.mock('@/lib/email', () => ({
  sendNewSignupNotification: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(() => 'hashed-password') },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('signUp action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects empty form data', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    const result = await signUp(null, formData)
    expect(result?.error).toBeDefined()
  })

  it('rejects invalid email', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'not-email')
    formData.set('password', 'secure123')
    formData.set('clinicName', 'Test')
    formData.set('phone', '11999998888')
    const result = await signUp(null, formData)
    expect(result?.error?.email).toBeDefined()
  })

  it('rejects short password', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'maria@test.com')
    formData.set('password', '1234567')
    formData.set('clinicName', 'Test')
    formData.set('phone', '11999998888')
    const result = await signUp(null, formData)
    expect(result?.error?.password).toBeDefined()
  })

  it('rejects phone shorter than 10 chars', async () => {
    const { signUp } = await import('../signup')
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'maria@test.com')
    formData.set('password', 'secure123')
    formData.set('clinicName', 'Test Clinic')
    formData.set('phone', '123456789')
    const result = await signUp(null, formData)
    expect(result?.error?.phone).toBeDefined()
  })
})
