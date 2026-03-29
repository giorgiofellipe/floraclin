# Service Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current separate procedure screens with a unified full-page wizard that guides the professional through the entire patient service — from anamnesis through execution — in focused, sequential steps.

**Architecture:** Wraps existing components (AnamnesisForm, ProcedureForm, ProcedureApproval, ProcedureExecution) inside a new wizard orchestrator. Each component gets a `wizardMode` prop that hides its own navigation. The wizard controls save/advance.

**Tech Stack:** React state management (useState), existing Server Actions, existing components with `wizardMode` prop.

---

## Wizard Overview

**URL:** `/pacientes/[id]/atendimento`

**Trigger:** "Iniciar Atendimento" button on patient detail page.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  Sofia Almeida · 34 anos · (11) 98765-4321               │ compact patient bar
├──────────────────────────────────────────────────────────┤
│  ① Anamnese  ② Planejamento  ③ Orçamento  ④ Aprovação  ⑤ Execução  │ stepper
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Step content (one step visible at a time)               │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Voltar]                         [Pular]    [Próximo]   │ navigation bar
└──────────────────────────────────────────────────────────┘
```

**Smart context on open:**
- No procedure exists → starts at step 1
- Procedure `planned` → starts at step 4, steps 1-3 show completed
- Procedure `approved` → starts at step 5, steps 1-4 show completed
- Professional can navigate back to any step

**Stepper shows per step:**
- Number + name
- Status: completed (checkmark), current (highlighted), upcoming (dimmed)
- "Última atualização: dd/mm/yyyy às HH:mm" below completed steps
- Clickable to navigate to any step

---

## Steps

### Step 1 — Anamnese
- Embeds existing `AnamnesisForm`
- Shows "Última atualização" timestamp at top
- Auto-saves on blur/change (existing behavior)
- "Próximo" just advances — data already saved via auto-save
- If empty: sections expanded. If filled: collapsed with green checks.

### Step 2 — Planejamento
- Procedure type checkboxes (multi-select)
- Face diagram editor (freeform points, products from catalog)
- No financial fields (that's step 3)
- "Próximo" creates/updates procedure as `planned`
- This step creates the procedure record that carries through the wizard

### Step 3 — Orçamento
- Financial plan: total amount (auto-summed), installments, payment method, notes
- Installment breakdown preview
- "Próximo" updates the procedure's `financialPlan` JSONB
- Focused on the money conversation only

### Step 4 — Aprovação
- Read-only plan summary (procedures, diagram totals, financial terms)
- Consent signing checklist
- Service contract with interpolated text + signature
- "Próximo" calls `approveProcedureAction` — creates financial entry, snapshots plan
- Skippable if patient wants to think about it

### Step 5 — Execução
- Update diagram quantities, add/remove points
- Batch/lot numbers per product
- Clinical notes (technique, response, adverse effects)
- Pre/post photos
- "Finalizar Atendimento" calls `executeProcedureAction`
- Only accessible if procedure is `approved`
- If not approved: shows message + link to step 4

---

## State

```typescript
interface WizardState {
  currentStep: number // 1-5
  procedureId: string | null // created at step 2
  procedureStatus: ProcedureStatus | null
  stepTimestamps: {
    anamnesis: Date | null
    planning: Date | null
    financial: Date | null
    approval: Date | null
    execution: Date | null
  }
}
```

**Flow:**
1. Page loads → fetch patient, anamnesis, latest non-executed procedure
2. Pre-fill state from existing data
3. Step 1 → anamnesis auto-saved, advance
4. Step 2 → create/update procedure → store `procedureId`
5. Step 3 → update `financialPlan` on procedure
6. Step 4 → `approveProcedureAction` → status `approved`
7. Step 5 → `executeProcedureAction` → status `executed` → redirect to patient detail

---

## Dependency Graph

```
Task 1: Wizard shell (page, stepper, navigation, state)
  ↓
Tasks 2, 3 IN PARALLEL:
  Task 2: Add wizardMode to existing components
  Task 3: Extract FinancialPlanStep component
  ↓
