'use client'

import { useId, useRef, useState, useSyncExternalStore } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { GoogleIcon } from '@/components/auth/google-icon'
import { CALLBACK_URL_PARAM } from '@/lib/callback-url'
import { chromeIntentUrl, IN_APP_BROWSER_PLACE, type InAppBrowser } from '@/lib/in-app-browser'

type Props = {
  action: (formData: FormData) => void | Promise<void>
  inAppBrowser: InAppBrowser | null
  callbackUrl?: string | null
  /** The secondary way in offered by the modal, e.g. "Entrar com e-mail e senha". */
  emailFallbackLabel: string
  /** Shown under it, e.g. how a Google-only account gets a password. */
  emailFallbackHint?: string
  /** Focused when the person picks the email route. */
  emailInputId: string
  /** Each tap on the Google button, including one that only opens the in-app browser modal. */
  onAttempt?: () => void
  describedBy?: string
}

const GOOGLE_LABEL = 'Continuar com Google'

/**
 * The Google button. Inside an app's embedded browser, where Google refuses
 * to sign anyone in (403 disallowed_useragent), tapping it opens a modal that
 * gets the person into a real browser or onto email and password, instead of
 * sending them to Google's error page. Nothing is shown before the tap.
 */
export function GoogleSignIn({ action, inAppBrowser, callbackUrl, emailFallbackLabel, emailFallbackHint, emailInputId, onAttempt, describedBy }: Props) {
  const formId = useId()
  const googleButtonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  // In an in-app browser the button is type="button" and does nothing until
  // hydration attaches the handler. A dead early tap beats Google's 403 page.
  return (
    <>
      <form action={action} id={formId}>
        {callbackUrl && <input type="hidden" name={CALLBACK_URL_PARAM} value={callbackUrl} />}
        <Button
          ref={googleButtonRef}
          type={inAppBrowser ? 'button' : 'submit'}
          onClick={() => {
            onAttempt?.()
            if (inAppBrowser) setOpen(true)
          }}
          variant="outline"
          className="w-full h-11 border-sage/20 rounded-lg"
          aria-describedby={describedBy}
          data-testid="google-sign-in"
        >
          <GoogleIcon /> {GOOGLE_LABEL}
        </Button>
      </form>
      {inAppBrowser && (
        <InAppBrowserDialog
          open={open}
          onOpenChange={setOpen}
          inAppBrowser={inAppBrowser}
          emailFallbackLabel={emailFallbackLabel}
          emailFallbackHint={emailFallbackHint}
          emailInputId={emailInputId}
          googleFormId={formId}
          googleButtonRef={googleButtonRef}
        />
      )}
    </>
  )
}

const noSubscribe = () => () => {}
const TABBABLE = 'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([type=hidden]), [tabindex]:not([tabindex="-1"])'

const BROWSER_BY_OS: Record<InAppBrowser['os'], string> = {
  android: 'Chrome',
  ios: 'Safari',
  other: 'navegador',
}

const STEPS_BY_OS: Record<InAppBrowser['os'], string> = {
  android: 'Ou toque em ⋮ no canto da tela e escolha “Abrir no Chrome”.',
  ios: 'Toque em ••• ou no ícone de compartilhar e escolha “Abrir no Safari” (ou “Abrir no navegador externo”).',
  other: 'Abra o menu do aplicativo e escolha “Abrir no navegador”.',
}

function InAppBrowserDialog({
  open,
  onOpenChange,
  inAppBrowser,
  emailFallbackLabel,
  emailFallbackHint,
  emailInputId,
  googleFormId,
  googleButtonRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inAppBrowser: InAppBrowser
  emailFallbackLabel: string
  emailFallbackHint?: string
  emailInputId: string
  /** The dialog is portalled out of the form; `form=` ties its submit button back to it. */
  googleFormId: string
  googleButtonRef: React.RefObject<HTMLButtonElement | null>
}) {
  // Read on the client only; the dialog is never server-rendered open.
  const href = useSyncExternalStore(noSubscribe, () => window.location.href, () => null)
  const intentUrl = href ? chromeIntentUrl(href, inAppBrowser.os) : null
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const focusEmailOnClose = useRef(false)
  const browser = BROWSER_BY_OS[inAppBrowser.os]
  const hintId = useId()

  // The dialog stays mounted, so clear "Link copiado" for the next opening.
  function handleOpenChange(next: boolean) {
    if (!next) setCopied(null)
    onOpenChange(next)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
  }

  function chooseEmail() {
    focusEmailOnClose.current = true
    handleOpenChange(false)
  }

  // Base UI's focus guards let Tab walk out of this popup in Chromium and
  // WebKit under Playwright, so wrap Tab at the edges as well.
  function keepTabInside(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const popup = event.currentTarget
    const focusable = [...popup.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (el) => el.checkVisibility?.() !== false && !el.closest('[inert], [aria-hidden="true"]'),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === popup)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function finalFocus(): HTMLElement | boolean {
    const email = focusEmailOnClose.current ? document.getElementById(emailInputId) : null
    focusEmailOnClose.current = false
    return email ?? googleButtonRef.current ?? true
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        onKeyDown={keepTabInside}
        className="gap-3 p-5"
        data-testid="in-app-browser-dialog"
      >
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
          aria-label="Fechar"
        >
          <XIcon />
        </DialogClose>
        <DialogTitle className="pr-8 text-base font-medium text-charcoal">
          Abra no {browser} para entrar com Google
        </DialogTitle>
        <DialogDescription className="text-sm text-mid">
          O Google não permite login dentro {IN_APP_BROWSER_PLACE[inAppBrowser.app]}. Abra esta página no {browser} e continue de
          onde parou.
        </DialogDescription>

        <div className="flex flex-col gap-2 pt-1">
          {intentUrl && (
            <a
              href={intentUrl}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-forest px-4 text-sm font-medium text-cream"
              data-testid="open-in-chrome"
            >
              Abrir no Chrome
            </a>
          )}
          <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={copyLink} data-testid="copy-link">
            {copied === 'yes' ? 'Link copiado' : 'Copiar link'}
          </Button>
        </div>
        <div aria-live="polite">
          {copied === 'yes' && <p className="text-xs text-mid">Agora é só colar no {browser}.</p>}
          {copied === 'failed' && href && (
            <p className="text-xs text-mid break-all">
              Copie este endereço e cole no {browser}: <span className="font-mono select-all">{href}</span>
            </p>
          )}
        </div>
        <p className="text-xs text-mid">{STEPS_BY_OS[inAppBrowser.os]}</p>

        <div className="border-t border-sage/15 pt-3 flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-lg text-forest"
            onClick={chooseEmail}
            aria-describedby={emailFallbackHint ? hintId : undefined}
            data-testid="use-email"
          >
            {emailFallbackLabel}
          </Button>
          {emailFallbackHint && (
            <p id={hintId} className="text-xs text-mid text-center">
              {emailFallbackHint}
            </p>
          )}
          <button
            type="submit"
            form={googleFormId}
            className="mx-auto min-h-6 px-2 py-1.5 text-xs text-mid underline underline-offset-2"
            data-testid="google-sign-in-anyway"
          >
            Tentar com Google mesmo assim
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
