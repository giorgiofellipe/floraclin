import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import '@/tests/mocks/db'
import { db } from '@/db/client'
import { signIn } from '@/lib/auth-config'
import { redirect } from 'next/navigation'

const { tenantInsertSpy, issueConfirmationTokenMock, sendConfirmationEmailMock } = vi.hoisted(() => ({
  tenantInsertSpy: vi.fn(),
  issueConfirmationTokenMock: vi.fn(),
  sendConfirmationEmailMock: vi.fn(),
}))

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
      values: vi.fn((vals: Record<string, unknown>) => {
        tenantInsertSpy(vals)
        return {
          returning: vi.fn(() => [{ id: 'tenant-1', name: 'Test Clinic', slug: 'test-clinic', ...vals }]),
        }
      }),
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
  generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
}))

vi.mock('@/lib/email', () => ({
  sendNewSignupNotification: vi.fn(),
  sendConfirmationEmail: sendConfirmationEmailMock,
}))

vi.mock('@/lib/confirm-email', () => ({
  issueConfirmationToken: issueConfirmationTokenMock,
}))

vi.mock('@/lib/app-url', () => ({
  getAppUrl: () => 'https://app.floraclin.com.br',
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(() => 'hashed-password') },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('signUp action', () => {
  // The first import of the signup module pulls in db/auth/tenant/email and can take a few
  // seconds. Loading it once here keeps that one-time cost out of any single test's timeout,
  // which otherwise flakes under full-suite load.
  let signUp: (typeof import('../signup'))['signUp']

  beforeAll(async () => {
    signUp = (await import('../signup')).signUp
  }, 30000)

  beforeEach(() => {
    vi.clearAllMocks()

    // The existing-user check and the free-plan lookup share this shape
    // (select -> from -> where -> limit). Resolving to an empty array covers
    // both: no user with this email exists yet, and no free plan is found,
    // which keeps createSubscription out of these tests entirely.
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any)

    issueConfirmationTokenMock.mockResolvedValue('raw-token-abc')
    sendConfirmationEmailMock.mockResolvedValue(undefined)
  })

  function validFormData(overrides: Record<string, string> = {}) {
    const formData = new FormData()
    formData.set('fullName', overrides.fullName ?? 'Maria Silva')
    formData.set('email', overrides.email ?? 'maria@test.com')
    formData.set('password', overrides.password ?? 'secure123')
    formData.set('clinicName', overrides.clinicName ?? 'Clínica Test')
    formData.set('phone', overrides.phone ?? '11999998888')
    return formData
  }

  it('rejects empty form data', async () => {
    const formData = new FormData()
    const result = await signUp(null, formData)
    expect(result?.error).toBeDefined()
  })

  it('rejects invalid email', async () => {
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
    const formData = new FormData()
    formData.set('fullName', 'Maria')
    formData.set('email', 'maria@test.com')
    formData.set('password', 'secure123')
    formData.set('clinicName', 'Test Clinic')
    formData.set('phone', '123456789')
    const result = await signUp(null, formData)
    expect(result?.error?.phone).toBeDefined()
  })

  it('creates the tenant with status active', async () => {
    await signUp(null, validFormData({ email: 'active@test.com' }))

    const tenantCall = tenantInsertSpy.mock.calls.find(([vals]) => 'status' in vals)
    expect(tenantCall?.[0]).toMatchObject({ status: 'active' })
  })

  it('issues a confirmation token and sends the confirmation email', async () => {
    await signUp(null, validFormData({ email: 'token@test.com', clinicName: 'Clínica Flor' }))

    expect(issueConfirmationTokenMock).toHaveBeenCalledWith('token@test.com')
    expect(sendConfirmationEmailMock).toHaveBeenCalledWith(
      'token@test.com',
      expect.stringContaining('raw-token-abc'),
      'Clínica Flor',
    )
    const [, confirmUrl] = sendConfirmationEmailMock.mock.calls[0]
    expect(confirmUrl).toContain('/api/auth/confirm')
  })

  it('still reaches /confirm-email when the confirmation email fails to send', async () => {
    // The rows are already committed by this point. If a Resend failure
    // escaped, the account would exist, be unregisterable because the email
    // is taken, and have no way to ask for a resend.
    sendConfirmationEmailMock.mockRejectedValueOnce(new Error('Resend is down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await signUp(null, validFormData({ email: 'send-fails@test.com' }))

    expect(vi.mocked(redirect).mock.calls.at(-1)?.[0]).toContain('/confirm-email')

    consoleErrorSpy.mockRestore()
  })

  it('never signs the new account in', async () => {
    // Double opt-in is only real if an unconfirmed account has no session.
    // Middleware lets every /api request through before it checks
    // emailVerified, so a session here would make the whole API reachable
    // without ever opening the email.
    await signUp(null, validFormData({ email: 'nosession@test.com' }))

    expect(signIn).not.toHaveBeenCalled()
  })

  it('redirects to /confirm-email carrying the address, never to /pending-approval', async () => {
    await signUp(null, validFormData({ email: 'redirect@test.com' }))

    const target = vi.mocked(redirect).mock.calls.at(-1)?.[0] as string
    expect(target).toContain('/confirm-email')
    // The page has no session to read the address from now, so it rides in
    // the query string.
    expect(target).toContain('redirect%40test.com')
    expect(target).not.toContain('/pending-approval')
  })
})
