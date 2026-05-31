import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoCycle } from '../use-auto-cycle'

describe('useAutoCycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts at index 0', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    expect(result.current.activeIndex).toBe(0)
  })

  it('advances after interval', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.activeIndex).toBe(1)
  })

  it('wraps around after last item', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { vi.advanceTimersByTime(15000) })
    expect(result.current.activeIndex).toBe(0)
  })

  it('resets timer on manual select', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { vi.advanceTimersByTime(4000) })
    act(() => { result.current.select(2) })
    expect(result.current.activeIndex).toBe(2)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(result.current.activeIndex).toBe(2)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.activeIndex).toBe(0)
  })

  it('pauses cycling when paused', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { result.current.pause() })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(result.current.activeIndex).toBe(0)
  })

  it('resumes cycling after resume', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { result.current.pause() })
    act(() => { vi.advanceTimersByTime(10000) })
    act(() => { result.current.resume() })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.activeIndex).toBe(1)
  })

  it('does not auto-cycle when prefers-reduced-motion matches', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { vi.advanceTimersByTime(15000) })
    expect(result.current.activeIndex).toBe(0)
  })

  it('manual select still works with reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { result.current.select(2) })
    expect(result.current.activeIndex).toBe(2)
  })
})
