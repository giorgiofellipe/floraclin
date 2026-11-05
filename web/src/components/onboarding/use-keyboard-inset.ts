import { useEffect, useState } from 'react'

/** Tailwind's `sm`, where the onboarding action bar stops being pinned. */
const WIDE_QUERY = '(min-width: 640px)'

/**
 * How much of the layout viewport the on-screen keyboard covers, in px.
 *
 * iOS Safari (and the Instagram/Facebook in-app browsers, which are WebKit on
 * iOS) does not resize the layout viewport when the keyboard opens: a bar
 * fixed to `bottom: 0` stays behind the keyboard. The visual viewport does
 * shrink, so the difference is what to lift the bar by. Chrome on Android
 * resizes the layout viewport itself and this stays 0 there. Without
 * `visualViewport` (old browsers) it is always 0.
 *
 * Also 0 from Tailwind's `sm` up: there the bar sits in the page flow, not
 * pinned to the bottom, and lifting it (an iPad with the keyboard open) would
 * move it over the content.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const wide = window.matchMedia?.(WIDE_QUERY)
    const update = () => {
      if (wide?.matches) {
        setInset(0)
        return
      }
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      // Below this it is browser chrome sliding, not a keyboard.
      setInset(covered > 80 ? Math.round(covered) : 0)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    wide?.addEventListener('change', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      wide?.removeEventListener('change', update)
    }
  }, [])

  return inset
}
