/**
 * On a full page load the page's effects run before anything rendered after
 * it. sonner's Toaster only shows toasts sent after it subscribes, so a page
 * that toasts on mount ("E-mail confirmado.") needs the Toaster ahead of it in
 * the root layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('next/font/google', () => ({
  Jost: () => ({ variable: 'font-jost' }),
  Cormorant_Garamond: () => ({ variable: 'font-cormorant' }),
}))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'pt-BR',
  getMessages: async () => ({}),
}))
vi.mock('next-intl', () => ({ NextIntlClientProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('next-auth/react', () => ({ SessionProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/marketing/meta-pixel', () => ({ MetaPixel: () => null }))
vi.mock('@/components/marketing/cookie-consent-banner', () => ({ CookieConsentBanner: () => null }))
vi.mock('@/app/globals.css', () => ({}))

import RootLayout from '../layout'
import { EmailConfirmedToast } from '@/components/layout/email-confirmed-toast'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('root layout', () => {
  it('shows a toast a page sends from its first effect', async () => {
    // jsdom has no matchMedia; sonner reads it for the color scheme.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    window.history.replaceState(null, '', '/onboarding?email_confirmed=1')
    const tree = await RootLayout({ children: <EmailConfirmedToast show /> })

    render(tree, { container: document })

    expect(await screen.findByText('E-mail confirmado.')).toBeInTheDocument()
  })
})
