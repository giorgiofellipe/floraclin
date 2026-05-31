'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface UseAutoCycleOptions {
  count: number
  interval: number
}

interface UseAutoCycleReturn {
  activeIndex: number
  select: (index: number) => void
  pause: () => void
  resume: () => void
  isPaused: boolean
}

export function useAutoCycle({ count, interval }: UseAutoCycleOptions): UseAutoCycleReturn {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  )
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    if (count <= 1 || prefersReducedMotion || isPausedRef.current) return
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % count)
    }, interval)
  }, [clearTimer, count, interval, prefersReducedMotion])

  useEffect(() => {
    startTimer()
    return clearTimer
  }, [startTimer, clearTimer])

  const select = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, count - 1))
      setActiveIndex(clamped)
      if (!isPausedRef.current && !prefersReducedMotion && count > 1) {
        clearTimer()
        timerRef.current = setInterval(() => {
          setActiveIndex((prev) => (prev + 1) % count)
        }, interval)
      }
    },
    [clearTimer, count, interval, prefersReducedMotion],
  )

  const pause = useCallback(() => {
    setIsPaused(true)
    isPausedRef.current = true
    clearTimer()
  }, [clearTimer])

  const resume = useCallback(() => {
    setIsPaused(false)
    isPausedRef.current = false
    startTimer()
  }, [startTimer])

  return { activeIndex, select, pause, resume, isPaused }
}
