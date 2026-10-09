'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  cookieConsentStatus,
  openCookiePreferences,
  readCookieConsent,
  saveCookieConsent,
  subscribeCookieConsent,
} from '@/lib/cookie-consent'

const OPEN_COOKIE_PREFERENCES_EVENT = 'floraclin-open-cookie-preferences'

export function CookieConsentBanner() {
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const choice = consentStatus === 'unset' ? null : readCookieConsent()
  const shouldShowBanner = consentStatus === 'unset' && !isPreferencesOpen

  useEffect(() => {
    if (!shouldShowBanner) return

    const previousPadding = document.body.style.paddingBottom
    const media = window.matchMedia('(max-width: 767px)')
    const applyPadding = () => {
      document.body.style.paddingBottom = media.matches ? '7rem' : previousPadding
    }

    applyPadding()
    media.addEventListener('change', applyPadding)
    return () => {
      media.removeEventListener('change', applyPadding)
      document.body.style.paddingBottom = previousPadding
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
          aria-label="Aviso de cookies"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[30svh] max-w-4xl overflow-y-auto rounded-xl border border-sage/20 bg-cream/95 p-3 shadow-2xl backdrop-blur sm:inset-x-4 sm:bottom-4 sm:max-h-none sm:rounded-2xl sm:p-4 md:flex md:items-center md:gap-5"
        >
          <div className="flex-1 text-xs leading-snug text-mid sm:text-sm sm:leading-relaxed">
            <p className="font-medium text-charcoal">Cookies</p>
            <p className="mt-1 sm:hidden">
              Anúncios e medição só com sua autorização.{' '}
              <button type="button" onClick={showPreferences} className="text-sage underline underline-offset-2">
                Ver detalhes
              </button>
              .
            </p>
            <p className="mt-1 hidden sm:block">
              Usamos cookies necessários para o app funcionar. Com sua autorização, também usamos Meta Pixel e
              dados de campanha para medir anúncios e melhorar nossas comunicações. Veja a{' '}
              <Link href="https://floraclin.com.br/privacidade" className="text-sage underline underline-offset-2">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:flex sm:flex-row md:mt-0">
            <button
              type="button"
              onClick={() => persist(false)}
              className="rounded-full border border-sage/25 px-4 py-2 text-sm text-charcoal transition hover:bg-sage/10"
            >
              Recusar
            </button>
            <button
              type="button"
              onClick={showPreferences}
              className="col-span-2 rounded-full border border-sage/25 px-4 py-2 text-sm text-charcoal transition hover:bg-sage/10 sm:col-span-1"
            >
              Preferências
            </button>
            <button
              type="button"
              onClick={() => persist(true)}
              className="rounded-full bg-forest px-4 py-2 text-sm text-cream transition hover:bg-sage"
            >
              Aceitar todos
            </button>
          </div>
        </section>
      )}

      {isPreferencesOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-charcoal/35 p-4 backdrop-blur-sm sm:items-center sm:justify-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-preferences-title"
            className="max-h-[calc(100svh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-sage/15 bg-cream p-5 shadow-2xl sm:p-6"
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
                    Meta Pixel, medição de campanhas e captura de UTM/fbclid/gclid para atribuição de cadastro.
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
