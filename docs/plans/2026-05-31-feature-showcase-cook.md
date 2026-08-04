# Feature Showcase Component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static 3×3 feature card grid on the landing page with an interactive auto-cycling showcase. Each feature group becomes a tabbed block with animated SVG demos, giving visitors a feel for the product without screenshots.

**Architecture:** Three independent `FeatureShowcaseGroup` blocks rendered vertically on the page. Each manages its own auto-cycling state (active tab, 5s timer, hover-pause). Desktop: side-tabs + right panel with SVG demo. Mobile: accordion with expanded active card. All 9 SVG demos are pure inline SVG with CSS `@keyframes` — no external animation libraries.

**Tech Stack:** React 19, Next.js 15, Tailwind CSS v4, Vitest + Testing Library (new to site package).

---

## Adversarial Review Fixes (applied)

1. **Timer bar**: Use `animation-iteration-count: 1` + `animation-fill-mode: forwards` (not `infinite`). Key the timer bar `<div>` on `activeIndex` so it re-mounts on switch. Control `animation-play-state` via `isPaused`.
2. **Server/client boundary**: Move all demo imports and group config inside `feature-showcase.tsx` (client component). `page.tsx` renders `<FeatureShowcase />` with zero props — no function passing across RSC boundary.
3. **ci:checks**: Add `pnpm --filter @floraclin/site test:run` to root `package.json` `ci:checks` script in Task 1.
4. **useAutoCycle pause/resume**: Use a ref for `isPaused` alongside the state to avoid stale closures in `startTimer`/`select` callbacks.
5. **IntersectionObserver mock**: Add `global.IntersectionObserver` mock to `site/src/tests/setup.ts` in Task 1.
6. **SVG rect width animation**: Use `transform: scaleX()` instead of animating `width` on SVG `<rect>` elements.
7. **Group B**: Renamed to sequential — Tasks 4 and 5 must run in sequence, not parallel.
8. **count=0 guard**: Add early return in `useAutoCycle` when `count <= 0`.

---

## File Ownership Map

| File | Created/Modified | Task(s) |
|------|-----------------|---------|
| `site/package.json` | Modify | 1 |
| `site/vitest.config.ts` | Create | 1 |
| `site/src/tests/setup.ts` | Create | 1 |
| `site/src/hooks/use-auto-cycle.ts` | Create | 2 |
| `site/src/hooks/__tests__/use-auto-cycle.test.ts` | Create | 2 |
| `site/src/components/feature-demos.tsx` | Create | 3, 4, 5 |
| `site/src/components/__tests__/feature-demos.test.tsx` | Create | 3, 4, 5 |
| `site/src/components/feature-showcase.tsx` | Create | 6 |
| `site/src/components/__tests__/feature-showcase.test.tsx` | Create | 6 |
| `site/src/app/globals.css` | Modify | 7 |
| `site/src/app/page.tsx` | Modify | 8 |
| `site/src/components/features.tsx` | Unchanged (keep for reference/rollback) | — |

---

## Group A (parallel) — Test Infrastructure + Auto-Cycle Hook + SVG Demos Batch 1

### Task 1: Add Vitest to the site package

**Files:**
- Modify: `site/package.json`
- Create: `site/vitest.config.ts`
- Create: `site/src/tests/setup.ts`

- [ ] **Step 1: Install test dependencies**

Run:
```bash
pnpm --filter @floraclin/site add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: devDependencies added to `site/package.json`.

- [ ] **Step 2: Add test scripts to site/package.json**

Add to `"scripts"`:
```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `site/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 4: Create test setup file**

Create `site/src/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Verify vitest runs with no tests**

Run: `pnpm --filter @floraclin/site test:run`
Expected: "No test files found" or exits 0 with no failures.

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/vitest.config.ts site/src/tests/setup.ts pnpm-lock.yaml
git commit -m "chore(site): add vitest + testing-library test infrastructure"
```

---

### Task 2: useAutoCycle hook

**Files:**
- Create: `site/src/hooks/use-auto-cycle.ts`
- Create: `site/src/hooks/__tests__/use-auto-cycle.test.ts`

This hook encapsulates all cycling logic: auto-advance every 5s, pause on hover/focus, resume on leave/blur, manual select resets timer, wraps around, and respects `prefers-reduced-motion`.

- [ ] **Step 1: Write tests first**

Create `site/src/hooks/__tests__/use-auto-cycle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoCycle } from '../use-auto-cycle'

describe('useAutoCycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: motion allowed
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
    act(() => { vi.advanceTimersByTime(15000) }) // 3 advances: 0->1->2->0
    expect(result.current.activeIndex).toBe(0)
  })

  it('resets timer on manual select', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { vi.advanceTimersByTime(4000) }) // almost at threshold
    act(() => { result.current.select(2) })
    expect(result.current.activeIndex).toBe(2)
    act(() => { vi.advanceTimersByTime(4000) }) // 4s after reset — should NOT advance
    expect(result.current.activeIndex).toBe(2)
    act(() => { vi.advanceTimersByTime(1000) }) // 5s total — NOW advance
    expect(result.current.activeIndex).toBe(0)
  })

  it('pauses cycling when paused', () => {
    const { result } = renderHook(() => useAutoCycle({ count: 3, interval: 5000 }))
    act(() => { result.current.pause() })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(result.current.activeIndex).toBe(0) // never advanced
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
    expect(result.current.activeIndex).toBe(0) // stays at 0
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
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/hooks/__tests__/use-auto-cycle.test.ts`
Expected: Module not found errors — tests fail because `use-auto-cycle.ts` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

Create `site/src/hooks/use-auto-cycle.ts`:

```ts
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
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Detect prefers-reduced-motion
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mql.matches)
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
    if (prefersReducedMotion || isPaused) return
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % count)
    }, interval)
  }, [clearTimer, count, interval, isPaused, prefersReducedMotion])

  // Start/restart timer when dependencies change
  useEffect(() => {
    startTimer()
    return clearTimer
  }, [startTimer, clearTimer])

  const select = useCallback(
    (index: number) => {
      setActiveIndex(index)
      // Restart timer from scratch on manual select
      if (!isPaused && !prefersReducedMotion) {
        clearTimer()
        timerRef.current = setInterval(() => {
          setActiveIndex((prev) => (prev + 1) % count)
        }, interval)
      }
    },
    [clearTimer, count, interval, isPaused, prefersReducedMotion],
  )

  const pause = useCallback(() => {
    setIsPaused(true)
    clearTimer()
  }, [clearTimer])

  const resume = useCallback(() => {
    setIsPaused(false)
  }, [])

  return { activeIndex, select, pause, resume, isPaused }
}
```

- [ ] **Step 4: Run tests — all green**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/hooks/__tests__/use-auto-cycle.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/hooks/use-auto-cycle.ts site/src/hooks/__tests__/use-auto-cycle.test.ts
git commit -m "feat(site): add useAutoCycle hook for feature showcase timer logic"
```

