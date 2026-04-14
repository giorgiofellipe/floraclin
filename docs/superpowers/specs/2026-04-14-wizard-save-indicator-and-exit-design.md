# Service Wizard — Save Status Indicator + "Salvar e sair"

## Goal

Reassure users that their work in the service wizard (`/pacientes/[id]/atendimento`) is persisted, and give them a way to leave mid-flow without losing data.

Two linked additions to the fixed bottom navigation bar in `web/src/components/service-wizard/service-wizard.tsx`:

1. **Status indicator** in the previously-empty middle slot, showing the current step's save state.
2. **"Salvar e sair" button** next to "Próximo" that saves the current step and exits the wizard instead of advancing.

## Background

The wizard is a 5-step flow: Anamnese → Procedimentos → Planejamento → Aprovação → Execução. Today:

- Save happens only when the user clicks **Próximo** — there is no auto-save. The form is triggered via `wizard.triggerSave()` which bumps a counter each step form observes.
- On successful save, `handleStepComplete` updates `state.stepTimestamps[currentStep]` and auto-advances via `nextStep()`.
- The bottom nav has `Voltar` on the left and `Pular`/`Próximo` on the right — the middle is empty (desktop).
- Step 4 already has **Adiar Aprovação** (save and exit for approval-deferral). Step 5 is terminal.
- The exit-confirmation dialog warns users if they try to close the wizard on steps ≥ 2.

Users currently have no persistent signal that their data is saved, and if they want to step away mid-step there's no explicit "save and leave" affordance — they either click Próximo (which advances them past where they wanted to stop) or close and hope nothing was lost.

## Scope

**In scope**
- Bottom bar middle slot status indicator (desktop only).
- "Salvar e sair" button on steps 1 and 3 only.
- Dirty-state plumbing from `AnamnesisForm` and `ProcedureForm` up to the wizard.

**Out of scope**
- Auto-save (remains manual, triggered by Próximo / Salvar e sair).
- Mobile layout changes beyond keeping the indicator hidden.
- Step 2, 4, 5 getting the new button (see rationale below).

## Design

### New bottom bar layout (desktop, `md+`)

```
┌────────────┬──────────────────┬─────────────────────────────────┐
│ Voltar     │  ● Salvo há 2min │  [Salvar e sair]  [Próximo →]  │
└────────────┴──────────────────┴─────────────────────────────────┘
  left slot    middle — status     right — actions
```

Mobile (`< md`) keeps the existing vertical-stacked button layout. The status indicator is hidden on mobile. The "Salvar e sair" button is shown on mobile as a full-width tertiary button stacked with the others.

### Status indicator — five states

Driven by `state.isSaving`, `state.stepTimestamps[currentStep]`, `state.error` / `state.errorType`, and the new per-step dirty tracking.

| State | Condition | Visual |
|---|---|---|
| Empty | No timestamp for this step AND not dirty | *(nothing rendered)* |
| Dirty | `stepDirty[currentStep] === true` (regardless of whether it was previously saved) | amber dot · "Alterações não salvas" |
| Saving | `state.isSaving === true` | spinner · "Salvando..." |
| Saved | Has `stepTimestamps[currentStep]`, not dirty, not saving | sage check · "Salvo há Xmin" |
| Error | `state.error && state.errorType === 'server'` | red ✗ · "Erro ao salvar" |

**State priority** when multiple apply (highest wins): Saving > Error > Dirty > Saved > Empty.

**Relative-time format** ("Salvo há…"):
- `< 1 min` → "Salvo agora"
- `1–59 min` → "Salvo há Xmin"
- `1–23 h` → "Salvo há Xh"
- `≥ 1 d` → "Salvo há Xd"

Indicator re-computes its label on a 30-second interval so "há agora" advances to "há 1min" without user action. Interval cleared when unmounted.

### "Salvar e sair" button

- **Appears on steps 1 and 3 only.**
  - Step 2 (`ProcedureTypeStep`) is local-only selection; the server save happens on step 3. Button would be a no-op or misleading.
  - Step 4 already has **Adiar Aprovação**, which is literally save-and-exit.
  - Step 5 is terminal — finalization, not deferral.
- **Always enabled** (no dirty-state gating) when visible. If the user clicks it on a clean form, we still fire the save; the form's save handler is idempotent and will no-op or write unchanged fields, then exit.
- **Label:** "Salvar e sair"
- **Style:** secondary (outline) button — less prominent than the primary "Próximo".
- **Position:** to the left of "Próximo", to the right of "Pular" (when present).
- **Behavior on click:**
  1. Set `pendingActionRef.current = 'exit'`
  2. Call `triggerSave()` (same path as Próximo)
  3. On successful save (`handleStepComplete` with `result.success === true`), route to `/pacientes/{patientId}` instead of calling `nextStep()`. Show a toast: "Atendimento salvo. Retome quando quiser."
  4. On save failure, stay on current step. The error flows into `state.error` and the middle indicator shows the error state. Reset `pendingActionRef` to 'advance'.
