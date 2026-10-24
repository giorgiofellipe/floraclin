import { describe, expect, it } from 'vitest'
import { loginFailureFromAuthError, pickEventProperties } from '../events'
import { sanitizeEventProperties, sanitizeUrl } from '../sanitize'

describe('pickEventProperties', () => {
  it('drops every key the dictionary does not list for the event', () => {
    const picked = pickEventProperties('login_failed', {
      method: 'email',
      reason: 'invalid_credentials',
      in_app_browser: true,
      in_app_browser_name: 'instagram',
      email: 'ana@example.com',
      password: 'hunter22',
    })
    expect(picked).toEqual({ method: 'email', reason: 'invalid_credentials', in_app_browser: true, in_app_browser_name: 'instagram' })
  })

  it('keeps field names in validation errors and drops anything shaped like a value', () => {
    const picked = pickEventProperties('onboarding_step_validation_error', {
      step_index: 0,
      step_name: 'clinic',
      fields: ['name', 'phone', 'address.city', 'Clínica da Ana', 'ana@example.com', '(11) 99999-9999', 42, 'name'],
    })
    expect(picked).toEqual({ step_index: 0, step_name: 'clinic', fields: ['name', 'phone', 'address.city'] })
  })

  it('ignores nested objects and non-finite numbers', () => {
    const picked = pickEventProperties('onboarding_completed', {
      procedure_types_count: Number.NaN,
      products_count: { name: 'Botox' },
    })
    expect(picked).toEqual({})
  })
})

describe('sanitizeUrl', () => {
  it('keeps only UTM parameters', () => {
    expect(
      sanitizeUrl('https://app.floraclin.com.br/api/auth/confirm?email=ana%40example.com&token=abc&code=xyz&utm_source=ig&utm_campaign=launch'),
    ).toBe('https://app.floraclin.com.br/api/auth/confirm?utm_source=ig&utm_campaign=launch')
  })

  it('masks ids in the path and drops the fragment', () => {
    expect(sanitizeUrl('https://app.floraclin.com.br/pacientes/3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f#notes')).toBe(
      'https://app.floraclin.com.br/pacientes/:id',
    )
  })
})

describe('sanitizeEventProperties', () => {
  it('scrubs URL properties, including the initial ones posthog-js sets on the person', () => {
    const out = sanitizeEventProperties({
      $current_url: 'https://app.floraclin.com.br/reset-password?token=live&email=a%40b.com',
      $referrer: '$direct',
      title: 'Ana Souza | FloraClin',
      $set_once: { $initial_current_url: 'https://app.floraclin.com.br/login?email=a%40b.com&utm_medium=cpc' },
    })
    expect(out).toEqual({
      $current_url: 'https://app.floraclin.com.br/reset-password',
      $referrer: '$direct',
      $set_once: { $initial_current_url: 'https://app.floraclin.com.br/login?utm_medium=cpc' },
    })
  })
})

describe('loginFailureFromAuthError', () => {
  it.each([
    ['CredentialsSignin', { method: 'email', reason: 'invalid_credentials' }],
    ['AccessDenied', { method: 'google', reason: 'access_denied' }],
    ['Verification', { method: 'magic_link', reason: 'magic_link_expired' }],
    // A crafted or new ?error= must not be counted as a Google failure.
    ['SomethingNew', null],
    [undefined, null],
  ])('%s → %o', (error, expected) => {
    expect(loginFailureFromAuthError(error)).toEqual(expected)
  })
})