---

### Task 3: SVG Demos — Group 1 (Precisão Clínica Visual)

**Files:**
- Create: `site/src/components/feature-demos.tsx`
- Create: `site/src/components/__tests__/feature-demos.test.tsx`

This task creates the file and adds the first 3 demos: `FaceDiagramDemo`, `BeforeAfterDemo`, `GuidedCaptureDemo`.

- [ ] **Step 1: Write tests for Group 1 demos**

Create `site/src/components/__tests__/feature-demos.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
} from '../feature-demos'

describe('Feature Demos — Group 1: Precisão Clínica Visual', () => {
  it('FaceDiagramDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<FaceDiagramDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('BeforeAfterDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<BeforeAfterDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('GuidedCaptureDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<GuidedCaptureDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('FaceDiagramDemo contains injection dot elements', () => {
    const { container } = render(<FaceDiagramDemo />)
    // Injection dots are <circle> elements with the demo-specific class prefix
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(4) // forehead, cheeks, jawline, lips
  })

  it('BeforeAfterDemo contains two frame rectangles', () => {
    const { container } = render(<BeforeAfterDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(2)
  })

  it('GuidedCaptureDemo contains a viewfinder and face guide', () => {
    const { container } = render(<GuidedCaptureDemo />)
    // Viewfinder rect + dashed oval (ellipse)
    const rects = container.querySelectorAll('svg rect')
    const ellipses = container.querySelectorAll('svg ellipse')
    expect(rects.length).toBeGreaterThanOrEqual(1)
    expect(ellipses.length).toBeGreaterThanOrEqual(1)
  })

  it('each demo contains a <style> tag with scoped keyframes', () => {
    for (const Demo of [FaceDiagramDemo, BeforeAfterDemo, GuidedCaptureDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
    }
  })

  it('demos respect prefers-reduced-motion in style block', () => {
    for (const Demo of [FaceDiagramDemo, BeforeAfterDemo, GuidedCaptureDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-demos.test.tsx`
Expected: Module not found — `feature-demos.tsx` doesn't exist.

- [ ] **Step 3: Implement Group 1 demos**

Create `site/src/components/feature-demos.tsx`:

```tsx
/* ─── Animated SVG demos for the feature showcase ──────────────────────
   Each demo is self-contained inline SVG with scoped CSS keyframes.
   Palette: forest #1C2B1E, sage #4A6B52, mint #8FB49A, cream #FAF7F3.
   All demos have aria-hidden="true" (decorative).
   All demos include a prefers-reduced-motion media query that freezes animations.
   Animation cycle: 4s loop (spec: 1s static "complete" state).
   ───────────────────────────────────────────────────────────────────── */

// ─── Group 1: Precisão Clínica Visual ───────────────────────────────

export function FaceDiagramDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes fd-dot { 0%, 10% { r: 0; opacity: 0; } 20% { r: 5; opacity: 1; } 75% { r: 5; opacity: 1; } 85%, 100% { r: 0; opacity: 0; } }
        @keyframes fd-label { 0%, 15% { opacity: 0; } 30% { opacity: 1; } 75% { opacity: 1; } 85%, 100% { opacity: 0; } }
        .fd-dot { animation: fd-dot 4s ease-in-out infinite; }
        .fd-label { animation: fd-label 4s ease-in-out infinite; font-size: 10px; fill: #4A6B52; font-family: sans-serif; }
        .fd-d1 { animation-delay: 0s; } .fd-l1 { animation-delay: 0.1s; }
        .fd-d2 { animation-delay: 0.5s; } .fd-l2 { animation-delay: 0.6s; }
        .fd-d3 { animation-delay: 1.0s; } .fd-l3 { animation-delay: 1.1s; }
        .fd-d4 { animation-delay: 1.5s; } .fd-l4 { animation-delay: 1.6s; }
        .fd-d5 { animation-delay: 0.7s; } .fd-l5 { animation-delay: 0.8s; }
        @media (prefers-reduced-motion: reduce) { .fd-dot, .fd-label { animation: none; opacity: 1; r: 5; } }
      `}</style>
      {/* Face oval */}
      <ellipse cx="200" cy="148" rx="72" ry="96" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      {/* Eyes */}
      <ellipse cx="178" cy="128" rx="12" ry="6" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      <ellipse cx="222" cy="128" rx="12" ry="6" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      {/* Nose */}
      <path d="M200 138 L194 160 Q200 164 206 160 Z" stroke="#1C2B1E" strokeWidth="1" fill="none" />
      {/* Mouth */}
      <path d="M186 180 Q200 192 214 180" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      {/* Injection dots + labels */}
      <circle className="fd-dot fd-d1" cx="200" cy="80" fill="#4A6B52" />
      <text className="fd-label fd-l1" x="214" y="84">Testa</text>
      <circle className="fd-dot fd-d2" cx="158" cy="148" fill="#4A6B52" />
      <text className="fd-label fd-l2" x="128" y="152">Bochecha</text>
      <circle className="fd-dot fd-d5" cx="242" cy="148" fill="#4A6B52" />
      <text className="fd-label fd-l5" x="250" y="152">Bochecha</text>
      <circle className="fd-dot fd-d3" cx="175" cy="200" fill="#4A6B52" />
      <text className="fd-label fd-l3" x="140" y="216">Mandíbula</text>
      <circle className="fd-dot fd-d4" cx="200" cy="184" fill="#4A6B52" />
      <text className="fd-label fd-l4" x="214" y="188">Lábios</text>
    </svg>
  )
}

