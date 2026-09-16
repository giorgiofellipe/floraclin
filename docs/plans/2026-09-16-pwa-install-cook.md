# PWA Install Baseline: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FloraClin web app installable to a phone home screen, with a correct icon, standalone display, and a small mobile banner that tells staff how to install it.

**Architecture:** Next.js 16 file conventions do the heavy lifting: `app/manifest.ts` is served as `/manifest.webmanifest` and linked automatically, `app/apple-icon.png` becomes the iOS touch icon, and `viewport` / `metadata` exports in the root layout emit the theme color and web app tags. The auth middleware must let `/manifest.webmanifest` through unauthenticated, or Chrome never sees a manifest. PNG icons are rendered once from the existing `app/icon.svg` with `rsvg-convert` and committed under `public/icons/`. A client component `InstallBanner` sits under the subscription banner in the platform layout; it is hidden on desktop by CSS, hidden in standalone mode and after dismissal by JS, and shows install instructions (iOS share sheet, or the browser menu elsewhere) plus an "Instalar" button when Chrome hands it a `beforeinstallprompt` event.

**Tech Stack:** Next.js 16.2 App Router (`MetadataRoute.Manifest`, `Viewport`), React 19, Tailwind 4, Vitest + Testing Library (jsdom), `rsvg-convert` (Homebrew librsvg) for one-time PNG rendering.

**Spec:** Design approved in chat on 2026-09-16 (bounded task, no spec file). Summary: install to home screen for clinic staff only, `start_url` is `/dashboard`, no service worker, no offline, no push. Install prompt is a dismissable banner in the platform layout, mobile only, same look as the trial banner. Public patient pages (`/a`, `/c`, `/sign`) get no banner. The manifest itself is global (a root file convention links it on every page), so Chrome may still show its own install entry on the public booking page; only the custom banner is excluded.

## Global Constraints

Every task's requirements implicitly include this section.

- **No em dashes or en dashes in any text**: code comments, UI copy, test names. Use a comma, a colon, or parentheses.
- **Do NOT run `git add`, `git commit` or `git push` inside a task.** Tasks in the same group run in parallel and share the Git index. The orchestrator stages after each group. The user commits.
- **Only touch the files listed in your task.**
- **Comments**: default is no comment. Write one only where a competent reader would otherwise get it wrong.
- **UI copy is pt-BR**, matching the existing banners in `web/src/components/layout/subscription-banner.tsx`.
- **Brand colors**: forest `#1C2B1E`, mint `#8FB49A`, sage `#4A6B52` (from `web/src/app/globals.css`). Tailwind exposes `forest`, `sage`, `mint` as color names.
- **Lint rule `react-hooks/set-state-in-effect` is an error in this repo.** Browser-only state set inside an effect uses the existing pattern: `// eslint-disable-next-line react-hooks/set-state-in-effect -- <reason>` on the line above the call (see `web/src/components/financial/payment-form.tsx:57`).
- **Paths in this plan are relative to the repo root.** Test and pnpm commands run from `web/`, or use `pnpm --filter @floraclin/web`.
- Run `pnpm --filter @floraclin/web test:run` and `pnpm --filter @floraclin/web lint` after each task. Full gate is `pnpm ci:checks` from the repo root.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `web/scripts/generate-icons.sh` | Renders every PNG icon from `web/src/app/icon.svg`. Idempotent. | 1 |
| `web/public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` | Manifest icons, committed output of the script | 1 |
| `web/src/app/apple-icon.png` | iOS touch icon, opaque full-bleed square (Next.js `apple-icon` convention accepts only jpg, jpeg, png). Replaces the ignored `apple-icon.svg`. | 1 |
| `web/src/app/manifest.ts` | Web app manifest served at `/manifest.webmanifest` | 1 |
| `web/src/app/__tests__/manifest.test.ts` | Manifest shape, icon files exist and have the declared PNG dimensions | 1 |
| `web/src/middleware.ts` | Adds `/manifest.webmanifest` to the public routes | 1 |
| `web/src/__tests__/middleware.test.ts` | Unauthenticated manifest request is not redirected | 1 |
| `web/package.json` | `icons:generate` script | 1 |
| `web/src/app/layout.tsx` | `viewport` export (theme color) and `appleWebApp` metadata | 2 |
| `web/src/components/layout/install-banner.tsx` | Mobile install banner, client component | 3 |
| `web/src/components/layout/__tests__/install-banner.test.tsx` | Banner show and hide logic | 3 |
| `web/src/app/(platform)/layout.tsx` | Renders `InstallBanner` under `SubscriptionBanner` | 4 |

## Parallelization Groups