- **Exit semantics:** same as `confirmExit` — set `isExitingRef.current = true` before `router.push` so the beforeunload/popstate guards don't interfere. Do NOT trigger the exit confirmation dialog (user has already chosen to exit deliberately).

### Dirty-state plumbing

The wizard needs to know when each form has unsaved changes to drive the "Alterações não salvas" indicator state.

**Wizard side** (`service-wizard.tsx`):
```ts
const [stepDirty, setStepDirty] = useState<Record<number, boolean>>({})

// Stable per-step handlers — must live at top level of the component
// so they aren't recreated per render (form useEffect depends on identity).
const dirtyHandlers = useMemo(
  () => ({
    1: (d: boolean) => setStepDirty(p => (p[1] === d ? p : { ...p, 1: d })),
    2: (d: boolean) => setStepDirty(p => (p[2] === d ? p : { ...p, 2: d })),
    3: (d: boolean) => setStepDirty(p => (p[3] === d ? p : { ...p, 3: d })),
    4: (d: boolean) => setStepDirty(p => (p[4] === d ? p : { ...p, 4: d })),
    5: (d: boolean) => setStepDirty(p => (p[5] === d ? p : { ...p, 5: d })),
  }),
  []
)
```

Each step's overrides pull its stable handler:

```ts
function getOverridesForStep(step: 1 | 2 | 3 | 4 | 5) {
  return {
    ...baseOverridesBase,
    triggerSave: state.currentStep === step ? state.triggerSave : 0,
    onDirtyChange: dirtyHandlers[step],
  }
}
```

**Form side** — `AnamnesisForm` and `ProcedureForm`:

Each form already uses `react-hook-form`; they expose `formState.isDirty`. Add a new optional field to their `wizardOverrides` prop type:

```ts
interface WizardOverrides {
  // ...existing fields
  onDirtyChange?: (isDirty: boolean) => void
}
```

Inside the form component, after the existing wizard-override effects:

```ts
useEffect(() => {
  wizardOverrides?.onDirtyChange?.(formState.isDirty)
}, [formState.isDirty, wizardOverrides?.onDirtyChange])
```

After a successful save, the form calls `form.reset(values)` to reset the dirty flag — this is the standard react-hook-form pattern and it will propagate through the effect above. If a form doesn't already do this, add it in the save-success branch.

**Step 2 special case:** `ProcedureTypeStep` has no form, only selection state. It's not in the "dirty" tracking loop and never shows the dirty indicator. That's acceptable — step 2 commits to server only on step 3's save.

**Step 4/5 special case:** `ProcedureApproval` and `ProcedureExecution` do have forms, but since they don't get the new button and their existing flows are distinct (Adiar Aprovação / Finalizar), we still wire `onDirtyChange` for them so the middle indicator works consistently across all 5 steps.

### `pendingActionRef`

New ref in `service-wizard.tsx` alongside the existing `isExitingRef`:

```ts
const pendingActionRef = useRef<'advance' | 'exit'>('advance')
```

- Default is `'advance'` (matches current Próximo behavior — no regression).
- `handleSaveAndExit` sets it to `'exit'` then calls `triggerSave()`.
- `handleStepComplete` reads it at the top, captures it into a local, and resets to `'advance'`. If `result.success` and the local was `'exit'`, perform exit flow instead of `nextStep()`. If `result.success === false`, the ref is already reset, so a retry via Próximo behaves normally.

## Error handling

- **Save failure during "Salvar e sair":** user stays on the current step. `state.error` is set. The middle indicator flips to the Error state. The existing error banner above the bottom bar also shows the error message. The user can retry via either button.
- **Network interruption:** same as above. The Próximo button shows "Salvando…" while the request is in flight; both buttons become disabled (`state.isSaving === true`).
- **Dirty-state drift:** if a form fails to call `onDirtyChange` correctly (e.g., child component bug), the worst case is a wrong indicator label. No data loss. The "Próximo" save path is unchanged.

## Testing

- Unit: reducer / hook tests for `pendingActionRef` branch in `handleStepComplete` — verify that on `result.success && pending === 'exit'`, the wizard routes out instead of advancing, and that on failure, no routing happens.
- Component: render `ServiceWizard` with mocked forms; assert the five indicator states appear in the correct conditions; assert "Salvar e sair" appears only on steps 1 and 3.
- Manual: walk through all 5 steps on the running dev server. Verify indicator transitions: empty → typing (dirty) → Próximo (saving → saved). Verify Salvar e sair on steps 1 and 3 routes to `/pacientes/{id}`. Verify Adiar Aprovação on step 4 still works unchanged.

## Non-goals / explicit YAGNI

- No "you have unsaved changes" confirmation when clicking "Salvar e sair" — the button's literal purpose is to save, so prompting would be backwards.
- No auto-save-on-interval.
- No persisting the relative-time label across remounts (it's a purely presentational re-compute).
- No visual-language changes to the existing Voltar/Pular/Próximo buttons.
