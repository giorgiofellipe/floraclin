# Service Wizard Implementation Plan

> **v2 — updated from review feedback** (UX + Architecture reviews, 2026-03-27)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current separate procedure screens with a unified full-page wizard that guides the professional through the entire patient service — from anamnesis through execution — in focused, sequential steps.

**Architecture:** Wraps existing components (AnamnesisForm, ProcedureForm, ProcedureApproval, ProcedureExecution) inside a new wizard orchestrator. Each component gets a `WizardOverrides` prop that controls visibility of its own UI elements. The wizard controls save/advance via a callback + trigger signal pattern. All steps remain mounted (hidden with CSS `display: none`) to preserve component state.

**Tech Stack:** React (`useReducer`), `useServiceWizard` custom hook, URL search params for step tracking, existing Server Actions, existing components with `WizardOverrides` prop.

---

## Wizard Overview

**URL:** `/pacientes/[id]/atendimento?step=1`

**Trigger:** "Iniciar Atendimento" button on patient detail page.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  Sofia Almeida · 34 anos · (11) 98765-4321               │ compact patient bar
├──────────────────────────────────────────────────────────┤
│  ① Anamnese  ② Planejamento  ③ Aprovação  ④ Execução    │ stepper
├──────────────────────────────────────────────────────────┤
│                                                          │
│  All steps rendered, only active step visible             │
│  (others hidden with display: none)                      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Voltar]                         [Pular]    [Próximo]   │ sticky navigation bar
└──────────────────────────────────────────────────────────┘
```

**Smart context on open:**
- No procedure exists → starts at step 1
- Procedure `planned` → starts at step 3, steps 1-2 show completed
- Procedure `approved` → starts at step 4, steps 1-3 show completed
- Professional can navigate back to any completed step (READ-ONLY after approval — steps 1-2 show plan summary, not editable forms, to avoid desyncing the approved snapshot and financial entry)
- If multiple non-executed procedures exist for this patient → show a selection dialog: "Continuar atendimento anterior?" with procedure details, or "Iniciar novo atendimento"

**Anamnesis debounce safety:**
- Step 1 "Próximo" must flush the debounce timer and await the save before advancing. If the auto-save is pending (user just typed), force an immediate save and wait for completion. This prevents the last edit from being dropped.

**Step completion persistence:**
- Add `wizard_progress` JSONB field to `procedure_records` to track which steps are completed: `{ anamnesis: true, planning: true, approval: false, execution: false }`
- Timestamps are derived from: anamnesis.updatedAt, procedure.updatedAt, procedure.approvedAt, procedure.performedAt
- This allows the wizard to resume at the correct step even if the professional closes the browser

**URL-based step tracking:**
- Current step is stored in the URL search param: `?step=2`
- Wizard reads initial step from the URL on mount (with validation — do not allow step 4 if procedure is not approved)
- Navigation updates the URL via `router.replace` (no history push, avoids back-button chaos)
- Survives browser refresh — the server component reads `?step` and passes it as `initialStep`

**Stepper shows per step:**
- Number + name
- Status: completed (sage checkmark, clickable), current (forest underline/highlight), unavailable (visually dimmed + `cursor-not-allowed`)
- Unavailable steps: tooltip on hover explaining why (e.g., "Complete o planejamento para acessar a aprovação")
- "Última atualização: dd/mm/yyyy às HH:mm" below completed steps
- Responsive: horizontal on desktop, vertical sidebar on tablet portrait (< 768px)

---

## Steps

### Step 1 — Anamnese
- Embeds existing `AnamnesisForm`
- Shows "Última atualização" timestamp at top
- Auto-saves on blur/change (existing behavior)
- "Próximo" just advances — data already saved via auto-save
- Sections start collapsed even for new patients. Each section shows completion indicator (e.g., "0/3 campos preenchidos")
- If filled: collapsed with green checks
- "Pular" shown if anamnesis is already filled (auto-saved anyway)

### Step 2 — Planejamento
- Procedure type checkboxes (multi-select)
- Face diagram editor (freeform points, products from catalog)
- Financial plan card (collapsible, labeled "Orçamento"): total amount (auto-summed), installments, payment method, notes, installment breakdown preview
- "Próximo" creates/updates procedure as `planned` with `financialPlan` JSONB
- This step creates the procedure record that carries through the wizard
- **No "Pular" — this step is required** (creates the procedure)
- Auto-save diagram points to localStorage as user places them. Restore on re-entry if procedure is still `planned` with no diagram saved server-side

### Step 3 — Aprovação
- Read-only plan summary (procedures, diagram totals, financial terms)
- Consent signing checklist (interactive — user clicks "Assinar" for each consent, draws signature for contract)
- Service contract with interpolated text + signature
- "Próximo" calls `approveProcedureAction` — creates financial entry, snapshots plan
- "Próximo" disabled (with message) until `canApprove` is true (all consents signed + contract signed)
- **"Adiar Aprovação" instead of "Pular"** — patient wants to think. Exits wizard with message: "Atendimento salvo como planejado. Retorne para aprovar quando o paciente estiver pronto." Redirects to patient detail

### Step 4 — Execução
- Update diagram quantities, add/remove points
- Batch/lot numbers per product
- Clinical notes (technique, response, adverse effects)
- Pre/post photos
- "Finalizar Atendimento" calls `executeProcedureAction`
- Only accessible if procedure is `approved`
- If not approved: step is dimmed in stepper with tooltip "Aprove o procedimento para acessar a execução"
- **No "Pular" — this is the final step**

---

## Communication Pattern: Callback Props + Trigger Signal

Instead of `useImperativeHandle`, the wizard communicates with step components via callback props and a trigger signal:

```typescript
interface WizardStepProps {
  onSaveComplete: (result: StepResult) => void
  triggerSave: number // incrementing counter that triggers save when changed
}
```

Each step watches `triggerSave` via `useEffect`. When it changes, the step runs its own save logic and calls `onSaveComplete` with the result. This keeps save logic co-located with the form state that knows whether it is valid and dirty.

```typescript
// Inside a step component:
useEffect(() => {
  if (triggerSave === 0) return // initial render, no save
  async function doSave() {
    // existing save logic, using the component's own form state
    const result = await saveAction(formData)
    onSaveComplete({
      success: result.success,
      procedureId: result.data?.id,
      error: result.error,
      errorType: result.fieldErrors ? 'validation' : 'server',
    })
  }
  doSave()
}, [triggerSave])
```

---

## WizardOverrides Interface

Replace the single `wizardMode: boolean` with a structured overrides interface:

```typescript
interface WizardOverrides {
  hideSaveButton: boolean
  hideNavigation: boolean
  hideTitle: boolean
  onSaveComplete?: (result: StepResult) => void
  triggerSave?: number
}
```

Each component receives `wizardOverrides?: WizardOverrides`. When present:
- `hideSaveButton`: hides the component's own submit/save button
- `hideNavigation`: hides back/cancel buttons, suppresses `router.push` on success
- `hideTitle`: hides the component's own page title/header
- `onSaveComplete` + `triggerSave`: wizard-controlled save via trigger signal pattern

---

## Error Handling

```typescript
interface StepResult {
  success: boolean
  procedureId?: string
  error?: string
  errorType?: 'validation' | 'precondition' | 'server'
}
```

The wizard shows errors inline below the navigation bar with appropriate messaging per error type:
- **Validation errors** (`errorType: 'validation'`): show inline on current step, do not advance. Message: "Corrija os campos destacados antes de continuar."
- **Precondition errors** (`errorType: 'precondition'`): show message explaining what needs to happen first. E.g., "Termos pendentes de assinatura" — highlight the consent checklist within the current step.
- **Server errors** (`errorType: 'server'`): show error message with retry option. Message: "Erro ao salvar. Tente novamente."

---

## State

```typescript
interface WizardState {
  currentStep: 1 | 2 | 3 | 4
  procedureId: string | null
  procedureStatus: ProcedureStatus | null
  stepTimestamps: {
    anamnesis: Date | null
    planning: Date | null
    approval: Date | null
    execution: Date | null
  }
}
```

**useServiceWizard hook:**

```typescript
function useServiceWizard(patientId: string, initialProcedure?: Procedure) {
  // manages currentStep, procedureId, procedureStatus, stepTimestamps
  // handles navigation logic, step availability
  // returns: state, goToStep, nextStep, prevStep, triggerSave, canSkip
}
```

Encapsulates all state machine logic: step transitions, availability rules, save orchestration, URL sync. The component becomes a thin rendering layer.

**Flow:**
1. Page loads → fetch patient, anamnesis, latest non-executed procedure
2. Read `?step` from URL, validate against procedure status, set initial step
3. Pre-fill state from existing data
4. Step 1 → anamnesis auto-saved, advance
5. Step 2 → create/update procedure with financial plan → store `procedureId`
6. Step 3 → `approveProcedureAction` → status `approved`
7. Step 4 → `executeProcedureAction` → status `executed` → redirect to patient detail

**Staleness refresh:** When entering steps 3 or 4, re-fetch the procedure to get latest status (catches changes from another tab or session).

---

## Dependency Graph

```
Task 1: Wizard shell + useServiceWizard hook
  ↓
