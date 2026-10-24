import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLastLogin, rememberLastLogin } from '../last-login'

const jar = new Map<string, { value: string; options: Record<string, unknown> }>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}))

beforeEach(() => jar.clear())

describe('last login option', () => {
  it.each([
    ['google', 'google'],
    ['credentials', 'email'],
  ] as const)('a %s sign-in marks %s', async (provider, option) => {
    await rememberLastLogin(provider)
    expect(await readLastLogin()).toBe(option)
  })

  it('a magic-link sign-in keeps the option remembered before it', async () => {
    await rememberLastLogin('google')
    await rememberLastLogin('resend')
    expect(await readLastLogin()).toBe('google')
  })

  it('is only sent to the login page', async () => {
    await rememberLastLogin('google')
    expect([...jar.values()][0].options.path).toBe('/login')
  })
})