Task 4: Wire all steps into wizard
  ↓
Task 5: Add "Iniciar Atendimento" button + smart context
```

---

## Task 1: Wizard Shell

**Files:**
- Create: `src/app/(platform)/pacientes/[id]/atendimento/page.tsx`
- Create: `src/components/service-wizard/service-wizard.tsx`
- Create: `src/components/service-wizard/wizard-step.tsx`

**What to build:**

### Page (`atendimento/page.tsx`)
Server component that:
- Loads patient data (`getPatient`)
- Loads anamnesis data (`getAnamnesis`) with timestamp
- Loads latest non-executed procedure for this patient (query `procedure_records` WHERE `patient_id` AND `status IN ('planned', 'approved')` AND `deleted_at IS NULL`, order by `created_at DESC`, limit 1)
- If procedure exists, loads its diagrams, product applications
- Passes everything to `ServiceWizard`

### ServiceWizard (`service-wizard.tsx`)
Client component:
- Full-page layout with compact patient bar, stepper, content area, navigation bar
- Manages `WizardState` via useState
- Determines starting step from procedure status
- Renders the active step's content component
- Handles "Voltar", "Pular", "Próximo" navigation
- "Próximo" triggers the active step's save callback before advancing
- Each step component exposes `onSave: () => Promise<{ success: boolean; procedureId?: string }>`

### WizardStep (`wizard-step.tsx`)
Reusable step wrapper:
- Shows step title
- Shows "Última atualização" timestamp if available
- Wraps the step content
- Handles the "Pular" vs "Próximo" logic

### Patient compact bar
- Name, age (from birth_date), phone, CPF (masked)
- "Sair" button to exit wizard → confirms if unsaved changes

### Stepper
- Horizontal, 5 steps
- Each step: number, label, status icon, timestamp
- Clickable
- Current step highlighted with forest underline
- Completed steps: sage checkmark
- Upcoming: dimmed

Brand v2 colors: white cards, `#F4F6F8` background, `shadow-[0_1px_4px_rgba(0,0,0,0.06)]`, `rounded-[3px]`.

**Commit:** `feat: service wizard shell - page, stepper, navigation, state management`

---

## Task 2: Add wizardMode to Existing Components

**Files:**
- Modify: `src/components/anamnesis/anamnesis-form.tsx`
- Modify: `src/components/procedures/procedure-form.tsx`
- Modify: `src/components/procedures/procedure-approval.tsx`
- Modify: `src/components/procedures/procedure-execution.tsx`

**What to change:**

Each component gets a `wizardMode?: boolean` prop. When `wizardMode` is true:
- Hide the component's own submit/save button
- Hide the component's own back/cancel navigation
- Expose an `onSave` ref or callback that the wizard calls to trigger save
- Return save result to the wizard (success/failure + created ID)

Pattern using `useImperativeHandle`:
```typescript
interface WizardStepRef {
  save: () => Promise<{ success: boolean; procedureId?: string; error?: string }>
}

// In each component:
const ref = useRef<WizardStepRef>(null)
useImperativeHandle(ref, () => ({
  save: async () => {
    // existing save logic
    return { success: true, procedureId: '...' }
  }
}))
```

**AnamnesisForm**: In wizard mode, hide any save button (it auto-saves). The wizard's "Próximo" just advances without calling save (already saved via debounce).