Tasks 2, 3 IN PARALLEL:
  Task 2: Add WizardOverrides to existing components
  Task 3: Ensure ProcedureForm includes financial fields in wizard mode (merged step)
  ↓
Task 4: Wire all 4 steps + stepper + navigation
  ↓
Task 5: Entry point + tablet responsive + polish
```

Since step 3 (financial) is now merged into step 2 (planning), Task 3 is simpler — just ensure the ProcedureForm includes the financial card at the bottom when `wizardOverrides` is present.

---

## Task 1: Wizard Shell + useServiceWizard Hook

**Files:**
- Create: `src/app/(platform)/pacientes/[id]/atendimento/page.tsx`
- Create: `src/components/service-wizard/service-wizard.tsx`
- Create: `src/components/service-wizard/use-service-wizard.ts`
- Create: `src/components/service-wizard/wizard-stepper.tsx`

**What to build:**

### Page (`atendimento/page.tsx`)
Server component that:
- Loads patient data (`getPatient`)
- Loads anamnesis data (`getAnamnesis`) with timestamp
- Loads latest non-executed procedure for this patient (query `procedure_records` WHERE `patient_id` AND `status IN ('planned', 'approved')` AND `deleted_at IS NULL`, order by `created_at DESC`, limit 1)
- If procedure exists, loads its diagrams, product applications
- Reads `?step` search param and passes as `initialStep` (with validation)
- Passes everything to `ServiceWizard`

### useServiceWizard (`use-service-wizard.ts`)
Custom hook that encapsulates all orchestration logic:
- Manages `WizardState` via `useReducer` with explicit actions: `GO_TO_STEP`, `SET_PROCEDURE_ID`, `STEP_SAVE_COMPLETE`, `STEP_SAVE_FAILED`
- Determines starting step from procedure status + URL `?step` param
- Handles step availability rules:
  - Step 1: always available
  - Step 2: always available
  - Step 3: requires `procedureId` + procedure status `planned`
  - Step 4: requires procedure status `approved`
- Manages `triggerSave` counter (increment to trigger save on active step)
- Handles `onSaveComplete` callback from steps
- Syncs current step to URL via `router.replace`
- Returns: `state`, `goToStep`, `nextStep`, `prevStep`, `triggerSave`, `canSkip`, `isSaving`, `error`

### ServiceWizard (`service-wizard.tsx`)
Client component — thin rendering layer:
- Full-page layout with compact patient bar, stepper, content area, sticky navigation bar
- Renders ALL step components simultaneously, hides inactive steps with `display: none`
- Uses `useServiceWizard` for all logic
- Passes `wizardOverrides` (including `triggerSave` + `onSaveComplete`) to each step component
- Handles "Voltar", "Pular"/"Adiar Aprovação", "Próximo" navigation via hook

### WizardStepper (`wizard-stepper.tsx`)
- Desktop (>= 768px): horizontal, 4 steps
- Tablet/mobile (< 768px): vertical sidebar
- Each step: number, label, status icon, timestamp
- Completed: sage checkmark, clickable
- Current: forest underline/highlight
- Unavailable: dimmed, `cursor-not-allowed`, tooltip on hover explaining why
- One-line subtitle under each step name (e.g., "Planejamento" / "Diagrama facial e orçamento")

### Patient compact bar
- Name, age (from birth_date), phone, CPF (masked)
- "Sair" button to exit wizard → confirms if unsaved changes
- No "Voltar" on step 1 — use only the "Sair" button

### Sticky navigation bar
- Pinned at bottom of viewport (sticky footer) — always visible, even with long scrolling content
- "Voltar" (hidden on step 1), conditional skip button, "Próximo" / "Finalizar Atendimento"
- `beforeunload` handler on steps 2-4 for tab close/refresh protection

Brand v2 colors: white cards, `#F4F6F8` background, `shadow-[0_1px_4px_rgba(0,0,0,0.06)]`, `rounded-[3px]`.

