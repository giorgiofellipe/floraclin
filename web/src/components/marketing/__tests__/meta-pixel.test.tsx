import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/dashboard', search: '' }))
const consent = vi.hoisted(() => ({ status: 'granted' as 'unset' | 'granted' | 'denied' }))
const scripts = vi.hoisted(() => [] as string[])

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('next/script', () => ({
  default: ({ children }: { children: string }) => {
    scripts.push(children)
    return null
  },
}))
vi.mock('@/lib/cookie-consent', () => ({
  cookieConsentStatus: () => consent.status,
  subscribeCookieConsent: () => () => {},
}))
vi.mock('@/lib/marketing-attribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/marketing-attribution')>()),
  DEFAULT_META_PIXEL_ID: 'pixel-1',
  trackMetaEvent: vi.fn(),
}))

import { trackMetaEvent } from '@/lib/marketing-attribution'
import { MetaPixel, isClinicBookingPath } from '../meta-pixel'

function navigate(rerender: (ui: React.ReactElement) => void, pathname: string, search: string) {
  nav.pathname = pathname
  nav.search = search
  rerender(<MetaPixel />)
}

beforeEach(() => {
  vi.clearAllMocks()
  consent.status = 'granted'
  scripts.length = 0
})

describe('MetaPixel PageView on client navigations', () => {
  // Catches the second PageView sent when a page drops its one-shot param from the URL.
  it.each([
    ['email_confirmed', '/onboarding', 'email_confirmed=1&utm_source=ig', 'utm_source=ig'],
    ['meta_event_id', '/onboarding', 'meta_event_id=abc&utm_source=ig', 'utm_source=ig'],
    ['primeiro_paciente', '/dashboard', 'primeiro_paciente=1', ''],
  ])('sends none when only %s was dropped from the URL', (_param, pathname, before, after) => {
    nav.pathname = pathname
    nav.search = before
    const { rerender } = render(<MetaPixel />)

    navigate(rerender, pathname, after)

    expect(trackMetaEvent).not.toHaveBeenCalled()
  })

  it('sends one for a new path or a change of any other param', () => {
    nav.pathname = '/dashboard'
    nav.search = 'primeiro_paciente=1'
    const { rerender } = render(<MetaPixel />)

    navigate(rerender, '/pacientes', '')
    navigate(rerender, '/pacientes', 'page=2')

    expect(trackMetaEvent).toHaveBeenCalledTimes(2)
    expect(trackMetaEvent).toHaveBeenCalledWith('PageView')
  })
})

describe('MetaPixel on public clinic booking pages', () => {
  it('matches only /c and its sub-paths', () => {
    expect(isClinicBookingPath('/c')).toBe(true)
    expect(isClinicBookingPath('/c/dra-micaela-floriani')).toBe(true)
    expect(isClinicBookingPath('/configuracoes')).toBe(false)
    expect(isClinicBookingPath('/cadastro')).toBe(false)
    expect(isClinicBookingPath('/')).toBe(false)
  })

  // Catches the platform pixel being initialised for a clinic's patients on a direct load.
  it('loads no platform pixel on a direct load with consent granted', () => {
    nav.pathname = '/c/dra-micaela-floriani'
    nav.search = 'utm_source=ig'

    const { container } = render(<MetaPixel />)

    expect(scripts).toEqual([])
    expect(container.innerHTML).toBe('')
    expect(trackMetaEvent).not.toHaveBeenCalled()
  })

  it('loads the platform pixel on app pages with consent granted', () => {
    nav.pathname = '/dashboard'
    nav.search = ''

    render(<MetaPixel />)

    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain("fbq('init', 'pixel-1')")
  })

  // Catches a platform PageView sent when the app navigates client-side into a booking page.
  it('sends no platform PageView when navigating into a booking page', () => {
    nav.pathname = '/configuracoes'
    nav.search = ''
    const { rerender } = render(<MetaPixel />)

    navigate(rerender, '/c/dra-micaela-floriani', '')
    navigate(rerender, '/c/dra-micaela-floriani', 'utm_source=ig')

    expect(trackMetaEvent).not.toHaveBeenCalled()
  })

  it('still sends a PageView when navigating from a booking page back to the app', () => {
    nav.pathname = '/configuracoes'
    nav.search = ''
    const { rerender } = render(<MetaPixel />)

    navigate(rerender, '/c/dra-micaela-floriani', '')
    navigate(rerender, '/dashboard', '')

    expect(trackMetaEvent).toHaveBeenCalledTimes(1)
    expect(trackMetaEvent).toHaveBeenCalledWith('PageView')
  })

  it.each(['unset', 'denied'] as const)('loads nothing anywhere when consent is %s', (status) => {
    consent.status = status
    nav.pathname = '/dashboard'
    nav.search = ''
    const { rerender } = render(<MetaPixel />)

    navigate(rerender, '/c/dra-micaela-floriani', '')
    navigate(rerender, '/pacientes', '')

    expect(scripts).toEqual([])
    expect(trackMetaEvent).not.toHaveBeenCalled()
  })
})
