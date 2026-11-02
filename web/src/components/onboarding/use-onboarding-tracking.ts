import { useCallback, useEffect, useRef } from 'react'
import { track } from '@/lib/analytics/client'
import type {
  OnboardingAbandonTrigger,
  OnboardingFieldInteraction,
  OnboardingTrackedField,
} from '@/lib/analytics/events'
import { ONBOARDING_STEPS } from '@/validations/onboarding'

function elapsedSince(startedAt: number) {
  return Math.max(0, Date.now() - startedAt)
}

function stepProperties(index: number) {
  return { step_index: index, step_name: ONBOARDING_STEPS[index] }
}

/**
 * `onboarding_field_interacted` on the first focus and the first input of each
 * field, once per field and interaction for the life of the page (going back to
 * the step does not send them again). Only the field's name is sent, never
 * what was typed.
 */
export function useFieldInteractionTracking(stepIndex: number) {
  const sent = useRef(new Set<string>())

  return useCallback(
    (field: OnboardingTrackedField, interaction: OnboardingFieldInteraction) => {
      const key = `${stepIndex}:${field}:${interaction}`
      if (sent.current.has(key)) return
      sent.current.add(key)
      track('onboarding_field_interacted', { ...stepProperties(stepIndex), field, interaction })
    },
    [stepIndex],
  )
}

/**
 * `onboarding_step_abandoned` when the owner leaves the wizard from a step
 * without finishing it: the page closed or reloaded (pagehide, beforeunload)
 * or a navigation away (the wizard unmounting). At most once per visit to a
 * step; moving to another step, forward or back, starts a new visit and is not
 * an abandonment.
 *
 * A hidden tab (another tab, another app, the phone locked) is not leaving:
 * it sends `onboarding_step_backgrounded` instead, once each time the tab goes
 * hidden. Closing a tab hides it first, so a close sends both.
 *
 * Both by beacon, since the page may be going away. `suppress()` before
 * finishing onboarding (the redirect that follows is not an abandonment) and
 * `resume()` if finishing failed.
 */
export function useStepAbandonTracking(stepIndex: number) {
  const step = useRef(stepIndex)
  const startedAt = useRef(0)
  const fired = useRef(false)
  const backgrounded = useRef(false)
  const suppressed = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    step.current = stepIndex
    startedAt.current = Date.now()
    fired.current = false
  }, [stepIndex])

  const fire = useCallback((trigger: OnboardingAbandonTrigger) => {
    if (fired.current || suppressed.current) return
    fired.current = true
    track(
      'onboarding_step_abandoned',
      { ...stepProperties(step.current), time_on_step_ms: elapsedSince(startedAt.current), trigger },
      { transport: 'sendBeacon' },
    )
  }, [])

  useEffect(() => {
    mounted.current = true
    const onPageHide = () => fire('pagehide')
    const onBeforeUnload = () => fire('beforeunload')
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        backgrounded.current = false
        return
      }
      if (backgrounded.current || suppressed.current) return
      backgrounded.current = true
      track(
        'onboarding_step_backgrounded',
        { ...stepProperties(step.current), time_on_step_ms: elapsedSince(startedAt.current) },
        { transport: 'sendBeacon' },
      )
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      mounted.current = false
      // Checked a tick later: StrictMode remounts at once in development, a
      // real navigation away does not.
      queueMicrotask(() => {
        if (!mounted.current) fire('navigation')
      })
    }
  }, [fire])

  const suppress = useCallback(() => {
    suppressed.current = true
  }, [])
  const resume = useCallback(() => {
    suppressed.current = false
  }, [])

  return { suppress, resume }
}