```
Group A (parallel):
  Task 1: Icons, manifest, public manifest route (files: web/scripts/generate-icons.sh, web/public/icons/*.png, web/src/app/apple-icon.png, delete web/src/app/apple-icon.svg, web/src/app/manifest.ts, web/src/app/__tests__/manifest.test.ts, web/src/middleware.ts, web/src/__tests__/middleware.test.ts, web/package.json)
  Task 2: Root layout viewport and Apple web app metadata (files: web/src/app/layout.tsx)
  Task 3: InstallBanner component and tests (files: web/src/components/layout/install-banner.tsx, web/src/components/layout/__tests__/install-banner.test.tsx)

Group B (depends on A):
  Task 4: Wire InstallBanner into the platform layout and run the full gate (files: web/src/app/(platform)/layout.tsx)
```

---

### Task 1: Icons, manifest, public manifest route

**Files:**
- Create: `web/scripts/generate-icons.sh`
- Create: `web/public/icons/icon-192.png`, `web/public/icons/icon-512.png`, `web/public/icons/maskable-512.png` (script output)
- Create: `web/src/app/apple-icon.png` (script output)
- Delete: `web/src/app/apple-icon.svg` (plain `rm`, not `git rm`)
- Create: `web/src/app/manifest.ts`
- Test: `web/src/app/__tests__/manifest.test.ts`
- Modify: `web/src/middleware.ts:17-30` (public routes list)
- Test: `web/src/__tests__/middleware.test.ts` (append one describe block)
- Modify: `web/package.json` (add one script line)

**Interfaces:**
- Consumes: `web/src/app/icon.svg` (existing, unchanged: opening `<svg>` tag alone on line 1, `</svg>` alone on line 10, eight drawing elements between).
- Produces: `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/maskable-512.png` public URLs, `/apple-icon.png`, and `/manifest.webmanifest` (auto-linked by Next.js, publicly reachable). Task 2 and Task 3 do not import anything from this task.

- [ ] **Step 1: Write the failing manifest test**

Create `web/src/app/__tests__/manifest.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Width and height live in the IHDR chunk right after the 8 byte signature and
// the 8 byte chunk header, so no image library is needed to read them.
function pngSize(file: string) {
  const buf = readFileSync(file)
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
}

describe('manifest', () => {
  const m = manifest()

  it('opens on the dashboard as a standalone app', () => {
    expect(m.start_url).toBe('/dashboard')
    expect(m.display).toBe('standalone')
    expect(m.name).toBe('FloraClin')
    expect(m.short_name).toBe('FloraClin')
    expect(m.lang).toBe('pt-BR')
    expect(m.theme_color).toBe('#1C2B1E')
    expect(m.background_color).toBe('#FFFFFF')
  })

  it('declares 192, 512 and a maskable 512 PNG icon', () => {
    const icons = m.icons ?? []
    expect(icons).toHaveLength(3)
    expect(icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512'])
    expect(icons.every((i) => i.type === 'image/png')).toBe(true)
    expect(icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1)
  })

  it('points every icon at a PNG in public/ with the declared size', () => {
    for (const icon of m.icons ?? []) {
      expect(pngSize(path.join(process.cwd(), 'public', icon.src))).toBe(icon.sizes)
    }
  })

  it('ships a 180x180 PNG touch icon for iOS', () => {
    expect(pngSize(path.join(process.cwd(), 'src/app/apple-icon.png'))).toBe('180x180')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web/`: `pnpm exec vitest run src/app/__tests__/manifest.test.ts`
Expected: FAIL, cannot resolve `../manifest`.

- [ ] **Step 3: Write the icon generation script**

Create `web/scripts/generate-icons.sh`:

```bash
#!/usr/bin/env bash
# Renders the PWA icons from src/app/icon.svg. Needs librsvg (brew install librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=src/app/icon.svg
OUT=public/icons
mkdir -p "$OUT"

# The source icon is a rounded forest square with transparent corners. That is
# right for the favicon and the manifest "any" icons, but iOS and Android
# launchers apply their own mask, so those get the same artwork on an opaque
# square. The inset argument leaves a margin for the launcher's crop.
opaque_square() {
  local inset=$1
  local size=$((52 + inset * 2))
  echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 $size $size\">"
  echo "<rect width=\"$size\" height=\"$size\" fill=\"#1C2B1E\"/>"
  echo "<svg x=\"$inset\" y=\"$inset\" width=\"52\" height=\"52\" viewBox=\"0 0 52 52\">"
  sed -e '1d' -e '$d' "$SRC"
  echo '</svg></svg>'
}

rsvg-convert -w 192 -h 192 "$SRC" -o "$OUT/icon-192.png"
rsvg-convert -w 512 -h 512 "$SRC" -o "$OUT/icon-512.png"

APPLE=$(mktemp -t apple.XXXXXX.svg)
opaque_square 0 > "$APPLE"
rsvg-convert -w 180 -h 180 "$APPLE" -o src/app/apple-icon.png

MASKABLE=$(mktemp -t maskable.XXXXXX.svg)
opaque_square 6 > "$MASKABLE"
rsvg-convert -w 512 -h 512 "$MASKABLE" -o "$OUT/maskable-512.png"

rm -f "$APPLE" "$MASKABLE"
echo "icons written to $OUT and src/app/apple-icon.png"
```

