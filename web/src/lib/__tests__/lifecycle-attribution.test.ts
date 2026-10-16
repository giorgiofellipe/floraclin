import { describe, expect, it } from 'vitest'
import {
  addLifecycleUtmParams,
  isAllowedLifecycleDestination,
  lifecycleClickUrl,
  lifecycleDestination,
} from '@/lib/lifecycle-attribution'

describe('lifecycle attribution URLs', () => {
  it('decorates destinations with lifecycle UTM params and the send id', () => {
    const decorated = addLifecycleUtmParams(new URL('https://app.floraclin.com.br/dashboard'), {
      sendId: 'send-1',
      messageKey: 'trial_welcome',
      channel: 'email',
    })

    expect(decorated.searchParams.get('utm_source')).toBe('lifecycle')
    expect(decorated.searchParams.get('utm_medium')).toBe('email')
    expect(decorated.searchParams.get('utm_campaign')).toBe('trial_welcome')
    expect(decorated.searchParams.get('lc')).toBe('send-1')
  })

  it('builds a click redirect URL whose destination is also decorated', () => {
    const href = lifecycleClickUrl(
      {
        sendId: 'send-1',
        messageKey: 'trial_first_patient',
        channel: 'email',
        destination: '/pacientes?novo=1',
      },
      'https://app.floraclin.com.br',
    )

    const click = new URL(href)
    const destination = new URL(click.searchParams.get('to')!)

    expect(click.pathname).toBe('/api/lifecycle/click')
    expect(click.searchParams.get('lc')).toBe('send-1')
    expect(destination.toString()).toBe(
      'https://app.floraclin.com.br/pacientes?novo=1&utm_source=lifecycle&utm_medium=email&utm_campaign=trial_first_patient&lc=send-1',
    )
  })

  it('rejects destinations outside FloraClin hosts', () => {
    expect(isAllowedLifecycleDestination(new URL('https://app.floraclin.com.br/dashboard'))).toBe(true)
    expect(isAllowedLifecycleDestination(new URL('https://floraclin.com.br/'))).toBe(true)
    expect(() => lifecycleDestination('https://evil.example/phish')).toThrow(/not allowed/)
  })
})