export function BeforeAfterDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes ba-slide-l { 0% { transform: translateX(-30px); } 30%, 65% { transform: translateX(0); } 85%, 100% { transform: translateX(-30px); } }
        @keyframes ba-slide-r { 0% { transform: translateX(30px); } 30%, 65% { transform: translateX(0); } 85%, 100% { transform: translateX(30px); } }
        @keyframes ba-grid { 0%, 35% { opacity: 0; } 45%, 60% { opacity: 1; } 75%, 100% { opacity: 0; } }
        @keyframes ba-lock { 0%, 50% { opacity: 0; transform: scale(0.5); } 58%, 65% { opacity: 1; transform: scale(1); } 60%, 63% { transform: scale(1.15); } 75%, 100% { opacity: 0; transform: scale(0.5); } }
        .ba-left { animation: ba-slide-l 4s ease-in-out infinite; }
        .ba-right { animation: ba-slide-r 4s ease-in-out infinite; }
        .ba-grid { animation: ba-grid 4s ease-in-out infinite; }
        .ba-lock { animation: ba-lock 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ba-left, .ba-right, .ba-grid, .ba-lock { animation: none; opacity: 1; transform: none; } }
      `}</style>
      {/* Left frame — "Antes" */}
      <g className="ba-left">
        <rect x="40" y="50" width="130" height="170" rx="8" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
        <ellipse cx="105" cy="120" rx="28" ry="38" stroke="#8FB49A" strokeWidth="1.5" fill="none" />
        <text x="82" y="240" fontSize="11" fill="#4A6B52" fontFamily="sans-serif">Antes</text>
      </g>
      {/* Right frame — "Depois" */}
      <g className="ba-right">
        <rect x="230" y="50" width="130" height="170" rx="8" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
        <ellipse cx="295" cy="120" rx="28" ry="38" stroke="#8FB49A" strokeWidth="1.5" fill="none" />
        <text x="270" y="240" fontSize="11" fill="#4A6B52" fontFamily="sans-serif">Depois</text>
      </g>
      {/* Alignment grid lines */}
      <g className="ba-grid">
        <line x1="200" y1="60" x2="200" y2="210" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="50" y1="120" x2="350" y2="120" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="50" y1="160" x2="350" y2="160" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
      </g>
      {/* Lock icon */}
      <g className="ba-lock" transform="translate(190, 248)">
        <rect x="2" y="6" width="16" height="12" rx="2" fill="#4A6B52" />
        <path d="M5 6 V3 A5 5 0 0 1 15 3 V6" stroke="#4A6B52" strokeWidth="2" fill="none" />
      </g>
    </svg>
  )
}

export function GuidedCaptureDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes gc-face { 0% { transform: translateY(100px); } 30%, 60% { transform: translateY(0); } 85%, 100% { transform: translateY(100px); } }
        @keyframes gc-oval { 0%, 25% { stroke: #8FB49A; } 40%, 60% { stroke: #4A6B52; } 75%, 100% { stroke: #8FB49A; } }
        @keyframes gc-flash { 0%, 55% { opacity: 0; } 60% { opacity: 0.6; } 70%, 100% { opacity: 0; } }
        .gc-face { animation: gc-face 4s ease-in-out infinite; }
        .gc-oval { animation: gc-oval 4s ease-in-out infinite; }
        .gc-flash { animation: gc-flash 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gc-face, .gc-oval, .gc-flash { animation: none; } .gc-face { transform: translateY(0); } .gc-oval { stroke: #4A6B52; } .gc-flash { opacity: 0; } }
      `}</style>
      {/* Camera viewfinder */}
      <rect x="80" y="20" width="240" height="240" rx="12" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      {/* Corner brackets */}
      <path d="M90 50 V32 H108" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M310 50 V32 H292" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M90 230 V248 H108" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M310 230 V248 H292" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      {/* Dashed oval guide */}
      <ellipse className="gc-oval" cx="200" cy="140" rx="55" ry="75" strokeWidth="2" strokeDasharray="6 4" fill="none" />
      {/* Face entering from below */}
      <g className="gc-face">
        <ellipse cx="200" cy="140" rx="40" ry="55" stroke="#1C2B1E" strokeWidth="1.5" fill="none" />
        <ellipse cx="185" cy="125" rx="8" ry="4" stroke="#1C2B1E" strokeWidth="1" fill="none" />
        <ellipse cx="215" cy="125" rx="8" ry="4" stroke="#1C2B1E" strokeWidth="1" fill="none" />
        <path d="M192 155 Q200 163 208 155" stroke="#1C2B1E" strokeWidth="1" fill="none" />
      </g>
      {/* Flash effect */}
      <rect className="gc-flash" x="80" y="20" width="240" height="240" rx="12" fill="white" />
    </svg>
  )
}
```

- [ ] **Step 4: Run tests — all Group 1 tests green**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-demos.test.tsx`
Expected: All 8 tests pass.

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @floraclin/site build`
Expected: Build succeeds (no import errors).

- [ ] **Step 6: Commit**

```bash
git add site/src/components/feature-demos.tsx site/src/components/__tests__/feature-demos.test.tsx
git commit -m "feat(site): add SVG demos for Precisão Clínica Visual feature group"
```

---

## Group B (parallel, depends on A) — SVG Demos Groups 2 & 3

### Task 4: SVG Demos — Group 2 (Fluxo sem Atrito)

**Files:**
- Modify: `site/src/components/feature-demos.tsx` (append)
- Modify: `site/src/components/__tests__/feature-demos.test.tsx` (append)

- [ ] **Step 1: Add tests for Group 2 demos**

Append to `site/src/components/__tests__/feature-demos.test.tsx`:

```tsx
import {
  GuidedFlowDemo,
  DigitalSignatureDemo,
  SelfServiceDemo,
} from '../feature-demos'