**Commit:** `feat: service wizard shell - page, stepper, useServiceWizard hook, navigation`

---

## Task 2: Add WizardOverrides to Existing Components

**Files:**
- Modify: `src/components/anamnesis/anamnesis-form.tsx`
- Modify: `src/components/procedures/procedure-form.tsx`
- Modify: `src/components/procedures/procedure-approval.tsx`
- Modify: `src/components/procedures/procedure-execution.tsx`

**What to change:**

Each component gets a `wizardOverrides?: WizardOverrides` prop. When present:
- `hideSaveButton`: hides the component's own submit/save button
- `hideNavigation`: hides back/cancel buttons, suppresses `router.push` on success
- `hideTitle`: hides the component's own page title/header
- `triggerSave` + `onSaveComplete`: watches `triggerSave` via `useEffect`, runs save logic, calls `onSaveComplete` with `StepResult`

**AnamnesisForm**: In wizard mode, hide any save button (it auto-saves). The wizard's "Próximo" just advances without triggering save (already saved via debounce). Start sections collapsed. Add per-section completion indicators.

**ProcedureForm**: In wizard mode, show planning fields (procedure types + face diagram) AND financial fields (as a collapsible "Orçamento" card at the bottom). Hide submit button. Watch `triggerSave` to save and call `onSaveComplete`. Suppress `router.push`.

