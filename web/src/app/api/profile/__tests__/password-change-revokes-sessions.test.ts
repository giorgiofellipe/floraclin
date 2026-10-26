import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sessions signed in before `passwordChangedAt` are rejected, so both ways of
 * setting a password have to stamp it, and the user who changed it must get a
 * fresh session instead of being signed out by their own change.
 */

const { setMock, signInMock } = vi.hoisted(() => ({ setMock: vi.fn(), signInMock: vi.fn() }))

vi.mock('@/db/client', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'update', 'delete', 'where']) chain[m] = vi.fn(() => chain)
  chain.limit = vi.fn(async () => [{ passwordHash: null }])
  chain.returning = vi.fn(async () => [{ expires: new Date(Date.now() + 60_000) }])
  chain.set = vi.fn((values: unknown) => {
    setMock(values)
    return chain
  })
  return { db: chain }
})
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ userId: 'u1', email: 'dona@clinica.com.br' })),
}))
vi.mock('@/lib/auth-config', () => ({ signIn: signInMock }))

import { PUT as changePassword } from '../password/route'
import { POST as confirmReset } from '../reset-confirm/route'

function json(body: unknown) {
  return new Request('http://localhost/api/profile', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  setMock.mockClear()
  signInMock.mockReset().mockResolvedValue('/')
})

describe('setting a password', () => {
  it('through the reset link stamps the change time', async () => {
    const res = await confirmReset(json({ token: 't', email: 'dona@clinica.com.br', newPassword: 'nova-senha-1' }))

    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ passwordChangedAt: expect.any(Date) }))
  })

  it('from settings stamps the change time and signs the caller back in', async () => {
    const res = await changePassword(json({ newPassword: 'nova-senha-1' }))

    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ passwordChangedAt: expect.any(Date) }))
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'dona@clinica.com.br',
      password: 'nova-senha-1',
      redirect: false,
    })
  })

  it('from settings still succeeds when the fresh sign-in fails', async () => {
    signInMock.mockRejectedValue(new Error('CredentialsSignin'))

    const res = await changePassword(json({ newPassword: 'nova-senha-1' }))

    expect(res.status).toBe(200)
  })
})