Make it executable: `chmod +x web/scripts/generate-icons.sh`.

- [ ] **Step 4: Add the package.json script and run the generator**

In `web/package.json`, add to `"scripts"` right after `"tokens:encrypt"`:

```json
"icons:generate": "bash scripts/generate-icons.sh"
```

Run from `web/`: `pnpm icons:generate`

Then delete the ignored SVG touch icon: `rm web/src/app/apple-icon.svg` (from repo root). Do not use `git rm`.

Verify the output: `file web/public/icons/*.png web/src/app/apple-icon.png`
Expected: PNG image data, 192 x 192; 512 x 512; 512 x 512; 180 x 180.

Verify the Apple icon corners are opaque: `magick web/src/app/apple-icon.png -format '%[pixel:p{0,0}]' info:`
Expected: `srgb(28,43,30)` (forest), not `none` or a transparent value.

- [ ] **Step 5: Write the manifest**

Create `web/src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FloraClin',
    short_name: 'FloraClin',
    description: 'Sistema para clínicas de Harmonização Orofacial',
    lang: 'pt-BR',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#1C2B1E',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

- [ ] **Step 6: Run the manifest test to verify it passes**

Run from `web/`: `pnpm exec vitest run src/app/__tests__/manifest.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the failing middleware test**

Append to `web/src/__tests__/middleware.test.ts` (after the last `describe` block):

```ts
describe('middleware: the web app manifest is public', () => {
  it('serves /manifest.webmanifest to an unauthenticated browser', () => {
    // Chrome fetches the manifest without cookies before it decides the app
    // is installable. A redirect to /login here means no install prompt, ever.
    const res = run('/manifest.webmanifest', null)
    expect(locationOf(res)).toBeNull()
  })
})
```

Run from `web/`: `pnpm exec vitest run src/__tests__/middleware.test.ts`
Expected: the new test FAILS (location is `/login`), the others pass.

- [ ] **Step 8: Make the manifest route public**

In `web/src/middleware.ts`, inside the "Public routes" `if` condition, add one line right before `pathname.startsWith('/api/')`:

```ts
    pathname === '/manifest.webmanifest' ||
```

The `config.matcher` regex at the bottom of the file already routes this path into the middleware, so nothing else changes there.

- [ ] **Step 9: Run the middleware test to verify it passes**

Run from `web/`: `pnpm exec vitest run src/__tests__/middleware.test.ts`
Expected: PASS, all tests.

- [ ] **Step 10: Lint**

Run from repo root: `pnpm --filter @floraclin/web lint`
Expected: clean.

---

### Task 2: Root layout viewport and Apple web app metadata

**Files:**
- Modify: `web/src/app/layout.tsx:1-20`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `<meta name="theme-color">`, `<meta name="mobile-web-app-capable">`, `<meta name="apple-mobile-web-app-title">`, `<meta name="apple-mobile-web-app-status-bar-style">`, `<meta name="application-name">` in every page head. Next.js 16.2.3 renders `appleWebApp.capable` as `mobile-web-app-capable` (see `node_modules/next/dist/esm/lib/metadata/metadata.js:587`); iOS reads `display: standalone` from the manifest, so the legacy `apple-mobile-web-app-capable` tag is not added.

There is no unit test for this task: `layout.tsx` imports `next/font/google` and `next-intl/server`, which do not load under Vitest. Verification is typecheck plus a grep of the rendered HTML in Task 4.

- [ ] **Step 1: Replace the metadata block**

In `web/src/app/layout.tsx`, change the first import and the `metadata` export:

```ts
import type { Metadata, Viewport } from 'next'
```

```ts
export const viewport: Viewport = {
  themeColor: '#1C2B1E',
}

export const metadata: Metadata = {
  title: 'FloraClin',
  description: 'Sistema para clínicas de Harmonização Orofacial',
  applicationName: 'FloraClin',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FloraClin',
  },
}
```