**ProcedureApproval**: In wizard mode, hide the "Aprovar Procedimento" button at the bottom. Consent-signing flow remains fully interactive within the step (user clicks "Assinar" for each consent). Watch `triggerSave` — when triggered, call `approveProcedureAction` (not the consent flow). Expose `canApprove` state so the wizard can disable "Próximo" until ready. Suppress redirect.

**ProcedureExecution**: In wizard mode, hide "Salvar como Executado" and "Cancelar" buttons. Keep all section toggles and photo upload interactive. Watch `triggerSave` to execute and call `onSaveComplete`. Suppress redirect.

**Commit:** `feat: add WizardOverrides prop to anamnesis, procedure form, approval, and execution components`

---

## Task 3: Ensure ProcedureForm Includes Financial Fields in Wizard Mode

**Files:**
- Modify: `src/components/procedures/procedure-form.tsx`

**What to build:**

Since the financial plan step is now merged into the planning step, ensure `ProcedureForm` renders the financial fields when `wizardOverrides` is present:
- Total amount (currency masked, auto-summed from procedure types)
- Installment count (1-12 select)
- Payment method (select with labels)
- Notes (textarea)
- Installment preview showing per-installment amounts and dates

Render these inside a collapsible card labeled "Orçamento" at the bottom of the planning fields. The card should be expanded by default in wizard mode.

The `save` action (triggered by `triggerSave`) creates/updates the procedure with both planning data AND `financialPlan` JSONB in a single call to `createProcedureAction` or `updateProcedureAction`.

**Commit:** `feat: include financial plan fields in ProcedureForm wizard mode`

---

## Task 4: Wire All 4 Steps

**Files:**
- Modify: `src/components/service-wizard/service-wizard.tsx`

**What to build:**

Render all steps simultaneously, hide inactive with `display: none`:

```tsx
<div style={{ display: currentStep === 1 ? 'block' : 'none' }}>
  <AnamnesisForm patientId={patientId} wizardOverrides={anamnesisOverrides} />
</div>
<div style={{ display: currentStep === 2 ? 'block' : 'none' }}>
  <ProcedureForm patientId={patientId} wizardOverrides={planningOverrides} ... />
</div>
<div style={{ display: currentStep === 3 ? 'block' : 'none' }}>
  <ProcedureApproval procedureId={procedureId} wizardOverrides={approvalOverrides} ... />
</div>
<div style={{ display: currentStep === 4 ? 'block' : 'none' }}>
  <ProcedureExecution procedureId={procedureId} wizardOverrides={executionOverrides} ... />
</div>
```

**Navigation logic (via useServiceWizard):**
- "Próximo" on step 1: just advance (auto-saved)
- "Próximo" on step 2: increment `triggerSave` → step saves procedure + financial plan → `onSaveComplete` with `procedureId` → advance
- "Próximo" on step 3: increment `triggerSave` → step calls `approveProcedureAction` → `onSaveComplete` → advance
- "Finalizar" on step 4: increment `triggerSave` → step calls `executeProcedureAction` → `onSaveComplete` → redirect to patient detail

