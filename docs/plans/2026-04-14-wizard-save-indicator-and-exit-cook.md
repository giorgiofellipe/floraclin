# Wizard Save Indicator + "Salvar e sair" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a save-status indicator to the middle of the wizard's fixed bottom bar, and a new "Salvar e sair" button next to "Próximo" on steps 1 and 3 that saves and exits without advancing.

**Architecture:** A new `SaveStatusIndicator` pure component renders one of five states (empty / dirty / saving / saved / error) from props. The wizard tracks per-step dirty state in a `Record<number, boolean>` and passes stable per-step `onDirtyChange` callbacks into each form's `wizardOverrides`. Each form reports dirty state using a local `hasUnsavedChanges` useState flipped true via (a) a container-level `input`/`change` event listener for standard DOM inputs and (b) explicit `markDirty()` calls for non-DOM interactions (face diagram edits). Save-and-exit is driven by a `pendingActionRef` in the wizard, checked inside `handleStepComplete` to branch between `nextStep()` and `router.push(...)`.

**Tech Stack:** React 19, Next.js 16 (App Router), TypeScript, Tailwind, lucide-react icons, Vitest + @testing-library/react.

**Important deviation from spec:** The spec referenced `react-hook-form`'s `formState.isDirty`, but only `AnamnesisForm` uses RHF (and its `isDirty` is permanently true after first edit since `reset()` is never called). All other forms are plain `useState`. This plan uses container event listeners + explicit `markDirty()` for face diagram interactions instead. Covers all user-driven changes without a form-library migration.

**Commit policy:** This plan intentionally omits commit steps. The user prefers to review all changes before a single commit. After the full plan is implemented and verified, await explicit permission before committing.

---

## File Structure

**New files:**
- `web/src/components/service-wizard/save-status-indicator.tsx` — pure presentational component, 5 states
- `web/src/components/service-wizard/__tests__/save-status-indicator.test.tsx` — unit tests for the component
- `web/src/lib/__tests__/relative-time.test.ts` — unit tests for the relative-time helper
- `web/src/lib/relative-time.ts` — `formatRelativeSaveTime(date: Date, now: Date)` helper

**Modified files:**
- `web/src/components/service-wizard/types.ts` — add `onDirtyChange`, `onAutoSaved` to `WizardOverrides`
- `web/src/components/service-wizard/service-wizard.tsx` — dirty state, `pendingActionRef`, `handleSaveAndExit`, indicator slot, new button
- `web/src/components/anamnesis/anamnesis-form.tsx` — dirty tracking via watch + onAutoSaved propagation
- `web/src/components/procedures/procedure-form.tsx` — dirty tracking via container listener + face diagram markDirty
- `web/src/components/procedures/procedure-approval.tsx` — dirty tracking via container listener
- `web/src/components/procedures/procedure-execution.tsx` — dirty tracking via container listener
- `web/src/app/(platform)/pacientes/[id]/atendimento/loading.tsx` — skeleton middle slot to match new layout

## Parallelization Groups

**Group A (sequential — blocks all later groups):** 1 task — types update.

**Group B (parallel — 6 tasks, each independent, each depends on A):**
- B1: SaveStatusIndicator component + tests
- B2: relative-time helper + tests
- B3: AnamnesisForm dirty tracking
- B4: ProcedureForm dirty tracking (includes face diagram)
- B5: ProcedureApproval dirty tracking
- B6: ProcedureExecution dirty tracking
- B7: Atendimento loading skeleton

(B1–B7 have zero file overlap — safe to dispatch in parallel.)

**Group C (sequential — depends on all of B):** 1 task — wire everything in service-wizard.tsx.

---

## Group A: Types

### Task A1: Extend WizardOverrides type

**Files:**
- Modify: `web/src/components/service-wizard/types.ts`

- [ ] **Step 1: Add new optional fields**

Replace the current `WizardOverrides` interface with:

```ts
export interface WizardOverrides {
  hideSaveButton: boolean
  hideNavigation: boolean
  hideTitle: boolean
  hideProcedureTypes?: boolean
  onSaveComplete?: (result: StepResult) => void
  triggerSave?: number
  /**
   * Called by the form whenever its unsaved-changes state flips.
   * Wizard uses this to drive the bottom-bar save indicator.
   */
  onDirtyChange?: (isDirty: boolean) => void
  /**
   * For forms with background auto-save (e.g. AnamnesisForm).
   * Called after a successful non-triggerSave save so the wizard
   * can update stepTimestamps without advancing the step.
   */
  onAutoSaved?: (timestamp: Date) => void
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

## Group B: Parallel implementations

### Task B1: SaveStatusIndicator component + tests

**Files:**
- Create: `web/src/components/service-wizard/save-status-indicator.tsx`
- Create: `web/src/components/service-wizard/__tests__/save-status-indicator.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/service-wizard/__tests__/save-status-indicator.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaveStatusIndicator } from '../save-status-indicator'

describe('SaveStatusIndicator', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('renders nothing in empty state (no timestamp, not dirty, not saving, no error)', () => {
    const { container } = render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={false}
        lastSavedAt={null}
        errorType={null}
        now={now}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows "Salvando..." when isSaving is true (highest priority)', () => {
    render(
      <SaveStatusIndicator
        isSaving={true}
        isDirty={true}
        lastSavedAt={new Date('2026-04-14T11:58:00Z')}
        errorType={null}
        now={now}
      />,
    )
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvando...')
  })

  it('shows "Erro ao salvar" when errorType is server', () => {
    render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={false}
        lastSavedAt={null}
        errorType="server"
        now={now}
      />,
    )
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Erro ao salvar')
  })

  it('shows "Alterações não salvas" when dirty and not saving/error', () => {
    render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={true}
        lastSavedAt={null}
        errorType={null}
        now={now}
      />,
    )
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Alterações não salvas')
  })

  it('shows "Salvo há 2min" when has timestamp 2 minutes ago and not dirty', () => {
    render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={false}
        lastSavedAt={new Date('2026-04-14T11:58:00Z')}
        errorType={null}
        now={now}
      />,
    )
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo há 2min')
  })

  it('shows "Salvo agora" when saved under 1 minute ago', () => {
    render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={false}
        lastSavedAt={new Date('2026-04-14T11:59:40Z')}
        errorType={null}
        now={now}
      />,
    )
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo agora')
  })

  it('dirty state wins over saved timestamp', () => {
    render(
      <SaveStatusIndicator
        isSaving={false}
        isDirty={true}
        lastSavedAt={new Date('2026-04-14T11:58:00Z')}
        errorType={null}
        now={now}
      />,
    )
    const el = screen.getByTestId('save-status-indicator')
    expect(el).toHaveTextContent('Alterações não salvas')
    expect(el).not.toHaveTextContent('Salvo há')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @floraclin/web test save-status-indicator`
Expected: FAIL — `SaveStatusIndicator` does not exist.

- [ ] **Step 3: Create the component**

Create `web/src/components/service-wizard/save-status-indicator.tsx`:

```tsx
'use client'

import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeSaveTime } from '@/lib/relative-time'

export interface SaveStatusIndicatorProps {
  isSaving: boolean
  isDirty: boolean
  lastSavedAt: Date | null
  errorType: 'validation' | 'precondition' | 'server' | null
  /**
   * Current time, passed in so parent can re-render on interval and keep the
   * relative label fresh. Also makes the component trivially testable.
   */
  now: Date
}

// State priority (highest wins): saving > error > dirty > saved > empty
export function SaveStatusIndicator({
  isSaving,
  isDirty,
  lastSavedAt,
  errorType,
  now,
}: SaveStatusIndicatorProps) {
  if (isSaving) {
    return (
      <div
        data-testid="save-status-indicator"
        className="hidden md:flex items-center gap-1.5 text-[12px] text-mid"
      >
        <Loader2 className="size-3 animate-spin text-mid" />
        <span>Salvando...</span>
      </div>
    )
  }

  if (errorType === 'server') {
    return (
      <div
        data-testid="save-status-indicator"
        className="hidden md:flex items-center gap-1.5 text-[12px] text-red-600"
      >
        <AlertCircle className="size-3" />
        <span>Erro ao salvar</span>
      </div>
    )
  }

  if (isDirty) {
    return (
      <div
        data-testid="save-status-indicator"
        className="hidden md:flex items-center gap-1.5 text-[12px] text-amber-700"
      >
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        <span>Alterações não salvas</span>
      </div>
    )
  }

  if (lastSavedAt) {
    return (
      <div
        data-testid="save-status-indicator"
        className={cn(
          'hidden md:flex items-center gap-1.5 text-[12px] text-sage',
        )}
      >
        <Check className="size-3" />
        <span>{formatRelativeSaveTime(lastSavedAt, now)}</span>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @floraclin/web test save-status-indicator`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

### Task B2: `formatRelativeSaveTime` helper + tests

**Files:**
- Create: `web/src/lib/relative-time.ts`
- Create: `web/src/lib/__tests__/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/relative-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeSaveTime } from '../relative-time'

describe('formatRelativeSaveTime', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('returns "Salvo agora" when saved < 1 minute ago', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:40Z'), now)).toBe('Salvo agora')
  })

  it('returns "Salvo agora" for saves up to 59 seconds ago', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:01Z'), now)).toBe('Salvo agora')
  })

  it('returns "Salvo há 1min" at exactly 1 minute', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:00Z'), now)).toBe('Salvo há 1min')
  })

  it('returns "Salvo há 59min" at 59 minutes', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:01:00Z'), now)).toBe('Salvo há 59min')
  })

  it('returns "Salvo há 1h" at 60 minutes', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:00:00Z'), now)).toBe('Salvo há 1h')
  })

  it('returns "Salvo há 23h" at 23 hours', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-13T13:00:00Z'), now)).toBe('Salvo há 23h')
  })

  it('returns "Salvo há 1d" at 24 hours', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-13T12:00:00Z'), now)).toBe('Salvo há 1d')
  })

  it('returns "Salvo há 7d" at 7 days', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-07T12:00:00Z'), now)).toBe('Salvo há 7d')
  })

  it('clamps negative differences to "Salvo agora" (clock skew tolerance)', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T12:00:10Z'), now)).toBe('Salvo agora')
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @floraclin/web test relative-time`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement helper**

Create `web/src/lib/relative-time.ts`:

```ts
/**
 * Formats a "Salvo há ..." label for the wizard save indicator.
 * Pure function — parent re-renders on interval to keep the label fresh.
 *
 * < 1 min  → "Salvo agora"
 * 1-59 min → "Salvo há Xmin"
 * 1-23 h   → "Salvo há Xh"
 * >= 1 d   → "Salvo há Xd"
 */
export function formatRelativeSaveTime(savedAt: Date, now: Date): string {
  const diffMs = now.getTime() - savedAt.getTime()
  if (diffMs < 60_000) return 'Salvo agora'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `Salvo há ${minutes}min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Salvo há ${hours}h`

  const days = Math.floor(hours / 24)
  return `Salvo há ${days}d`
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @floraclin/web test relative-time`
Expected: PASS (9 tests).

---

### Task B3: AnamnesisForm dirty tracking + auto-saved propagation

**Files:**
- Modify: `web/src/components/anamnesis/anamnesis-form.tsx`

AnamnesisForm already uses RHF with a `watch()` callback that auto-saves on every change (debounced 1s). It does NOT call `form.reset()` after save, so RHF's `formState.isDirty` is permanently true after first edit — we need a separate boolean.

The form also has its own background save path (outside `triggerSave`). We propagate that to the wizard via `onAutoSaved` so the status indicator shows "Salvo há…" based on the most recent auto-save, not only Próximo-driven saves.

- [ ] **Step 1: Add `hasUnsavedChanges` state**

Inside `AnamnesisForm` component (around the existing `lastSaved` state, near line 226):

```tsx
  const [lastSaved, setLastSaved] = useState<Date | null>(
    initialData?.updatedAt ? new Date(initialData.updatedAt) : null
  )
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(updatedByName ?? null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
```

- [ ] **Step 2: Update `saveForm` to clear dirty + notify wizard on success**

Replace the existing `saveForm` (currently around lines 291-307):

```tsx
  const saveForm = useCallback(async () => {
    const data = getValues()
    try {
      const result = await upsertAnamnesis.mutateAsync({
        patientId,
        formData: data as Record<string, unknown>,
        expectedUpdatedAt: expectedUpdatedAtRef.current,
      })
      if (result?.updatedAt) {
        const savedAt = new Date(result.updatedAt)
        expectedUpdatedAtRef.current = savedAt.toISOString()
        setLastSaved(savedAt)
        setLastSavedBy(null)
        setHasUnsavedChanges(false)
        wizardOverrides?.onAutoSaved?.(savedAt)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar anamnese')
    }
  }, [patientId, getValues, upsertAnamnesis, wizardOverrides])
```

- [ ] **Step 3: Mark dirty on every change**

Update the `watch()` effect (currently around lines 319-330):

```tsx
  // Watch all form fields and auto-save on change (disabled in public mode)
  useEffect(() => {
    if (publicMode) return
    const subscription = watch(() => {
      setHasUnsavedChanges(true)
      debouncedSave()
    })
    return () => {
      subscription.unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [watch, debouncedSave, publicMode])
```

- [ ] **Step 4: Propagate `hasUnsavedChanges` to wizard**

Add a new effect immediately after the watch effect:

```tsx
  // Propagate dirty state to wizard for the save indicator
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])
```

The exhaustive-deps lint is suppressed intentionally: the wizard passes a stable callback (via `useMemo`), and we don't want `wizardOverrides` identity changes to re-fire this.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

### Task B4: ProcedureForm dirty tracking (with face diagram coverage)

**Files:**
- Modify: `web/src/components/procedures/procedure-form.tsx`

This form uses plain `useState` for ~30 fields. Dirty tracking uses a container `input`/`change` event listener for standard DOM inputs, plus explicit `markDirty()` calls wrapping the face-diagram `onChange` callbacks (SVG clicks don't emit DOM change events).

- [ ] **Step 1: Add state + ref + markDirty**

Inside `ProcedureForm` component, near the other `useState` declarations (around line 432 where `isSubmitting` lives):

```tsx
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const formContainerRef = useRef<HTMLDivElement>(null)

  const markDirty = useCallback(() => {
    setHasUnsavedChanges(true)
  }, [])
```

- [ ] **Step 2: Attach container event listener**

Add a new effect near the other wizard-override effects (before the `prevTriggerSaveRef` at ~line 888):

```tsx
  // Dirty tracking — container-level listener catches standard DOM inputs.
  // Non-DOM interactions (face diagram) call markDirty() explicitly.
  useEffect(() => {
    const el = formContainerRef.current
    if (!el) return
    const handler = () => setHasUnsavedChanges(true)
    el.addEventListener('input', handler, true)
    el.addEventListener('change', handler, true)
    return () => {
      el.removeEventListener('input', handler, true)
      el.removeEventListener('change', handler, true)
    }
  }, [])

  // Propagate dirty state to wizard
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])
```

- [ ] **Step 3: Clear dirty inside triggerSave effect on success**

Inside the existing `useEffect` that handles `wizardOverrides?.triggerSave` (ends around line 1053), every call to `wizardOverrides?.onSaveComplete({ success: true, ... })` must be preceded by `setHasUnsavedChanges(false)`.

Search for all `onSaveComplete?.({ success: true` in that block (multiple sites — around lines 1017, 1027, and any similar). Before each, insert:

```tsx
        setHasUnsavedChanges(false)
```

Example (the existing success branch around line 1017):

```tsx
                setHasUnsavedChanges(false)
                wizardOverrides?.onSaveComplete?.({
                  success: true,
                  procedureId: created.id,
                })
```

Apply the same `setHasUnsavedChanges(false)` line immediately before every `onSaveComplete?.({ success: true ... })` in that block. Do NOT add it before failure branches.

- [ ] **Step 4: Wrap face-diagram onChange callbacks with markDirty**

At line 1371 (`onDiagramChange={setDiagramPoints}`), replace with:

```tsx
                      onDiagramChange={(next) => {
                        setDiagramPoints(next)
                        markDirty()
                      }}
```

At line 1403 (`onChange={setDiagramPoints}` inside `<FaceDiagramEditor>`), replace with:

```tsx
                  onChange={(next) => {
                    setDiagramPoints(next)
                    markDirty()
                  }}
```

- [ ] **Step 5: Attach the ref to the top-level container**

The form returns `<div className="mx-auto max-w-4xl space-y-5 pb-24">` at line 1058. Change to:

```tsx
    <div ref={formContainerRef} className="mx-auto max-w-4xl space-y-5 pb-24">
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

### Task B5: ProcedureApproval dirty tracking

**Files:**
- Modify: `web/src/components/procedures/procedure-approval.tsx`

Approval has signature pad + consent checkbox + notes inputs. Standard inputs bubble `input`/`change` events. Signature pad is a custom canvas — it does NOT bubble DOM change events, so signature capture needs explicit `markDirty()`.

- [ ] **Step 1: Add state + ref + markDirty**

Inside the `ProcedureApproval` component, near the top of its state declarations (after `wizardOverrides` is destructured, around line 162):

```tsx
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const formContainerRef = useRef<HTMLDivElement>(null)

  const markDirty = useCallback(() => {
    setHasUnsavedChanges(true)
  }, [])
```

If `useRef` / `useState` / `useCallback` are not already imported at top of file, add them to the existing `react` import.

- [ ] **Step 2: Attach container listener + propagate**

Add these effects near the other wizard-override effects (before the `prevTriggerSaveRef` around line 396):

```tsx
  useEffect(() => {
    const el = formContainerRef.current
    if (!el) return
    const handler = () => setHasUnsavedChanges(true)
    el.addEventListener('input', handler, true)
    el.addEventListener('change', handler, true)
    return () => {
      el.removeEventListener('input', handler, true)
      el.removeEventListener('change', handler, true)
    }
  }, [])

  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])
```

- [ ] **Step 3: Clear dirty on save success**

In the `triggerSave` effect (ends around line 437), before every `onSaveComplete?.({ success: true... })` site (around line 404), insert:

```tsx
        setHasUnsavedChanges(false)
```

- [ ] **Step 4: Mark dirty when signature is captured**

Find the signature pad usage (search file for `SignaturePad` or `onSignature` or `signature`). If the signature captures via a callback like `onChange={setSignature}` or `onSignatureChange={...}`, wrap it to also call `markDirty()`:

```tsx
        onChange={(data) => {
          setSignature(data)
          markDirty()
        }}
```

If the signature uses an uncontrolled `<canvas>` with no callback, attach an `onPointerDown` on the canvas wrapper that calls `markDirty()` once.

- [ ] **Step 5: Attach ref to container**

At line 462, replace `<div className="mx-auto max-w-3xl space-y-6">` with:

```tsx
    <div ref={formContainerRef} className="mx-auto max-w-3xl space-y-6">
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

### Task B6: ProcedureExecution dirty tracking

**Files:**
- Modify: `web/src/components/procedures/procedure-execution.tsx`

- [ ] **Step 1: Add state + ref + markDirty**

Near the top of `ProcedureExecution` component state, after `wizardOverrides` destructure (around line 242):

```tsx
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const formContainerRef = useRef<HTMLDivElement>(null)

  const markDirty = useCallback(() => {
    setHasUnsavedChanges(true)
  }, [])
```

Ensure `useRef`, `useState`, `useCallback` are imported from `react`.

- [ ] **Step 2: Attach container listener + propagate**

Add these effects before the `prevTriggerSaveRef` (around line 538):

```tsx
  useEffect(() => {
    const el = formContainerRef.current
    if (!el) return
    const handler = () => setHasUnsavedChanges(true)
    el.addEventListener('input', handler, true)
    el.addEventListener('change', handler, true)
    return () => {
      el.removeEventListener('input', handler, true)
      el.removeEventListener('change', handler, true)
    }
  }, [])

  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges])
```

- [ ] **Step 3: Clear dirty on save success**

In the `triggerSave` effect (ends around line 616), before every `onSaveComplete?.({ success: true... })` site, insert:

```tsx
        setHasUnsavedChanges(false)
```

- [ ] **Step 4: Mark dirty on photo interactions (if applicable)**

If the execution form has photo uploads managed via a callback (e.g. `onPhotoUpload`, `photoRefreshKey` increments as a result of user action), call `markDirty()` there. Photo uploads trigger DOM file input `change` events via the hidden `<input type="file">`, so the container listener should already catch them — verify during manual test.

- [ ] **Step 5: Attach ref to container**

At line 619, replace `<div className="mx-auto max-w-4xl space-y-6">` with:

```tsx
    <div ref={formContainerRef} className="mx-auto max-w-4xl space-y-6">
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

### Task B7: Atendimento loading skeleton — add middle slot

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/atendimento/loading.tsx`

The skeleton currently has an empty middle slot. To match the new layout, add a placeholder pill between the Voltar skeleton and the right-side button skeletons. Also add a skeleton for the new "Salvar e sair" button.

- [ ] **Step 1: Update the nav skeleton**

Replace the existing `<nav>` block (currently around lines 81-89) with:

```tsx
      {/* Navigation bar skeleton */}
      <nav className="fixed bottom-0 left-0 right-0 md:left-[200px] z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex items-center justify-between px-6 py-3">
          <Skeleton className="h-[48px] w-24 rounded-[3px]" />
          <Skeleton className="hidden md:block h-4 w-32 rounded-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-[48px] w-32 rounded-[3px]" />
            <Skeleton className="h-[48px] w-32 rounded-[3px]" />
          </div>
        </div>
      </nav>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

---

## Group C: Wire everything in service-wizard.tsx

### Task C1: Integrate dirty state, indicator, and "Salvar e sair" button

**Files:**
- Modify: `web/src/components/service-wizard/service-wizard.tsx`

This task assembles everything from Group B into the wizard. Do it only after all B tasks are complete and their code is in place.

- [ ] **Step 1: Add imports**

At the top of the file, add:

```tsx
import { useMemo } from 'react'
import { SaveStatusIndicator } from './save-status-indicator'
```

Also ensure `useRef` is already imported (it is — used by `isExitingRef`).

- [ ] **Step 2: Add per-step dirty state and stable handlers**

Inside the `ServiceWizard` component, near the other state declarations (after `const [localApplications, setLocalApplications] = ...` around line 144):

```tsx
  // ─── Per-step dirty tracking + stable handlers ────────────────
  const [stepDirty, setStepDirty] = useState<Record<number, boolean>>({})

  const dirtyHandlers = useMemo(
    () => ({
      1: (d: boolean) => setStepDirty((p) => (p[1] === d ? p : { ...p, 1: d })),
      2: (d: boolean) => setStepDirty((p) => (p[2] === d ? p : { ...p, 2: d })),
      3: (d: boolean) => setStepDirty((p) => (p[3] === d ? p : { ...p, 3: d })),
      4: (d: boolean) => setStepDirty((p) => (p[4] === d ? p : { ...p, 4: d })),
      5: (d: boolean) => setStepDirty((p) => (p[5] === d ? p : { ...p, 5: d })),
    }),
    [],
  )
```

- [ ] **Step 3: Add pendingActionRef**

Near the `isExitingRef` (around line 263):

```tsx
  const isExitingRef = useRef(false)
  const pendingActionRef = useRef<'advance' | 'exit'>('advance')
```

- [ ] **Step 4: Add `now` state that ticks every 30s**

Right after `dirtyHandlers`:

```tsx
  // Tick every 30s so "Salvo há Xmin" stays fresh without form interaction
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
```

- [ ] **Step 5: Update `getOverridesForStep` to pass `onDirtyChange` and `onAutoSaved`**

Replace the existing `getOverridesForStep` (around lines 375-388):

```tsx
  const anamnesisOnAutoSaved = useCallback(
    (timestamp: Date) => {
      updateStepTimestamp('anamnesis', timestamp)
    },
    [updateStepTimestamp],
  )

  function getOverridesForStep(step: 1 | 2 | 3 | 4 | 5): WizardOverrides {
    return {
      ...baseOverridesBase,
      triggerSave: state.currentStep === step ? state.triggerSave : 0,
      onDirtyChange: dirtyHandlers[step],
      // Only step 1 (anamnesis) has background auto-save worth propagating
      onAutoSaved: step === 1 ? anamnesisOnAutoSaved : undefined,
    }
  }
```

Add the `WizardOverrides` type import at top of file if not already present:

```tsx
import type { StepResult, WizardOverrides } from './types'
```

- [ ] **Step 6: Update `handleStepComplete` to respect `pendingActionRef`**

Replace the existing `handleStepComplete` (around lines 301-349). The key change: capture `pendingActionRef.current` into a local, reset the ref, and on `result.success === true && pending === 'exit'` route out instead of calling `nextStep()`.

```tsx
  const handleStepComplete = useCallback(
    async (result: StepResult) => {
      const pending = pendingActionRef.current
      pendingActionRef.current = 'advance'
      onSaveComplete(result)

      if (result.success) {
        const stepTimestampMap: Record<number, 'anamnesis' | 'procedureTypes' | 'planning' | 'approval' | 'execution'> = {
          1: 'anamnesis',
          2: 'procedureTypes',
          3: 'planning',
          4: 'approval',
          5: 'execution',
        }
        const timestampKey = stepTimestampMap[state.currentStep]
        if (timestampKey) {
          updateStepTimestamp(timestampKey, new Date())
        }

        // After step 3 creates/updates a procedure, fetch fresh data client-side
        if (state.currentStep === 3 && result.procedureId) {
          try {
            const fetchRes = await fetch(`/api/procedures/${result.procedureId}`)
            if (fetchRes.ok) {
              const procData = await fetchRes.json()
              setLocalProcedure(procData as ProcedureWithDetails)
              setLocalDiagrams((procData as { diagrams?: DiagramWithPoints[] }).diagrams ?? null)
              setLocalApplications((procData as { productApplications?: ProductApplicationRecord[] }).productApplications ?? null)
            }
          } catch {
            // Non-blocking
          }
        }

        if (state.currentStep === 4) {
          updateProcedureStatus('approved')
        }
        if (state.currentStep === 5) {
          toast.success('Atendimento finalizado com sucesso')
          router.push(`/pacientes/${patient.id}`)
          return
        }

        // Save-and-exit path
        if (pending === 'exit') {
          isExitingRef.current = true
          toast.success('Atendimento salvo. Retome quando quiser.')
          router.push(`/pacientes/${patient.id}`)
          return
        }

        // Default: auto-advance to next step
        nextStep()
      }
    },
    [onSaveComplete, state.currentStep, nextStep, updateProcedureStatus, updateStepTimestamp, router, patient.id]
  )
```

- [ ] **Step 7: Add `handleSaveAndExit`**

Right after `handleNext` (around line 368):

```tsx
  const handleSaveAndExit = useCallback(() => {
    pendingActionRef.current = 'exit'
    triggerSave()
  }, [triggerSave])
```

- [ ] **Step 8: Add `showSaveAndExit` derived value**

In the "Derived state" section (around line 400):

```tsx
  // "Salvar e sair" only on steps where a dedicated save button adds value:
  //   - Step 2 has no server save (type-selection only, persisted on step 3)
  //   - Step 4 already has "Adiar Aprovação" (literal save-and-exit)
  //   - Step 5 is terminal (Finalizar)
  const showSaveAndExit = state.currentStep === 1 || state.currentStep === 3
```

- [ ] **Step 9: Render the indicator in the nav bar middle slot**

Find the nav bar `<div className="mx-auto flex flex-col gap-2 px-6 py-3 md:flex-row md:items-center md:justify-between">` (around line 624).

The desktop layout needs three slots (left / middle / right). Currently it has left and right only. Replace the nav's children structure — the Voltar div stays, add the indicator div between Voltar and the action group:

After the Voltar `<div className="hidden md:block md:min-w-[100px]">...</div>` block (ends around line 641), insert the indicator slot:

```tsx
          {/* Middle: save status indicator (desktop only) */}
          <SaveStatusIndicator
            isSaving={state.isSaving}
            isDirty={!!stepDirty[state.currentStep]}
            lastSavedAt={
              state.currentStep === 1
                ? (state.stepTimestamps.anamnesis ?? null)
                : state.currentStep === 2
                  ? (state.stepTimestamps.procedureTypes ?? null)
                  : state.currentStep === 3
                    ? (state.stepTimestamps.planning ?? null)
                    : state.currentStep === 4
                      ? (state.stepTimestamps.approval ?? null)
                      : (state.stepTimestamps.execution ?? null)
            }
            errorType={state.errorType}
            now={now}
          />
```

- [ ] **Step 10: Render the "Salvar e sair" button next to "Próximo"**

In the action group `<div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center md:gap-3">` (around line 644), add the new button. Place it between the Próximo button and the Pular button so the desktop visual order (using the existing `md:order-*` classes) becomes:

`Pular (order-1) · Salvar e sair (order-2) · Próximo (order-3)`

Update the existing Próximo button to use `md:order-3` (was `md:order-2`):

```tsx
            <button
              type="button"
              onClick={handleNext}
              disabled={state.isSaving}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-[3px] px-6 py-2.5 text-sm font-medium transition-colors min-h-[48px] md:w-auto md:order-3',
                'bg-forest text-cream hover:bg-sage',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {state.isSaving ? 'Salvando...' : nextLabel}
              {state.currentStep < 5 && !state.isSaving && <ChevronRight className="h-4 w-4" />}
            </button>
```

Insert the new "Salvar e sair" button immediately after it (DOM order after Próximo, but `md:order-2` places it visually between Pular and Próximo):

```tsx
            {showSaveAndExit && (
              <button
                type="button"
                onClick={handleSaveAndExit}
                disabled={state.isSaving}
                className={cn(
                  'w-full rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:w-auto md:order-2',
                  state.isSaving && 'opacity-50 cursor-not-allowed',
                )}
              >
                Salvar e sair
              </button>
            )}
```

The existing Pular button already has `md:order-1`, so the desktop order becomes 1 (Pular) · 2 (Salvar e sair) · 3 (Próximo). On mobile, all three stack vertically in DOM order: Próximo, Salvar e sair, Pular, Voltar.

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 12: Lint**

Run: `pnpm --filter @floraclin/web lint`
Expected: PASS (no new warnings).

- [ ] **Step 13: Run unit tests**

Run: `pnpm --filter @floraclin/web test`
Expected: PASS — all existing tests + new SaveStatusIndicator / relative-time tests pass.

- [ ] **Step 14: Manual verification in dev server**

The dev server is already running at http://localhost:3000.

Smoke test checklist:
1. Navigate to a patient → Atendimento. Indicator should be empty initially.
2. Type into an anamnesis field → indicator flips to "Alterações não salvas" (amber dot).
3. Wait 1s for auto-save → indicator transitions "Salvando..." → "Salvo agora".
4. Wait ~1 minute without touching anything → indicator shows "Salvo há 1min".
5. Click "Salvar e sair" on step 1 → save fires, route returns to patient detail, toast "Atendimento salvo. Retome quando quiser."
6. Re-enter atendimento, advance to step 3 (Planejamento), confirm "Salvar e sair" appears.
7. Edit a field in step 3 → indicator shows "Alterações não salvas".
8. Click a face diagram point (on step 3) → indicator flips to "Alterações não salvas" — **critical: face diagram coverage**.
9. Click "Próximo" on step 3 → saves, advances to step 4.
10. Step 4 (Aprovação) → "Salvar e sair" should NOT appear (Adiar Aprovação covers it).
11. Step 5 (Execução) → "Salvar e sair" should NOT appear.
12. Simulate save error (e.g. go offline + Próximo) → indicator shows "Erro ao salvar" (red).
13. Mobile breakpoint (< md): indicator is hidden, buttons stack vertically, layout doesn't break.

---

## Pre-merge checks

- [ ] Typecheck: `pnpm --filter @floraclin/web typecheck`
- [ ] Lint: `pnpm --filter @floraclin/web lint`
- [ ] Unit tests: `pnpm --filter @floraclin/web test`
- [ ] Manual smoke test (checklist above)
- [ ] Await user approval before committing (per user preference)
