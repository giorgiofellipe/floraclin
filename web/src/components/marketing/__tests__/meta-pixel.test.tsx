import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/dashboard', search: '' }))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('next/script', () => ({ default: () => null }))
vi.mock('@/lib/cookie-consent', () => ({
  cookieConsentStatus: () => 'granted',
  subscribeCookieConsent: () => () => {},
}))
vi.mock('@/lib/marketing-attribution', () => ({
  DEFAULT_META_PIXEL_ID: 'pixel-1',
  trackMetaEvent: vi.fn(),
}))

import { trackMetaEvent } from '@/lib/marketing-attribution'
import { MetaPixel } from '../meta-pixel'

function navigate(rerender: (ui: React.ReactElement) => void, pathname: string, search: string) {
  nav.pathname = pathname
  nav.search = search
  rerender(<MetaPixel />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MetaPixel PageView on client navigations', () => {
  // Catches the second PageView sent when a page drops its one-shot param from the URL.
  it.each([
    ['email_confirmed', '/onboarding', 'email_confirmed=1&meta_event_id=abc', 'meta_event_id=abc'],
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
