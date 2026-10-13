import { useSyncExternalStore } from 'react'

// Matches Tailwind's `md` breakpoint, where the sidebar layout starts.
const MOBILE_QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  )
}
