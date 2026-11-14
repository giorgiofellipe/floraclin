'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  cookieConsentStatus,
  openCookiePreferences,
  readCookieConsent,
  saveCookieConsent,
  subscribeCookieConsent,
} from '@/lib/cookie-consent'

const OPEN_COOKIE_PREFERENCES_EVENT = 'floraclin-open-cookie-preferences'

/** How far from the bottom the banner reaches while it shows, as a CSS length; unset otherwise. */
export const COOKIE_BANNER_OFFSET_VAR = '--cookie-banner-offset'
/**
 * The bottom safe-area inset a bar sitting above the banner still has to
 * leave: none, the banner already covers it. Unset while the banner is hidden.
 */
export const COOKIE_BANNER_SAFE_AREA_VAR = '--cookie-banner-safe-area'

/** Recusar and Aceitar todos in the compact row: the same 44px target each, one line. */
const COMPACT_CHOICE_CLASSES = 'min-h-11 px-3 max-sm:whitespace-nowrap sm:min-h-0 sm:px-4'

/**
 * Below sm, on the setup the banner is a single row along the bottom edge, so
 * that it and the pinned action bar above it leave the form room. Elsewhere,
 * and from sm up, it is the floating card.
 */
function isCompactRoute(pathname: string | null): boolean {
  return pathname === '/onboarding' || Boolean(pathname?.startsWith('/onboarding/'))
}

