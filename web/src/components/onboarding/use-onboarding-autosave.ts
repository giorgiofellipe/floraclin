import { useCallback, useEffect, useRef } from 'react'
import type { OnboardingProgressInput } from '@/validations/onboarding'

export const AUTOSAVE_DELAY_MS = 800

/**
 * Saves the wizard's progress while the owner types: debounced, right away on
 * a step change, and on leaving the page or the wizard. One save is in flight
 * at a time, and a failed one stays unsaved for the next try. Failures are
 * silent, since the final submit saves everything again.
 */
export function useOnboardingAutosave(progress: OnboardingProgressInput) {
  const body = JSON.stringify(progress)
  const step = progress.draft?.step
  const latestBody = useRef(body)
  const savedBody = useRef(body)
  const lastStep = useRef(step)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const paused = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const flush = useCallback(function flushNow() {
    clearTimer()
    if (paused.current || inFlight.current || latestBody.current === savedBody.current) return
    const sent = latestBody.current
    // keepalive lets the save finish while the page is being closed.
    inFlight.current = fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: sent,
      keepalive: true,
    })
      .then((res) => {
        if (res.ok) savedBody.current = sent
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = null
        if (latestBody.current !== sent) flushNow()
      })
  }, [clearTimer])

  const schedule = useCallback(() => {
    clearTimer()
    timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS)
  }, [clearTimer, flush])

  useEffect(() => {
    latestBody.current = body
    if (body === savedBody.current) return
    if (step !== lastStep.current) {
      lastStep.current = step
      flush()
      return
    }
    schedule()
  }, [body, step, flush, schedule])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush()
    }
  }, [flush])

  /** Stops saving and waits for the save in flight, so none lands after the final submit. */
  const pause = useCallback(async () => {
    paused.current = true
    clearTimer()
    while (inFlight.current) await inFlight.current
  }, [clearTimer])

  const resume = useCallback(() => {
    paused.current = false
    if (latestBody.current !== savedBody.current) schedule()
  }, [schedule])

  /** After the final submit saved everything: nothing is left to autosave. */
  const finish = useCallback(() => {
    savedBody.current = latestBody.current
  }, [])

  return { pause, resume, finish }
}
