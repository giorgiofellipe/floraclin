'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Screens that fill the viewport below the header and scroll internally (the
// WhatsApp inbox). On mobile the footer would add page height outside that,
// and the install banner would sit on top of the composer.
const FULL_HEIGHT_PATHS = new Set(['/whatsapp'])

export function useIsFullHeightPage() {
  return FULL_HEIGHT_PATHS.has(usePathname() ?? '')
}

// Guidance a page shows for a moment (the first-patient hint after onboarding)
// can hold the install banner back while it is up, without dismissing it: the
// banner comes back once the guidance is gone or on the next page.
let installBannerHolds = 0
const installBannerListeners = new Set<() => void>()

function setInstallBannerHolds(delta: number) {
  installBannerHolds += delta
  installBannerListeners.forEach((listener) => listener())
}

function subscribeInstallBannerHolds(listener: () => void) {
  installBannerListeners.add(listener)
  return () => {
    installBannerListeners.delete(listener)
  }
}

export function useHoldInstallBanner(active: boolean) {
  useEffect(() => {
    if (!active) return
    setInstallBannerHolds(1)
    return () => setInstallBannerHolds(-1)
  }, [active])
}

export function useIsInstallBannerHeld() {
  return useSyncExternalStore(
    subscribeInstallBannerHolds,
    () => installBannerHolds > 0,
    () => false,
  )
}

export function PlatformFooter({ children }: { children: React.ReactNode }) {
  const fullHeight = useIsFullHeightPage()
  return (
    // Bottom padding grows by the home-indicator inset (viewport-fit=cover).
    // Full-height screens drop it on mobile only; desktop keeps it as before.
    <footer
      className={cn(
        'px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-xs text-mid',
        fullHeight && 'hidden md:block',
      )}
    >
      {children}
    </footer>
  )
}