**ProcedureForm**: In wizard mode, show ONLY the planning fields (procedure types + face diagram). Hide financial section (that's a separate step). Hide submit button. Expose `save` via ref.

**ProcedureApproval**: In wizard mode, hide the "Aprovar" button at the bottom. Expose `approve` via ref. The wizard calls it when "Próximo" is clicked.

**ProcedureExecution**: In wizard mode, hide the "Salvar como Executado" button. Expose `execute` via ref. The wizard calls it when "Finalizar Atendimento" is clicked.

**Commit:** `feat: add wizardMode prop to anamnesis, procedure form, approval, and execution components`

---

## Task 3: Extract FinancialPlanStep

**Files:**
- Create: `src/components/service-wizard/financial-plan-step.tsx`

**What to build:**

Extract the financial plan section from `procedure-form.tsx` into its own component for step 3 of the wizard.

Fields:
- Total amount (currency masked, auto-summed from procedure types)
- Installment count (1-12 select)
- Payment method (select with labels)
- Notes (textarea)
- Installment preview showing per-installment amounts and dates

Props:
```typescript
interface FinancialPlanStepProps {
  procedureId: string
  initialPlan?: FinancialPlan
  procedureTypes: { name: string; defaultPrice: number | null }[]
  wizardMode?: boolean
  ref?: React.Ref<WizardStepRef>
}
```

The `save` method updates the procedure's `financialPlan` JSONB via `updateProcedureAction`.

**Commit:** `feat: extract financial plan step component for service wizard`

---

## Task 4: Wire All Steps

**Files:**
- Modify: `src/components/service-wizard/service-wizard.tsx`

**What to build:**

Wire each step in the wizard to its component:

```tsx
function renderStepContent(step: number) {
  switch (step) {
    case 1:
      return <AnamnesisForm patientId={patientId} wizardMode ref={step1Ref} />
    case 2:
      return <ProcedureForm patientId={patientId} wizardMode ref={step2Ref} ... />
    case 3:
      return <FinancialPlanStep procedureId={procedureId} wizardMode ref={step3Ref} ... />
    case 4:
      return <ProcedureApproval procedureId={procedureId} wizardMode ref={step4Ref} ... />
    case 5:
      return <ProcedureExecution procedureId={procedureId} wizardMode ref={step5Ref} ... />
  }
}
```

**Navigation logic:**
- "Próximo" on step 1: just advance (auto-saved)
- "Próximo" on step 2: call `step2Ref.current.save()` → get `procedureId` → advance
- "Próximo" on step 3: call `step3Ref.current.save()` → advance
- "Próximo" on step 4: call `step4Ref.current.save()` → advance (this does approval)
- "Finalizar" on step 5: call `step5Ref.current.save()` → redirect to patient detail

**Step availability:**
- Steps 1 always available
- Step 2 always available
- Step 3 requires `procedureId` (created in step 2)
- Step 4 requires `procedureId` + procedure status `planned`
- Step 5 requires procedure status `approved`

If a step isn't available and the professional navigates to it, show a message explaining what needs to happen first.

**Commit:** `feat: wire all wizard steps with navigation, save callbacks, and availability rules`

---

## Task 5: Entry Point + Polish

**Files:**
- Modify: `src/components/patients/patient-detail-content.tsx`
- Modify: `src/app/(platform)/pacientes/[id]/atendimento/page.tsx` (polish)

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
- If on steps 2-5 with unsaved changes: show confirmation dialog "Tem certeza que deseja sair? Dados não salvos serão perdidos."

### Loading state
Show skeleton while patient/procedure data loads.

### Page metadata
`title: "Atendimento · {patientName} | FloraClin"`

**Commit:** `feat: Iniciar Atendimento entry point, smart context, exit confirmation`

---

## Post-Implementation Checklist

- [ ] "Iniciar Atendimento" button visible on patient detail page
- [ ] Wizard opens at correct step based on procedure status
- [ ] Step 1 (Anamnese) shows existing data with timestamp, auto-saves
- [ ] Step 2 (Planejamento) creates/updates procedure, face diagram works
- [ ] Step 3 (Orçamento) updates financial plan, preview shows installments
- [ ] Step 4 (Aprovação) shows plan summary, consent signing, contract signing
- [ ] Step 5 (Execução) allows quantity updates, batch numbers, notes, photos
- [ ] "Finalizar Atendimento" completes the procedure
- [ ] Navigation: can go back to any step, skip works, timestamps shown
- [ ] Smart context: wizard starts at correct step
- [ ] Exit confirmation works
- [ ] Full-page layout with compact patient bar
- [ ] Brand v2 colors applied
- [ ] All text in pt-BR