export function CookieConsentBanner() {
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const choice = consentStatus === 'unset' ? null : readCookieConsent()
  const shouldShowBanner = consentStatus === 'unset' && !isPreferencesOpen

  const bannerRef = useRef<HTMLElement>(null)
  const compact = isCompactRoute(usePathname())

  useEffect(() => {
    const banner = bannerRef.current
    if (!shouldShowBanner || !banner) return

    // Bars pinned to the bottom (the onboarding actions) sit above the banner
    // through this variable; otherwise the banner covers "Próximo" on a phone
    // until the cookie choice is made.
    const root = document.documentElement
    const previousPadding = document.body.style.paddingBottom
    const observer = new ResizeObserver(() => {
      const offset = `${window.innerHeight - banner.getBoundingClientRect().top}px`
      document.body.style.paddingBottom = offset
      root.style.setProperty(COOKIE_BANNER_OFFSET_VAR, offset)
      root.style.setProperty(COOKIE_BANNER_SAFE_AREA_VAR, '0px')
    })
    observer.observe(banner)
    return () => {
      observer.disconnect()
      document.body.style.paddingBottom = previousPadding
      root.style.removeProperty(COOKIE_BANNER_OFFSET_VAR)
      root.style.removeProperty(COOKIE_BANNER_SAFE_AREA_VAR)
    }
  }, [shouldShowBanner])

  useEffect(() => {
    function handleOpenPreferences() {
      const latest = readCookieConsent()
      setMarketing(latest?.marketing ?? false)
      setIsPreferencesOpen(true)
    }

    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpenPreferences)
    return () => {
      window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpenPreferences)
    }
  }, [])

  function persist(nextMarketing: boolean) {
    const next = saveCookieConsent(nextMarketing)
    setMarketing(next.marketing)
    setIsPreferencesOpen(false)
  }

  function showPreferences() {
    setMarketing(choice?.marketing ?? false)
    setIsPreferencesOpen(true)
  }

  return (
    <>
      {shouldShowBanner && (
        <section
          ref={bannerRef}
          aria-label="Aviso de cookies"
          // 0.75rem (1rem from sm) from the edges, plus the notch /
          // home-indicator insets (viewport-fit=cover).
          className={cn(
            'fixed right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.75rem+var(--bottom-nav-h)+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] z-50 mx-auto max-w-4xl rounded-xl border border-sage/20 bg-cream/95 p-3 shadow-2xl backdrop-blur sm:right-[calc(1rem+env(safe-area-inset-right))] sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:left-[calc(1rem+env(safe-area-inset-left))] sm:rounded-2xl sm:p-4 md:flex md:items-center md:gap-5',
            // Compact: edge to edge, one row, the home indicator inside it.
            compact &&
              'right-0 bottom-0 left-0 flex items-center gap-2 rounded-none border-x-0 border-b-0 pt-2 pr-[calc(0.75rem+env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:block sm:border-x sm:border-b sm:shadow-2xl md:flex',
          )}
          data-compact={compact || undefined}
        >
          <div
            className={cn(
              'flex-1 text-xs leading-snug text-mid sm:text-sm sm:leading-relaxed',
              compact && 'text-[11px] max-sm:min-w-0',
            )}
          >
            <p className={cn('font-medium text-charcoal', compact && 'sr-only sm:not-sr-only')}>Cookies</p>
            <p className={cn('mt-1 sm:hidden', compact && 'mt-0')}>
              Meta Pixel só com sua autorização. Cadastros e assinaturas são informados à Meta pelo nosso servidor.{' '}
              <button type="button" onClick={showPreferences} className="text-sage underline underline-offset-2">
                Ver detalhes
              </button>
              {' · '}
              <Link href="https://floraclin.com.br/privacidade" className="text-sage underline underline-offset-2">
                Privacidade
              </Link>
              .
            </p>
            <p className="mt-1 hidden sm:block">
              Usamos cookies necessários para o app funcionar. Com sua autorização, também usamos o Meta Pixel para
              medir anúncios. Independentemente da sua escolha, registramos a origem do seu acesso e, se você se
              cadastrar ou assinar, informamos o cadastro e a assinatura à Meta pelo nosso servidor, com e-mail em
              hash. Você pode se opor por
              e-mail. Veja a{' '}
              <Link href="https://floraclin.com.br/privacidade" className="text-sage underline underline-offset-2">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>
          {/* Recusar and Aceitar todos share one size and weight class at every
              width (LGPD: refusing is as easy as accepting). Compact, the two
              columns are equal and each is a 44px target. */}
          <div className={cn('mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:flex md:mt-0', compact && 'mt-0 max-sm:shrink-0')}>
            <button
              type="button"
              onClick={() => persist(false)}
              className={cn(
                'rounded-full border border-sage/25 px-4 py-2 text-sm text-charcoal transition hover:bg-sage/10',
                compact && COMPACT_CHOICE_CLASSES,
              )}
            >
              Recusar
            </button>
            <button
              type="button"
              onClick={showPreferences}
              className="hidden rounded-full border border-sage/25 px-4 py-2 text-sm text-charcoal transition hover:bg-sage/10 sm:block"
            >
              Preferências
            </button>
            <button
              type="button"
              onClick={() => persist(true)}
              className={cn(
                'rounded-full bg-forest px-4 py-2 text-sm text-cream transition hover:bg-sage',
                compact && COMPACT_CHOICE_CLASSES,
              )}
            >
              Aceitar todos
            </button>
          </div>
        </section>
      )}

      {isPreferencesOpen && (
        // Bottom-anchored on mobile: the 1rem gap grows by the notch /
        // home-indicator insets (viewport-fit=cover).
        <div className="fixed inset-0 z-50 flex items-end bg-charcoal/35 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:justify-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-preferences-title"
            className="max-h-[calc(100svh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto rounded-2xl border border-sage/15 bg-cream p-5 shadow-2xl sm:p-6"
          >
            <h2 id="cookie-preferences-title" className="font-display text-2xl text-charcoal">
              Preferências de cookies
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-mid">
              Você pode alterar sua escolha a qualquer momento. Cookies necessários ficam sempre ativos para
              segurança, autenticação e funcionamento do serviço.
            </p>

            <div className="mt-6 space-y-4">
              <label className="flex gap-3 rounded-xl border border-sage/15 bg-white/70 p-4">
                <input type="checkbox" checked readOnly className="mt-1 accent-sage" />
                <span>
                  <span className="block text-sm font-medium text-charcoal">Necessários</span>
                  <span className="mt-1 block text-sm text-mid">
                    Login, segurança, preferências essenciais e estabilidade do app.
                  </span>
                </span>
              </label>

              <label className="flex gap-3 rounded-xl border border-sage/15 bg-white/70 p-4">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(event) => setMarketing(event.target.checked)}
                  className="mt-1 accent-sage"
                />
                <span>
                  <span className="block text-sm font-medium text-charcoal">Anúncios e medição</span>
                  <span className="mt-1 block text-sm text-mid">
                    Meta Pixel no navegador para medir campanhas. Recusar desliga o Pixel. O registro da origem do acesso e o envio do cadastro e da assinatura pelo nosso servidor seguem o interesse legítimo, e você pode se opor a eles pelo e-mail contato@floraclin.com.br (veja a Política de Privacidade, seção 8).
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {choice && (
                <button
                  type="button"
                  onClick={() => setIsPreferencesOpen(false)}
                  className="rounded-full border border-sage/25 px-4 py-2 text-sm text-charcoal transition hover:bg-sage/10"
                >
                  Cancelar
                </button>
              )}
              <button
                type="button"
                onClick={() => persist(marketing)}
                className="rounded-full bg-forest px-4 py-2 text-sm text-cream transition hover:bg-sage"
              >
                Salvar preferências
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export function CookiePreferencesLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openCookiePreferences} className={className}>
      Preferências de cookies
    </button>
  )
}