Do not add `viewportFit: 'cover'`. The header is sticky at the top and nothing pads for safe-area insets; with `default` status bar style iOS keeps the status bar opaque and the page starts below it.

Do not put `themeColor` inside `metadata`. Next.js 14+ deprecates it there and logs a warning; it belongs in `viewport`.

- [ ] **Step 2: Typecheck and lint**

Run from repo root: `pnpm --filter @floraclin/web typecheck && pnpm --filter @floraclin/web lint`
Expected: no errors.

---

### Task 3: InstallBanner component and tests

**Files:**
- Create: `web/src/components/layout/install-banner.tsx`
- Test: `web/src/components/layout/__tests__/install-banner.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export function InstallBanner(): JSX.Element | null`, no props. Task 4 imports it from `@/components/layout/install-banner`.

Behavior:
- Wrapper has Tailwind `md:hidden`, so desktop never sees it.
- Hidden when the page runs as an installed app: `display-mode` is `standalone` or `fullscreen`, or iOS reports `navigator.standalone`.
- Hidden when `localStorage` has `floraclin.install-banner.dismissed`. Reads and writes are wrapped in try/catch; a throwing storage counts as "not dismissed".
- iOS (`/iPhone|iPad|iPod/` in `navigator.userAgent`, or a Macintosh user agent with touch points, which is how iPadOS Safari presents itself): shows share sheet instructions.
- Every other mobile browser: shows browser menu instructions. If the browser fires `beforeinstallprompt` while the viewport is under 768px, the handler calls `preventDefault()`, keeps the event, and the banner adds an "Instalar" button. On wider viewports the handler ignores the event so the browser keeps its own install UI where the banner is invisible.
- The kept event is one-shot. Clicking "Instalar" hides the banner (which unmounts the button) and then calls `prompt()`, so a dismissed native dialog or a double tap never reuses a spent event. If the event fired before the banner mounted, the banner still shows the menu instructions; Chrome fires the event again on the next page load.
- `appinstalled` hides the banner and writes the dismiss key, so a later visit in a normal tab does not ask again (covers installs started from the browser menu).
- Dismiss (X) hides the banner and writes the storage key.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/layout/__tests__/install-banner.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InstallBanner } from '../install-banner'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

// jsdom has no matchMedia, and its userAgent lives on Navigator.prototype, so
// both are defined as own configurable properties and removed after each test.
function stubEnvironment({ standalone = false, mobile = true, userAgent = ANDROID_UA } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)' ? standalone : mobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
}

function fireInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'dismissed' as const })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
  delete (navigator as { userAgent?: unknown }).userAgent
  vi.restoreAllMocks()
})

