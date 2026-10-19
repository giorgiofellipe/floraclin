'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Screens that fill the viewport below the header and scroll internally (the
// WhatsApp inbox). On mobile the footer would add page height outside that,
// and the install banner would sit on top of the composer.
const FULL_HEIGHT_PATHS = new Set(['/whatsapp'])

export function useIsFullHeightPage() {
  return FULL_HEIGHT_PATHS.has(usePathname() ?? '')
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