describe('Feature Demos — Group 2: Fluxo sem Atrito', () => {
  it('GuidedFlowDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<GuidedFlowDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('GuidedFlowDemo has 5 step circles', () => {
    const { container } = render(<GuidedFlowDemo />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(5)
  })

  it('DigitalSignatureDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<DigitalSignatureDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('DigitalSignatureDemo has a signature path', () => {
    const { container } = render(<DigitalSignatureDemo />)
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThanOrEqual(1)
  })

  it('SelfServiceDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<SelfServiceDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('SelfServiceDemo has form-like rects for input fields', () => {
    const { container } = render(<SelfServiceDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(3) // phone + at least 3 fields + button
  })

  it('Group 2 demos each contain scoped keyframes and reduced-motion query', () => {
    for (const Demo of [GuidedFlowDemo, DigitalSignatureDemo, SelfServiceDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})
```

- [ ] **Step 2: Implement Group 2 demos**

Append to `site/src/components/feature-demos.tsx`:

```tsx
// ─── Group 2: Fluxo sem Atrito ──────────────────────────────────────

export function GuidedFlowDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes gf-check { 0%, 10% { stroke-dashoffset: 14; } 25% { stroke-dashoffset: 0; } 75% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 14; } }
        @keyframes gf-pulse { 0%, 100% { r: 18; opacity: 0; } 50% { r: 24; opacity: 0.3; } }
        .gf-check { stroke-dasharray: 14; animation: gf-check 4s ease-in-out infinite; }
        .gf-c1 { animation-delay: 0s; } .gf-c2 { animation-delay: 0.6s; } .gf-c3 { animation-delay: 1.2s; } .gf-c4 { animation-delay: 1.8s; } .gf-c5 { animation-delay: 2.4s; }
        .gf-pulse { animation: gf-pulse 1.2s ease-in-out infinite; fill: #8FB49A; }
        @media (prefers-reduced-motion: reduce) { .gf-check, .gf-pulse { animation: none; } .gf-check { stroke-dashoffset: 0; } .gf-pulse { opacity: 0; } }
      `}</style>
      {/* Step labels */}
      {['Anamnese', 'Avaliação', 'Planejamento', 'Aprovação', 'Execução'].map((label, i) => {
        const cx = 60 + i * 75
        return (
          <g key={label}>
            {/* Connecting line */}
            {i < 4 && <line x1={cx + 16} y1={140} x2={cx + 59} y2={140} stroke="#8FB49A" strokeWidth="2" />}
            {/* Circle */}
            <circle cx={cx} cy={140} r="16" stroke="#4A6B52" strokeWidth="2" fill="#FAF7F3" />
            {/* Pulse ring on active */}
            <circle className="gf-pulse" cx={cx} cy={140} style={{ animationDelay: `${i * 0.6}s` }} />
            {/* Checkmark */}
            <path className={`gf-check gf-c${i + 1}`} d={`M${cx - 5} 140 L${cx - 1} 145 L${cx + 6} 134`} stroke="#4A6B52" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {/* Label */}
            <text x={cx} y={175} textAnchor="middle" fontSize="9" fill="#4A6B52" fontFamily="sans-serif">{label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function DigitalSignatureDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes ds-sign { 0% { stroke-dashoffset: 200; } 60% { stroke-dashoffset: 0; } 75% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 200; } }
        @keyframes ds-check { 0%, 60% { opacity: 0; transform: scale(0); } 70%, 75% { opacity: 1; transform: scale(1); } 90%, 100% { opacity: 0; transform: scale(0); } }
        .ds-sign { stroke-dasharray: 200; animation: ds-sign 4s ease-in-out infinite; }
        .ds-check { animation: ds-check 4s ease-in-out infinite; transform-origin: 200px 230px; }
        @media (prefers-reduced-motion: reduce) { .ds-sign, .ds-check { animation: none; } .ds-sign { stroke-dashoffset: 0; } .ds-check { opacity: 1; transform: scale(1); } }
      `}</style>
      {/* Phone outline */}
      <rect x="135" y="20" width="130" height="240" rx="14" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      {/* Screen area */}
      <rect x="143" y="40" width="114" height="190" rx="4" fill="white" stroke="#8FB49A" strokeWidth="0.5" />
      {/* Document lines */}
      <rect x="158" y="60" width="84" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="76" width="70" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="92" width="78" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="108" width="60" height="6" rx="3" fill="#E8D5C8" />
      {/* Signature line */}
      <line x1="158" y1="170" x2="242" y2="170" stroke="#8FB49A" strokeWidth="1" strokeDasharray="3 2" />
      <text x="158" y="185" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">Assinatura</text>
      {/* Animated signature */}
      <path className="ds-sign" d="M162 165 Q170 150 180 165 Q190 180 200 160 Q210 142 218 165 Q222 175 230 162 Q235 155 238 165" stroke="#1C2B1E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* Green checkmark */}
      <g className="ds-check">
        <circle cx="200" cy="210" r="12" fill="#4A6B52" />
        <path d="M194 210 L198 215 L207 204" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

export function SelfServiceDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes ss-fill { 0%, 5% { width: 0; } 20% { width: 60px; } 70% { width: 60px; } 85%, 100% { width: 0; } }
        @keyframes ss-btn { 0%, 60% { fill: #E8D5C8; } 65%, 75% { fill: #4A6B52; } 85%, 100% { fill: #E8D5C8; } }
        .ss-f1 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 0s; }
        .ss-f2 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 0.5s; }
        .ss-f3 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 1.0s; }
        .ss-f4 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 1.5s; }
        .ss-btn { animation: ss-btn 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-f1, .ss-f2, .ss-f3, .ss-f4, .ss-btn { animation: none; } .ss-btn { fill: #4A6B52; } }
      `}</style>
      {/* Phone outline */}
      <rect x="135" y="20" width="130" height="240" rx="14" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      {/* Screen area */}
      <rect x="143" y="40" width="114" height="190" rx="4" fill="white" stroke="#8FB49A" strokeWidth="0.5" />
      {/* Form title */}
      <text x="200" y="62" textAnchor="middle" fontSize="10" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Anamnese</text>
      {/* Input fields with fill animation */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="155" y={78 + i * 32} width="90" height="20" rx="4" stroke="#8FB49A" strokeWidth="1" fill="white" />
          <text x="160" y={87 + i * 32} fontSize="7" fill="#7A7A7A" fontFamily="sans-serif">
            {['Nome completo', 'Data de nascimento', 'Alergias', 'Medicamentos'][i]}
          </text>
          <rect className={`ss-f${i + 1}`} x="155" y={78 + i * 32} height="20" rx="4" fill="#8FB49A" opacity="0.2" />
        </g>
      ))}
      {/* Submit button */}
      <rect className="ss-btn" x="155" y="215" width="90" height="24" rx="6" />
      <text x="200" y="231" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="600">Enviar</text>
    </svg>
  )
}
```

- [ ] **Step 3: Run tests — all Group 1 + 2 tests green**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-demos.test.tsx`
Expected: All 15 tests pass (8 Group 1 + 7 Group 2).

- [ ] **Step 4: Commit**

```bash
git add site/src/components/feature-demos.tsx site/src/components/__tests__/feature-demos.test.tsx
git commit -m "feat(site): add SVG demos for Fluxo sem Atrito feature group"
```

---

### Task 5: SVG Demos — Group 3 (Gestão do Negócio)

**Files:**
- Modify: `site/src/components/feature-demos.tsx` (append)
- Modify: `site/src/components/__tests__/feature-demos.test.tsx` (append)

> **Important:** Tasks 4 and 5 both modify the same files, so they CANNOT truly run in parallel. They are listed under Group B to express that both depend on Group A (Task 3 creating the files), but must be **executed sequentially** within Group B. Task 4 runs first, then Task 5.

- [ ] **Step 1: Add tests for Group 3 demos**

Append to `site/src/components/__tests__/feature-demos.test.tsx`:

```tsx
import {
  FinancialDemo,
  PackagesDemo,
  CalendarDemo,
} from '../feature-demos'

describe('Feature Demos — Group 3: Gestão do Negócio', () => {
  it('FinancialDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<FinancialDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('FinancialDemo has bar chart rects', () => {
    const { container } = render(<FinancialDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(4) // 4 bars minimum
  })

  it('PackagesDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<PackagesDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('PackagesDemo has 5 session dot circles', () => {
    const { container } = render(<PackagesDemo />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThanOrEqual(5)
  })

  it('CalendarDemo renders an SVG with aria-hidden', () => {
    const { container } = render(<CalendarDemo />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('CalendarDemo has calendar grid rects for appointment blocks', () => {
    const { container } = render(<CalendarDemo />)
    const rects = container.querySelectorAll('svg rect')
    expect(rects.length).toBeGreaterThanOrEqual(7) // grid + appointment blocks
  })

  it('Group 3 demos each contain scoped keyframes and reduced-motion query', () => {
    for (const Demo of [FinancialDemo, PackagesDemo, CalendarDemo]) {
      const { container } = render(<Demo />)
      const style = container.querySelector('svg style')
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('@keyframes')
      expect(style?.textContent).toContain('prefers-reduced-motion')
    }
  })
})
```

- [ ] **Step 2: Implement Group 3 demos**

Append to `site/src/components/feature-demos.tsx`:

```tsx
// ─── Group 3: Gestão do Negócio ─────────────────────────────────────

export function FinancialDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes fn-bar { 0% { transform: scaleY(0); } 25%, 70% { transform: scaleY(1); } 85%, 100% { transform: scaleY(0); } }
        @keyframes fn-num { 0%, 20% { opacity: 0; } 30%, 70% { opacity: 1; } 85%, 100% { opacity: 0; } }
        @keyframes fn-inst { 0%, 30% { fill: #E8D5C8; } 40%, 70% { fill: #4A6B52; } 85%, 100% { fill: #E8D5C8; } }
        .fn-bar { transform-origin: bottom; animation: fn-bar 4s ease-in-out infinite; }
        .fn-b1 { animation-delay: 0s; } .fn-b2 { animation-delay: 0.3s; } .fn-b3 { animation-delay: 0.6s; } .fn-b4 { animation-delay: 0.9s; }
        .fn-num { animation: fn-num 4s ease-in-out infinite; }
        .fn-inst { animation: fn-inst 4s ease-in-out infinite; }
        .fn-i1 { animation-delay: 1.2s; } .fn-i2 { animation-delay: 1.5s; } .fn-i3 { animation-delay: 1.8s; }
        @media (prefers-reduced-motion: reduce) { .fn-bar, .fn-num, .fn-inst { animation: none; } .fn-bar { transform: scaleY(1); } .fn-num { opacity: 1; } .fn-inst { fill: #4A6B52; } }
      `}</style>
      {/* Chart area */}
      <line x1="80" y1="200" x2="320" y2="200" stroke="#8FB49A" strokeWidth="1" />
      {/* Bars */}
      {[0, 1, 2, 3].map((i) => {
        const heights = [100, 140, 80, 120]
        const x = 110 + i * 55
        return (
          <rect
            key={i}
            className={`fn-bar fn-b${i + 1}`}
            x={x}
            y={200 - heights[i]}
            width="30"
            height={heights[i]}
            rx="4"
            fill="#4A6B52"
            opacity="0.7"
          />
        )
      })}
      {/* Total number */}
      <text className="fn-num" x="200" y="52" textAnchor="middle" fontSize="20" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="700">R$ 12.450</text>
      <text className="fn-num" x="200" y="68" textAnchor="middle" fontSize="10" fill="#7A7A7A" fontFamily="sans-serif">receita do mês</text>
      {/* Installment dots */}
      <text x="120" y="240" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">Parcelas:</text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle className={`fn-inst fn-i${i + 1}`} cx={195 + i * 28} cy={236} r="8" />
          <path d={`M${191 + i * 28} 236 L${194 + i * 28} 239 L${200 + i * 28} 232`} stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}

export function PackagesDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes pk-dot { 0%, 10% { fill: #E8D5C8; } 25% { fill: #4A6B52; } 75% { fill: #4A6B52; } 90%, 100% { fill: #E8D5C8; } }
        @keyframes pk-prog { 0%, 10% { width: 0; } 25% { width: var(--pk-w); } 75% { width: var(--pk-w); } 90%, 100% { width: 0; } }
        @keyframes pk-text { 0%, 10% { opacity: 0; } 25% { opacity: 1; } 75% { opacity: 1; } 90%, 100% { opacity: 0; } }
        .pk-dot { animation: pk-dot 4s ease-in-out infinite; }
        .pk-d1 { animation-delay: 0s; } .pk-d2 { animation-delay: 0.4s; } .pk-d3 { animation-delay: 0.8s; } .pk-d4 { animation-delay: 1.2s; } .pk-d5 { animation-delay: 1.6s; }
        .pk-prog { animation: pk-prog 4s ease-in-out infinite; }
        .pk-text { animation: pk-text 4s ease-in-out infinite; animation-delay: 1.0s; }
        @media (prefers-reduced-motion: reduce) { .pk-dot, .pk-prog, .pk-text { animation: none; } .pk-d1, .pk-d2, .pk-d3 { fill: #4A6B52; } .pk-text { opacity: 1; } }
      `}</style>
      {/* Package card */}
      <rect x="80" y="40" width="240" height="200" rx="12" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      {/* Package title */}
      <text x="200" y="80" textAnchor="middle" fontSize="14" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Pacote Facial Premium</text>
      <text x="200" y="100" textAnchor="middle" fontSize="10" fill="#7A7A7A" fontFamily="sans-serif">5 sessões de preenchimento</text>
      {/* Session dots */}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          className={`pk-dot pk-d${i + 1}`}
          cx={140 + i * 30}
          cy={135}
          r="10"
          fill="#E8D5C8"
          stroke="#4A6B52"
          strokeWidth="1.5"
        />
      ))}
      {/* Counter text */}
      <text className="pk-text" x="200" y="170" textAnchor="middle" fontSize="12" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">3/5 sessões</text>
      {/* Progress bar track */}
      <rect x="120" y="185" width="160" height="8" rx="4" fill="#E8D5C8" />
      {/* Progress bar fill */}
      <rect className="pk-prog" x="120" y="185" height="8" rx="4" fill="#4A6B52" style={{ '--pk-w': '96px' } as React.CSSProperties} />
    </svg>
  )
}

export function CalendarDemo() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full h-full"
    >
      <style>{`
        @keyframes cal-block { 0%, 10% { opacity: 0; transform: scaleY(0); } 25% { opacity: 1; transform: scaleY(1); } 70% { opacity: 1; transform: scaleY(1); } 85%, 100% { opacity: 0; transform: scaleY(0); } }
        @keyframes cal-sync { 0%, 40% { opacity: 0; } 50%, 70% { opacity: 1; } 55%, 65% { transform: scale(1.1); } 85%, 100% { opacity: 0; } }
        .cal-block { transform-origin: top; animation: cal-block 4s ease-in-out infinite; }
        .cal-b1 { animation-delay: 0s; } .cal-b2 { animation-delay: 0.3s; } .cal-b3 { animation-delay: 0.6s; } .cal-b4 { animation-delay: 0.9s; } .cal-b5 { animation-delay: 0.4s; }
        .cal-sync { animation: cal-sync 4s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) { .cal-block, .cal-sync { animation: none; opacity: 1; transform: none; } }
      `}</style>
      {/* Calendar grid — 7 columns */}
      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day, i) => {
        const x = 52 + i * 46
        return (
          <g key={day}>
            <text x={x + 18} y={52} textAnchor="middle" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">{day}</text>
            <line x1={x} y1={58} x2={x + 36} y2={58} stroke="#E8D5C8" strokeWidth="1" />
            {/* Column lines */}
            <rect x={x} y={60} width="36" height="150" fill="none" stroke="#E8D5C8" strokeWidth="0.5" />
          </g>
        )
      })}
      {/* Appointment blocks */}
      <rect className="cal-block cal-b1" x="54" y="70" width="32" height="35" rx="4" fill="#4A6B52" opacity="0.7" />
      <rect className="cal-block cal-b2" x="146" y="90" width="32" height="45" rx="4" fill="#8FB49A" opacity="0.7" />
      <rect className="cal-block cal-b3" x="192" y="75" width="32" height="30" rx="4" fill="#4A6B52" opacity="0.7" />
      <rect className="cal-block cal-b4" x="284" y="110" width="32" height="40" rx="4" fill="#8FB49A" opacity="0.7" />
      <rect className="cal-block cal-b5" x="100" y="130" width="32" height="35" rx="4" fill="#4A6B52" opacity="0.5" />
      {/* Google sync icon area */}
      <g className="cal-sync" transform="translate(155, 228)">
        {/* "G" icon (simplified) */}
        <circle cx="0" cy="8" r="10" fill="white" stroke="#4A6B52" strokeWidth="1.5" />
        <text x="0" y="12" textAnchor="middle" fontSize="12" fill="#4A6B52" fontFamily="sans-serif" fontWeight="700">G</text>
        {/* Bi-directional arrow */}
        <line x1="16" y1="8" x2="56" y2="8" stroke="#4A6B52" strokeWidth="1.5" />
        <path d="M50 3 L58 8 L50 13" stroke="#4A6B52" strokeWidth="1.5" fill="none" />
        <path d="M22 3 L14 8 L22 13" stroke="#4A6B52" strokeWidth="1.5" fill="none" />
        {/* Calendar icon (simplified) */}
        <rect x="60" y="0" width="16" height="16" rx="2" stroke="#4A6B52" strokeWidth="1.5" fill="white" />
        <line x1="60" y1="5" x2="76" y2="5" stroke="#4A6B52" strokeWidth="1" />
      </g>
    </svg>
  )
}
```

- [ ] **Step 3: Run tests — all 22 tests green**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-demos.test.tsx`
Expected: All 22 tests pass (8 Group 1 + 7 Group 2 + 7 Group 3).

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @floraclin/site build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/feature-demos.tsx site/src/components/__tests__/feature-demos.test.tsx
git commit -m "feat(site): add SVG demos for Gestão do Negócio feature group"
```

---

## Group C (depends on A+B) — Feature Showcase Component

### Task 6: FeatureShowcase component

**Files:**
- Create: `site/src/components/feature-showcase.tsx`
- Create: `site/src/components/__tests__/feature-showcase.test.tsx`

- [ ] **Step 1: Write tests first**

Create `site/src/components/__tests__/feature-showcase.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureShowcase } from '../feature-showcase'