describe('InstallBanner', () => {
  it('renders nothing when already running as an installed app', () => {
    stubEnvironment({ standalone: true, userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing after the user dismissed it before', () => {
    localStorage.setItem('floraclin.install-banner.dismissed', '1')
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('tells iOS users to use Share and Add to Home Screen', () => {
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(screen.getByRole('status')).toHaveTextContent(/Adicionar à Tela de Início/)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('tells other mobile browsers to use the browser menu until the browser offers to install', () => {
    stubEnvironment()
    render(<InstallBanner />)
    expect(screen.getByRole('status')).toHaveTextContent(/menu do navegador/i)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('shows an install button once the browser offers to install, prompts once, then hides', async () => {
    stubEnvironment()
    render(<InstallBanner />)
    const event = fireInstallPrompt()
    expect(event.defaultPrevented).toBe(true)

    const button = await screen.findByRole('button', { name: /instalar/i })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(event.prompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('leaves the browser install prompt alone on wide viewports', async () => {
    stubEnvironment({ mobile: false })
    render(<InstallBanner />)
    const event = fireInstallPrompt()

    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('hides once the app gets installed from the browser menu', () => {
    stubEnvironment()
    render(<InstallBanner />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    window.dispatchEvent(new Event('appinstalled'))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hides and remembers the dismissal', () => {
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)

    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem('floraclin.install-banner.dismissed')).toBe('1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `pnpm exec vitest run src/components/layout/__tests__/install-banner.test.tsx`
Expected: FAIL, cannot resolve `../install-banner`.

- [ ] **Step 3: Write the component**

Create `web/src/components/layout/install-banner.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'

const DISMISSED_KEY = 'floraclin.install-banner.dismissed'
// Tailwind's md breakpoint, where the wrapper's md:hidden takes over. Above it
// the browser must keep its own install UI, because ours is invisible.
const MOBILE_QUERY = '(max-width: 767px)'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
}

type Mode = 'hidden' | 'ios' | 'other'

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Blocked storage: the banner still hides for this page view.
  }
}

export function InstallBanner() {
  const [mode, setMode] = useState<Mode>('hidden')
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (readDismissed()) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only decision; the server render must stay empty to match hydration
    setMode(/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'other')

    const onBeforeInstallPrompt = (event: Event) => {
      if (!window.matchMedia(MOBILE_QUERY).matches) return
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setMode('hidden')
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (mode === 'hidden') return null

  const dismiss = () => {
    writeDismissed()
    setMode('hidden')
  }

  const install = () => {
    if (!installEvent) return
    setInstallEvent(null)
    setMode('hidden')
    void installEvent.prompt()
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-sage/20 bg-sage/10 px-4 py-2 text-sm text-forest md:hidden"
    >
      {mode === 'ios' ? (
        <p>
          Instale o FloraClin: toque em <Share className="inline size-4 align-text-bottom" aria-label="Compartilhar" /> e depois em{' '}
          <span className="font-medium">Adicionar à Tela de Início</span>.
        </p>
      ) : (
        <p>Instale o FloraClin: no menu do navegador, toque em <span className="font-medium">Instalar app</span>.</p>
      )}
      {installEvent && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-md bg-forest px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-sage"
        >
          Instalar
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-sage/20"
        aria-label="Fechar"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`: `pnpm exec vitest run src/components/layout/__tests__/install-banner.test.tsx`
Expected: PASS, 8 tests.

If the "prompts once, then hides" test finds the button gone before the second click: that is fine, `fireEvent.click` on a detached node is a no-op and `prompt` still has exactly one call.

- [ ] **Step 5: Lint**

Run from repo root: `pnpm --filter @floraclin/web lint`
Expected: clean. If `react-hooks/set-state-in-effect` still fires, the disable comment must be on the line directly above the `setMode(` call.

---

### Task 4: Wire InstallBanner into the platform layout

**Files:**
- Modify: `web/src/app/(platform)/layout.tsx:1-10` (import) and `:71-75` (render)

**Interfaces:**
- Consumes: `InstallBanner` from `@/components/layout/install-banner` (Task 3).
- Produces: banner rendered on every platform page, below the subscription banner, above `<main>`. Never rendered by `/a`, `/c`, `/sign` or the auth pages, which live outside the `(platform)` group.

- [ ] **Step 1: Add the import**

In `web/src/app/(platform)/layout.tsx`, after the `SubscriptionBanner` import add:

```ts
import { InstallBanner } from '@/components/layout/install-banner'
```

- [ ] **Step 2: Render it**

Right after the `<SubscriptionBanner ... />` element and before `<main className="flex-1 p-6">`, add:

```tsx
        <InstallBanner />
```

- [ ] **Step 3: Run the full gate**

Run from repo root: `pnpm ci:checks`
Expected: lint, typecheck and tests all green.

- [ ] **Step 4: Check the rendered head and the manifest**

Start the dev server from `web/`: `pnpm dev`

In another shell:

```bash
curl -s http://localhost:3000/login | grep -o '<link[^>]*manifest[^>]*>\|<meta name="theme-color"[^>]*>\|<meta name="mobile-web-app-capable"[^>]*>\|<meta name="apple-mobile-web-app-[a-z-]*"[^>]*>'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3000/manifest.webmanifest
curl -s http://localhost:3000/manifest.webmanifest
```

Expected: a `manifest` link to `/manifest.webmanifest`, a `theme-color` meta with `#1C2B1E`, `mobile-web-app-capable`, `apple-mobile-web-app-title` and `apple-mobile-web-app-status-bar-style`; then `200 application/manifest+json` with no session cookie, and the JSON from Task 1. Stop the dev server.

---

## Manual verification (after the pipeline, by the user)

Install behaviour needs HTTPS, so this runs against a Vercel preview deploy:

1. iPhone Safari: open the preview, log in. The green banner shows with the share instructions. Share, Add to Home Screen. The home icon is a solid forest square with the leaf, rounded by iOS. Opening it shows no browser chrome and lands on `/dashboard`.
2. Android Chrome: open the preview, log in. The banner shows the browser menu instructions. Chrome fires `beforeinstallprompt` only after its engagement heuristic (an interaction plus roughly 30 seconds on the site), so wait, or use a profile that has visited before; then the "Instalar" button appears. Tap it and accept. The launcher icon uses the maskable variant with no clipped leaf. Chrome's own install entry in the menu works too.
3. On both, reopen the installed app: no banner.
4. Desktop browser at any width above 768px: no banner, and Chrome's own install icon in the address bar still appears.
5. Public pages `/c/<slug>`, `/a/<token>`, `/sign/<token>` on a phone: no banner.
