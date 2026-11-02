import { useEffect, useState } from 'react'

/**
 * How much of the layout viewport the on-screen keyboard covers, in px.
 *
 * iOS Safari (and the Instagram/Facebook in-app browsers, which are WebKit on
 * iOS) does not resize the layout viewport when the keyboard opens: a bar
 * fixed to `bottom: 0` stays behind the keyboard. The visual viewport does
 * shrink, so the difference is what to lift the bar by. Chrome on Android
 * resizes the layout viewport itself and this stays 0 there. Without
 * `visualViewport` (old browsers) it is always 0.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      // Below this it is browser chrome sliding, not a keyboard.
      setInset(covered > 80 ? Math.round(covered) : 0)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