// Minimal demo stubs for testing behavior (not the real SVG demos)
function DemoA() { return <svg aria-hidden="true" data-testid="demo-a"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }
function DemoB() { return <svg aria-hidden="true" data-testid="demo-b"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }
function DemoC() { return <svg aria-hidden="true" data-testid="demo-c"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }

const TEST_GROUPS = [
  {
    label: 'Test Group',
    features: [
      { title: 'Feature One', description: 'Description one', demo: DemoA },
      { title: 'Feature Two', description: 'Description two', demo: DemoB },
      { title: 'Feature Three', description: 'Description three', demo: DemoC },
    ],
  },
]

describe('FeatureShowcase', () => {
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

  it('renders the section with id "recursos"', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(document.getElementById('recursos')).toBeInTheDocument()
  })

  it('renders the section heading', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByText('Feito para HOF. Não adaptado de outro sistema.')).toBeInTheDocument()
  })

  it('renders group label pill', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByText('Test Group')).toBeInTheDocument()
  })

  it('renders all feature titles', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByText('Feature One')).toBeInTheDocument()
    expect(screen.getByText('Feature Two')).toBeInTheDocument()
    expect(screen.getByText('Feature Three')).toBeInTheDocument()
  })

  it('shows first feature as active by default', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('uses proper tablist / tab / tabpanel ARIA roles', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('clicking a tab switches the active feature', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const tabs = screen.getAllByRole('tab')
    await user.click(tabs[1])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('renders the active demo component in the tabpanel', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByTestId('demo-a')).toBeInTheDocument()
  })

  it('renders a timer bar element', () => {
    const { container } = render(<FeatureShowcase groups={TEST_GROUPS} />)
    const timerBar = container.querySelector('[data-timer-bar]')
    expect(timerBar).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect module not found**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-showcase.test.tsx`
Expected: Fails because `feature-showcase.tsx` doesn't exist.

- [ ] **Step 3: Implement FeatureShowcase**

Create `site/src/components/feature-showcase.tsx`:

```tsx
'use client'

import { useRef, type ComponentType } from 'react'
import { FadeIn } from './fade-in'
import { useAutoCycle } from '@/hooks/use-auto-cycle'

interface FeatureShowcaseProps {
  groups: {
    label: string
    features: {
      title: string
      description: string
      demo: ComponentType
    }[]
  }[]
}

const GROUP_BG = ['bg-cream', 'bg-petal/40', 'bg-cream']
const CYCLE_INTERVAL = 5000

export function FeatureShowcase({ groups }: FeatureShowcaseProps) {
  return (
    <section id="recursos" className="py-0">
      <div className="bg-cream pt-16 md:pt-32 pb-0">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center mb-16 md:mb-20">
            <p className="section-label mb-4">Recursos</p>
            <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
              Feito para HOF. Não adaptado de outro sistema.
            </h2>
          </div>
        </div>
      </div>

      <div>
        {groups.map((group, groupIndex) => (
          <FeatureShowcaseGroup
            key={group.label}
            group={group}
            bgClass={GROUP_BG[groupIndex] ?? 'bg-cream'}
          />
        ))}
      </div>
    </section>
  )
}

function FeatureShowcaseGroup({
  group,
  bgClass,
}: {
  group: FeatureShowcaseProps['groups'][number]
  bgClass: string
}) {
  const { activeIndex, select, pause, resume } = useAutoCycle({
    count: group.features.length,
    interval: CYCLE_INTERVAL,
  })
  const containerRef = useRef<HTMLDivElement>(null)

  const activeFeature = group.features[activeIndex]
  const DemoComponent = activeFeature.demo

  return (
    <div className={`${bgClass} py-12 md:py-16`}>
      <div className="mx-auto max-w-[1200px] px-6">
        {/* Group label pill */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <span className="h-px w-8 bg-sage/30" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage px-3 py-1.5 bg-sage/8 rounded-full">
            {group.label}
          </p>
          <span className="h-px w-8 bg-sage/30" />
        </div>

        <FadeIn>
          <div
            ref={containerRef}
            className="bg-white rounded-2xl border border-sage/10 shadow-sm shadow-sage/5 overflow-hidden"
            onMouseEnter={pause}
            onMouseLeave={resume}
            onFocus={pause}
            onBlur={resume}
            onTouchStart={pause}
            onTouchEnd={resume}
          >
            {/* ── Desktop: side tabs ── */}
            <div className="hidden md:flex">
              {/* Left: tab list */}
              <div
                role="tablist"
                aria-label={group.label}
                className="w-[260px] shrink-0 border-r border-sage/10 py-4"
              >
                {group.features.map((feature, index) => {
                  const isActive = index === activeIndex
                  return (
                    <button
                      key={feature.title}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`panel-${group.label}-${index}`}
                      id={`tab-${group.label}-${index}`}
                      onClick={() => select(index)}
                      className={`
                        w-full text-left px-6 py-4 transition-colors relative
                        ${isActive
                          ? 'bg-sage/10 border-l-[3px] border-l-sage'
                          : 'border-l-[3px] border-l-transparent hover:bg-sage/5'
                        }
                      `}
                    >
                      <h3
                        className={`text-lg mb-1 ${
                          isActive ? 'text-forest' : 'text-charcoal/50'
                        }`}
                      >
                        {feature.title}
                      </h3>
                      <p
                        className={`text-sm leading-relaxed ${
                          isActive ? 'text-charcoal/70' : 'text-charcoal/40'
                        }`}
                      >
                        {feature.description}
                      </p>
                      {/* Timer bar */}
                      {isActive && (
                        <div className="mt-3 h-1 rounded-full bg-sage/10 overflow-hidden">
                          <div
                            data-timer-bar
                            className="h-full rounded-full bg-sage showcase-timer-bar"
                          />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Right: demo panel */}
              <div
                role="tabpanel"
                id={`panel-${group.label}-${activeIndex}`}
                aria-labelledby={`tab-${group.label}-${activeIndex}`}
                className="flex-1 flex items-center justify-center p-8"
              >
                <div className="w-full aspect-[16/10]">
                  <DemoComponent key={activeIndex} />
                </div>
              </div>
            </div>

            {/* ── Mobile: accordion ── */}
            <div className="md:hidden" role="tablist" aria-label={group.label}>
              {group.features.map((feature, index) => {
                const isActive = index === activeIndex
                const FeatureDemo = feature.demo
                return (
                  <div key={feature.title}>
                    <button
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`m-panel-${group.label}-${index}`}
                      id={`m-tab-${group.label}-${index}`}
                      onClick={() => select(index)}
                      className={`
                        w-full text-left px-5 py-4 transition-colors
                        ${isActive ? '' : 'opacity-50'}
                        ${index > 0 ? 'border-t border-sage/10' : ''}
                      `}
                    >
                      <h3 className="text-base">{feature.title}</h3>
                    </button>
                    {isActive && (
                      <div
                        role="tabpanel"
                        id={`m-panel-${group.label}-${index}`}
                        aria-labelledby={`m-tab-${group.label}-${index}`}
                        className="px-5 pb-5"
                      >
                        <div className="aspect-[16/10] mb-3">
                          <FeatureDemo key={activeIndex} />
                        </div>
                        <p className="text-sm text-charcoal/70 leading-relaxed mb-3">
                          {feature.description}
                        </p>
                        <div className="h-1 rounded-full bg-sage/10 overflow-hidden">
                          <div
                            data-timer-bar
                            className="h-full rounded-full bg-sage showcase-timer-bar"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — all green**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose src/components/__tests__/feature-showcase.test.tsx`
Expected: All 9 tests pass.

- [ ] **Step 5: Run all tests together**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose`
Expected: All tests pass (hook tests + demo tests + showcase tests).

- [ ] **Step 6: Commit**

```bash
git add site/src/components/feature-showcase.tsx site/src/components/__tests__/feature-showcase.test.tsx
git commit -m "feat(site): add FeatureShowcase component with tabbed layout and auto-cycling"
```

---

## Group D (depends on C) — CSS + Integration

### Task 7: Timer bar animation CSS

**Files:**
- Modify: `site/src/app/globals.css`

- [ ] **Step 1: Add showcase timer bar keyframes and reduced-motion rules**

Append to `site/src/app/globals.css` (before the closing of the file):

```css
/* Feature showcase timer bar */
@keyframes showcase-timer-fill {
  from { width: 0%; }
  to { width: 100%; }
}

.showcase-timer-bar {
  animation: showcase-timer-fill 5s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .showcase-timer-bar {
    animation: none;
    width: 100%;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @floraclin/site build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add site/src/app/globals.css
git commit -m "feat(site): add timer bar animation CSS for feature showcase"
```

---

### Task 8: Wire FeatureShowcase into page.tsx

**Files:**
- Modify: `site/src/app/page.tsx`

- [ ] **Step 1: Replace Features import with FeatureShowcase**

Edit `site/src/app/page.tsx`:

Replace:
```tsx
import { Features } from "@/components/features";
```
With:
```tsx
import { FeatureShowcase } from "@/components/feature-showcase";
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
  GuidedFlowDemo,
  DigitalSignatureDemo,
  SelfServiceDemo,
  FinancialDemo,
  PackagesDemo,
  CalendarDemo,
} from "@/components/feature-demos";
```

Replace:
```tsx
        <Features />
```
With:
```tsx
        <FeatureShowcase
          groups={[
            {
              label: "Precisão Clínica Visual",
              features: [
                {
                  title: "Diagrama Facial Interativo",
                  description:
                    "Mapeie cada ponto de aplicação no rosto do paciente. Produto, profundidade, quantidade e localização exata, tudo registrado visualmente e vinculado ao prontuário.",
                  demo: FaceDiagramDemo,
                },
                {
                  title: "Antes e Depois que Convence",
                  description:
                    "O sistema alinha as fotos automaticamente para que a comparação seja justa. Seu paciente vê o resultado real, você documenta com precisão.",
                  demo: BeforeAfterDemo,
                },
                {
                  title: "Captura Guiada + Anotações",
                  description:
                    "Guia de pose na câmera (frontal, perfil, oblíquo) com captura automática quando o rosto está alinhado e em foco. Anote com setas, círculos e régua de medição.",
                  demo: GuidedCaptureDemo,
                },
              ],
            },
            {
              label: "Fluxo sem Atrito",
              features: [
                {
                  title: "Atendimento Guiado Passo a Passo",
                  description:
                    "O sistema conduz o fluxo: anamnese, avaliação, planejamento, aprovação, execução, acompanhamento. Você só segue. Nenhuma etapa esquecida.",
                  demo: GuidedFlowDemo,
                },
                {
                  title: "Assinatura Digital pelo WhatsApp",
                  description:
                    "Termos de consentimento e contratos assinados pelo paciente no celular, direto pelo link no WhatsApp. 100% seguro, sem papel, sem complicação.",
                  demo: DigitalSignatureDemo,
                },
                {
                  title: "Anamnese e Agendamento Self-service",
                  description:
                    "O paciente agenda online e preenche a anamnese pelo celular antes da consulta. Sem cadastro, sem senha, sem ligar pra clínica.",
                  demo: SelfServiceDemo,
                },
              ],
            },
            {
              label: "Gestão do Negócio",
              features: [
                {
                  title: "Financeiro Completo",
                  description:
                    "Cobranças parceladas, despesas recorrentes, comissão por profissional, multa e juros automáticos, renegociação e estorno. Em breve: links de pagamento por PIX, boleto e cartão.",
                  demo: FinancialDemo,
                },
                {
                  title: "Pacotes e Controle de Sessões",
                  description:
                    "Venda pacotes de procedimentos e acompanhe sessões realizadas vs. contratadas. Sem planilha, sem erro.",
                  demo: PackagesDemo,
                },
                {
                  title: "Agenda com Google Calendar",
                  description:
                    "Visualização por profissional, agendamento online pelo paciente e sincronização bidirecional com Google Calendar. Sem conflito de horário.",
                  demo: CalendarDemo,
                },
              ],
            },
          ]}
        />
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @floraclin/site build`
Expected: Build succeeds with no type errors and no warnings.

- [ ] **Step 3: Run all tests one final time**

Run: `pnpm --filter @floraclin/site test:run -- --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add site/src/app/page.tsx
git commit -m "feat(site): wire FeatureShowcase into landing page, replacing static card grid"
```

---

## Summary

| Group | Tasks | Files touched | Depends on |
|-------|-------|---------------|------------|
| **A** | 1 (vitest setup), 2 (useAutoCycle hook), 3 (SVG demos Group 1) | All create new files — fully parallel | — |
| **B** | 4 (SVG demos Group 2), 5 (SVG demos Group 3) | Both modify feature-demos.tsx — run sequentially within B | A (Task 3 creates the file) |
| **C** | 6 (FeatureShowcase component) | Creates feature-showcase.tsx — depends on hook + demos | A + B |
| **D** | 7 (CSS), 8 (page.tsx wiring) | globals.css, page.tsx — parallel within D | C |

**Total: 8 tasks, 10 new files, 2 modified files, ~31 tests.**
