import { describe, expect, it } from 'vitest'
import { safeCallbackPath } from '@/lib/callback-url'

describe('safeCallbackPath', () => {
  it.each([
    ['/onboarding', '/onboarding'],
    ['/onboarding?utm_source=lifecycle&utm_medium=whatsapp', '/onboarding?utm_source=lifecycle&utm_medium=whatsapp'],
    ['/pacientes?novo=1', '/pacientes?novo=1'],
    ['/signup/clinic-details', '/signup/clinic-details'],
    ['/a/../onboarding', '/onboarding'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeCallbackPath(input)).toBe(expected)
  })

  it.each([
    ['an absolute URL', 'https://evil.example/onboarding'],
    ['a protocol-relative URL', '//evil.example/x'],
    ['a backslash that browsers read as a slash', '/\\evil.example'],
    ['a backslash after the slash', '/\\/evil.example'],
    ['a dot segment hiding a double slash', '/.//evil.example'],
    ['a parent segment hiding a double slash', '/a/..//evil.example'],
    ['an encoded dot segment hiding a double slash', '/%2e//evil.example'],
    ['a tab inside the scheme slashes', '/\t/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a bare path without a leading slash', 'onboarding'],
    ['the login page itself', '/login?callbackUrl=/onboarding'],
    ['the signup page', '/signup'],
    ['the app root', '/'],
    ['an API route', '/api/auth/signout'],
    ['an empty value', ''],
    ['a value that is not a string', 42],
    ['an overlong value', `/${'a'.repeat(3000)}`],
  ])('refuses %s', (_name, input) => {
    expect(safeCallbackPath(input)).toBeNull()
  })
})

describe('safeCallbackPath keeps encoded slashes inside the path', () => {
  it.each(['/%2F%2Fevil.example', '/%5Cevil.example'])('%s stays a same-origin path', (input) => {
    const path = safeCallbackPath(input)
    expect(path).toBe(input)
    expect(new URL(path!, 'https://app.floraclin.com.br').host).toBe('app.floraclin.com.br')
  })
})
