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

const TOUCH_QUERY = '(pointer: coarse)'

function subscribeTouch(onChange: () => void) {
  const mql = window.matchMedia(TOUCH_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** A finger is the main pointer (phones, tablets): menus open as bottom sheets. */
export function useIsTouch() {
  const coarse = useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH_QUERY).matches,
    () => false
  )
  return useIsMobile() || coarse
}
