'use client'

import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'

const DISMISSED_KEY = 'floraclin.install-banner.dismissed'
// The complement of Tailwind's md breakpoint (48rem), where the wrapper's
// md:hidden takes over. Above it the browser must keep its own install UI,
// because ours is invisible.
const MOBILE_QUERY = '(width < 48rem)'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
}

type Mode = 'hidden' | 'ios' | 'other'

function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  )
}

// iPadOS Safari sends a desktop Macintosh user agent; touch points tell it apart.
function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Blocked storage: the banner still hides for this page view.
  }
}

export function InstallBanner() {
  const [mode, setMode] = useState<Mode>('hidden')
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isInstalled() || readDismissed()) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only decision; the server render must stay empty to match hydration
    setMode(isIos() ? 'ios' : 'other')

    const onBeforeInstallPrompt = (event: Event) => {
      if (!window.matchMedia(MOBILE_QUERY).matches) return
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      writeDismissed()
      setMode('hidden')
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (mode === 'hidden') return null

  const dismiss = () => {
    writeDismissed()
    setMode('hidden')
  }

  const install = () => {
    if (!installEvent) return
    setMode('hidden')
    installEvent.prompt().catch(() => undefined)
  }

  return (
    <div
      data-testid="install-banner"
      className="flex items-center justify-between gap-3 border-b border-sage/20 bg-sage/10 px-4 py-2 text-sm text-forest md:hidden"
    >
      {mode === 'ios' ? (
        <p>
          Instale o FloraClin: toque em <Share role="img" className="inline size-4 align-text-bottom" aria-label="Compartilhar" /> e depois em{' '}
          <span className="font-medium">Adicionar à Tela de Início</span>.
        </p>
      ) : (
        <p>Instale o FloraClin: no menu do navegador, toque em <span className="font-medium">Instalar app</span>.</p>
      )}
      {installEvent && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-md bg-forest px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-sage"
        >
          Instalar
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-sage/20"
        aria-label="Fechar"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
