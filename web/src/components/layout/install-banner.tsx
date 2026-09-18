'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { IosInstallSteps } from '@/components/layout/ios-install-steps'

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
  const [showIosSteps, setShowIosSteps] = useState(false)

  useEffect(() => {
    if (isInstalled() || readDismissed()) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only decision; the server render must stay empty to match hydration
    setMode(isIos() ? 'ios' : 'other')
  }, [])

  // Listeners live only while the banner is visible. Once it hides there is no
  // UI to hand the event to, so the browser must keep its own install prompt.
  useEffect(() => {
    if (mode === 'hidden') return

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
  }, [mode])

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

  let action: React.ReactNode = null
  let steps: string
  if (mode === 'ios') {
    action = <ActionButton onClick={() => setShowIosSteps(true)}>Instalar</ActionButton>
    steps = 'Quatro toques no Safari, sem loja de apps.'
  } else if (installEvent) {
    action = <ActionButton onClick={install}>Instalar</ActionButton>
    steps = 'Leva um segundo e não ocupa espaço.'
  } else {
    steps = 'Menu do navegador › Instalar app ou Adicionar à tela inicial'
  }

  return (
    <div
      data-testid="install-banner"
      className="fixed inset-x-3 bottom-3 z-30 rounded-xl bg-forest p-4 text-white shadow-lg md:hidden"
    >
      <div className="flex items-center gap-3">
        <Image src="/apple-icon.png" alt="" width={56} height={56} className="size-14 shrink-0 rounded-[22%] shadow-md ring-1 ring-white/25" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Instale o FloraClin</p>
          <p className="text-sm text-white/80">Abra direto da tela inicial, sem o navegador.</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="-mr-1 shrink-0 self-start rounded p-1 text-white/80"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {action}
        <p className="text-xs text-white/80">{steps}</p>
      </div>
      {mode === 'ios' && <IosInstallSteps open={showIosSteps} onOpenChange={setShowIosSteps} />}
    </div>
  )
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg bg-mint px-3 py-1.5 text-sm font-medium text-forest"
    >
      {children}
    </button>
  )
}
