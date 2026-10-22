'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/components/auth/google-icon'
import { CALLBACK_URL_PARAM } from '@/lib/callback-url'
import { chromeIntentUrl, IN_APP_BROWSER_PLACE, type InAppBrowser } from '@/lib/in-app-browser'

type Props = {
  action: (formData: FormData) => void | Promise<void>
  label: string
  inAppBrowser: InAppBrowser | null
  callbackUrl?: string | null
  /** What to do instead of Google, shown under the in-app browser notice. */
  emailFallback: string
}

function GoogleForm({ action, callbackUrl, children }: Pick<Props, 'action' | 'callbackUrl'> & { children: React.ReactNode }) {
  return (
    <form action={action}>
      {callbackUrl && <input type="hidden" name={CALLBACK_URL_PARAM} value={callbackUrl} />}
      {children}
    </form>
  )
}

/**
 * The Google button, or, inside an app's embedded browser where Google
 * refuses to sign anyone in (403 disallowed_useragent), a notice that gets the
 * person into a real browser first.
 */
export function GoogleSignIn({ action, label, inAppBrowser, callbackUrl, emailFallback }: Props) {
  if (!inAppBrowser) {
    return (
      <GoogleForm action={action} callbackUrl={callbackUrl}>
        <Button type="submit" variant="outline" className="w-full h-11 border-sage/20 rounded-lg" data-testid="google-sign-in">
          <GoogleIcon /> {label}
        </Button>
      </GoogleForm>
    )
  }
  return (
    <InAppBrowserNotice inAppBrowser={inAppBrowser} emailFallback={emailFallback}>
      <GoogleForm action={action} callbackUrl={callbackUrl}>
        <button type="submit" className="text-xs text-mid underline underline-offset-2" data-testid="google-sign-in-anyway">
          Tentar com Google mesmo assim
        </button>
      </GoogleForm>
    </InAppBrowserNotice>
  )
}

const noSubscribe = () => () => {}

function InAppBrowserNotice({
  inAppBrowser,
  emailFallback,
  children,
}: {
  inAppBrowser: InAppBrowser
  emailFallback: string
  children: React.ReactNode
}) {
  // Read on the client only: the server renders the notice without the
  // address, and the Android button appears once it is known.
  const href = useSyncExternalStore(noSubscribe, () => window.location.href, () => null)
  const intentUrl = href ? chromeIntentUrl(href, inAppBrowser.os) : null
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const browser = BROWSER_BY_OS[inAppBrowser.os]

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 space-y-3" role="note" data-testid="in-app-browser-notice">
      <p className="text-sm font-medium text-charcoal">Para entrar com Google, abra no {browser}</p>
      <p className="text-sm text-mid">
        O Google não permite login dentro {IN_APP_BROWSER_PLACE[inAppBrowser.app]}. Abra esta página no {browser} para continuar.
      </p>
      <div className="flex flex-col gap-2">
        {intentUrl && (
          <a
            href={intentUrl}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-forest px-4 text-sm font-medium text-cream"
            data-testid="open-in-chrome"
          >
            Abrir no Chrome
          </a>
        )}
        <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={copyLink} data-testid="copy-link">
          {copied === 'yes' ? 'Link copiado' : 'Copiar link'}
        </Button>
      </div>
      <div aria-live="polite">
        {copied === 'yes' && <p className="text-xs text-mid">Agora cole o link no {browser}.</p>}
        {copied === 'failed' && href && (
          <p className="text-xs text-mid break-all">
            Copie este endereço e cole no {browser}: <span className="font-mono select-all">{href}</span>
          </p>
        )}
      </div>
      <p className="text-xs text-mid">{STEPS_BY_OS[inAppBrowser.os]}</p>
      <p className="text-sm text-charcoal" data-testid="in-app-email-fallback">{emailFallback}</p>
      {children}
    </div>
  )
}

const BROWSER_BY_OS: Record<InAppBrowser['os'], string> = {
  android: 'Chrome',
  ios: 'Safari',
  other: 'Chrome ou no Safari',
}

const STEPS_BY_OS: Record<InAppBrowser['os'], string> = {
  android: 'Ou toque em ⋮ no canto da tela e escolha “Abrir no Chrome” ou “Abrir no navegador”.',
  ios: 'Ou toque em ••• ou no ícone de compartilhar e escolha “Abrir no Safari” ou “Abrir no navegador externo”.',
  other: 'Ou abra o menu do aplicativo e escolha “Abrir no navegador”.',
}