**"Pular" / skip rules:**
- Step 1 (Anamnese): show "Pular" if anamnesis is already filled
- Step 2 (Planejamento): NO "Pular" — required
- Step 3 (Aprovação): show "Adiar Aprovação" — exits wizard, redirects to patient detail
- Step 4 (Execução): NO "Pular" — final step

**Step availability:**
- Step 1: always available
- Step 2: always available
- Step 3: requires `procedureId` (created in step 2)
- Step 4: requires procedure status `approved`

Unavailable steps are dimmed in the stepper with tooltip. Clicking does nothing.

**Error handling:**
- `onSaveComplete` receives `StepResult`
- On `success: false`: show error inline below navigation bar per `errorType`
- On validation error: stay on current step
- On precondition error: show message, optionally highlight what needs fixing
- On server error: show message with retry

**Commit:** `feat: wire all 4 wizard steps with navigation, callbacks, and availability rules`

---

## Task 5: Entry Point + Tablet Responsive + Polish

**Files:**
- Modify: `src/components/patients/patient-detail-content.tsx`
- Modify: `src/app/(platform)/pacientes/[id]/atendimento/page.tsx` (polish)
- Modify: `src/components/service-wizard/wizard-stepper.tsx` (responsive)
- Modify: `src/components/service-wizard/service-wizard.tsx` (responsive)

**What to build:**

### "Iniciar Atendimento" button
Add a prominent button to the patient detail page header:
- Text: "Iniciar Atendimento"
- Style: `bg-forest text-cream hover:bg-sage`, prominent size
- Links to `/pacientes/[id]/atendimento`
- Shows as the primary action (replaces or sits alongside existing quick actions)

### Smart context message
On the wizard page, show a brief context message below the patient bar:
- "Novo atendimento" if no procedure exists
- "Continuando planejamento" if procedure is `planned`
- "Procedimento aprovado — pronto para execução" if `approved`

### Exit confirmation
When clicking "Sair" or browser back:
- If on step 1 (anamnesis auto-saved): no confirmation needed
- If on steps 2-4 with unsaved changes: show confirmation dialog "Tem certeza que deseja sair? Dados não salvos serão perdidos."
- `beforeunload` handler for tab close/refresh

### Tablet considerations
- **Stepper:** vertical layout on screens < 768px
- **Face diagram:** minimum touch target 44px for injection points. Test on actual tablet
- **Signature pad:** full-width on mobile, works with finger input (touch, not just mouse)
- **Navigation bar:** sticky bottom, full-width buttons on mobile, minimum 48px height, adequate spacing to prevent mis-taps
- **Tooltips on unavailable steps:** replaced with tap-to-reveal on touch devices (no hover on touch)

### Loading state
Show skeleton while patient/procedure data loads.

### Page metadata
`title: "Atendimento · {patientName} | FloraClin"`

**Commit:** `feat: Iniciar Atendimento entry point, tablet responsive, smart context, exit confirmation`

---

## Post-Implementation Checklist

- [ ] "Iniciar Atendimento" button visible on patient detail page
- [ ] Wizard opens at correct step based on procedure status + URL `?step` param
- [ ] Step 1 (Anamnese) shows existing data with timestamp, auto-saves, sections collapsed with completion indicators
- [ ] Step 2 (Planejamento) creates/updates procedure, face diagram works, financial plan card included
- [ ] Step 3 (Aprovação) shows plan summary, consent signing interactive, contract signing, "Adiar Aprovação" works
- [ ] Step 4 (Execução) allows quantity updates, batch numbers, notes, photos
- [ ] "Finalizar Atendimento" completes the procedure and redirects
- [ ] Navigation: can go back to completed steps, skip rules enforced per step
- [ ] Stepper: unavailable steps dimmed with tooltip, completed steps sage checkmark, current step forest highlight
- [ ] All steps stay mounted (CSS `display: none`), no remount on navigation
- [ ] URL tracks current step, survives browser refresh
- [ ] Error handling: validation, precondition, and server errors shown inline
- [ ] Callback pattern: no `useImperativeHandle`, uses `triggerSave` + `onSaveComplete`
- [ ] Smart context: wizard starts at correct step
- [ ] Exit confirmation + `beforeunload` handler works
- [ ] Tablet: vertical stepper, 44px touch targets on diagram, full-width signature pad, sticky bottom nav
- [ ] Full-page layout with compact patient bar
- [ ] Brand v2 colors applied
- [ ] All text in pt-BR
