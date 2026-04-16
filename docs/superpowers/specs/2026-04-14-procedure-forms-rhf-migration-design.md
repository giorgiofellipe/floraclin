# Procedure Forms → React Hook Form Migration + Save Indicator

## Goal

Migrate `procedure-form.tsx`, `procedure-approval.tsx`, and `procedure-execution.tsx` from ad-hoc `useState` to react-hook-form with zod validation, decompose each file into focused subcomponents, and layer the wizard save-status indicator + "Salvar e sair" button on top of the new RHF foundation.

This supersedes `docs/superpowers/specs/2026-04-14-wizard-save-indicator-and-exit-design.md`, which discovered during planning that its foundation (container event listeners) was incompatible with the project's Base UI component library. This spec delivers the same end-user feature (save indicator + save-and-exit button) but on correct foundations.

## Background

The wizard (`web/src/components/service-wizard/service-wizard.tsx`) is a 5-step flow: Anamnese → Procedimentos → Planejamento → Aprovação → Execução. Today:

- **Anamnese** uses react-hook-form with auto-save (1s debounce on every change).
- **Procedimentos** is a type picker; local state only, persists via step 3.
- **Planejamento / Aprovação / Execução** each use ~30 ad-hoc `useState` fields plus arrays and nested objects. Validation is inline (`if (!x) setSubmitError(...)`). Errors display in a single top banner.
- Base UI primitives (`@base-ui-components/react` Select, Checkbox, Switch, DatePicker) render custom elements that do NOT dispatch bubbling native `input`/`change` events. Any dirty-tracking mechanism that depends on DOM event bubbling is fundamentally broken on these forms.

The save indicator feature needs reliable per-step dirty tracking. The only sound approach is to own form state through a library that tracks dirtiness intrinsically. React-hook-form is already used by `AnamnesisForm` — extending it to the procedure forms unifies the pattern.

## Scope

**In scope (one-shot, no deferrals):**
- Full RHF migration of `procedure-form.tsx`, `procedure-approval.tsx`, `procedure-execution.tsx`
- Zod schemas covering every form field (extended from existing `web/src/validations/procedure.ts`)
- Dynamic zod schema generation for evaluation template responses
- Component decomposition to bring each file under target line counts
- Field-level validation errors inline under each field
- Separate top banners for validation-summary and server-error states
- Deletion of all inline validation and `submitError` state
- Save status indicator in the wizard's bottom bar middle slot
- "Salvar e sair" button on steps 1 and 3
- Characterization tests gate each form's migration

**Out of scope:**
- Auto-save for the procedure forms (manual save-on-Próximo remains — user picked option A)
- Validation-schema changes to AnamnesisForm (already uses RHF)
- Mobile-specific layout redesign beyond keeping the indicator hidden below `md`
- Redesign of any field UI — the migration preserves visual layout, only rewires state

## Migration phases

Executed sequentially in one branch (single plan, single commit sequence when user authorizes):

```
Phase 0 — Characterization tests
Phase 1 — Shared infrastructure (schemas, components, helpers)
Phase 2 — procedure-form.tsx migration + decomposition
Phase 3 — procedure-approval.tsx migration + decomposition
Phase 4 — procedure-execution.tsx migration + decomposition
Phase 5 — Wire save indicator + "Salvar e sair" in service-wizard.tsx
Phase 6 — Manual smoke test across all 5 wizard steps
```

Each form's phase (2, 3, 4) contains the same 5 substeps:
1. Install `useForm` alongside existing `useState` — no state removed yet, form shadows existing values
2. Field-by-field migration — primitives → Base UI components → Controllers — running the characterization test after each step
3. Replace the submit/save handler with `handleSubmit(onValid, onInvalid)`
4. Delete all inline validation and `submitError`; wire top banner to `formState.errors.root.serverError`
5. Decompose into subcomponents (FinancialPlanField, etc.) once the migration is complete

## Schemas

Extend `web/src/validations/procedure.ts` with form-specific schemas layered over the existing wire-format schemas.

### `procedurePlanningFormSchema`

Superset of `createProcedureSchema`. Covers every step-3 form field:

```ts
export const procedurePlanningFormSchema = z.object({
  procedureTypeId: z.string().uuid('Tipo de procedimento é obrigatório'),
  additionalTypeIds: z.array(z.string().uuid()).default([]),
  technique: z.string().max(5000).optional().default(''),
  clinicalResponse: z.string().max(5000).optional().default(''),
  adverseEffects: z.string().max(5000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000).optional().default(''),
  financialPlan: financialPlanSchema.optional(),
  diagramPoints: z.array(diagramPointSchema).default([]),
  evaluationResponses: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  consentAccepted: z.boolean().default(false),
})

export type ProcedurePlanningFormData = z.infer<typeof procedurePlanningFormSchema>
```

**Draft vs final save.** The schema above enforces format only (lengths, uuid format, number ranges) so drafts can save with empty required fields. A separate `procedurePlanningFinalSchema` extends the form schema with required-field refinements — applied only when the user transitions to step 4 (approval). Drafts saved via "Salvar e sair" or through advancing to the next step use the looser schema; finalization runs the stricter one.

```ts
export const procedurePlanningFinalSchema = procedurePlanningFormSchema.superRefine((data, ctx) => {
  if (!data.financialPlan) {
    ctx.addIssue({ code: 'custom', path: ['financialPlan'], message: 'Plano financeiro obrigatório' })
  }
  if (!data.consentAccepted) {
    ctx.addIssue({ code: 'custom', path: ['consentAccepted'], message: 'Consentimento obrigatório' })
  }
  if (data.diagramPoints.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['diagramPoints'], message: 'Marque ao menos um ponto no diagrama' })
  }
})
```

### `procedureApprovalFormSchema`

```ts
export const procedureApprovalFormSchema = z.object({
  signature: z.string().min(1, 'Assinatura obrigatória'),
  consentAccepted: z.literal(true, { message: 'Consentimento obrigatório' }),
  notes: z.string().max(2000).optional().default(''),
})

export type ProcedureApprovalFormData = z.infer<typeof procedureApprovalFormSchema>
```

### `procedureExecutionFormSchema`

```ts
export const procedureExecutionFormSchema = z.object({
  performedAt: z.string().min(1, 'Data de execução obrigatória'),
  technique: z.string().max(5000).optional().default(''),
  clinicalResponse: z.string().max(5000).optional().default(''),
  adverseEffects: z.string().max(5000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  nextSessionObjectives: z.string().max(5000).optional().default(''),
  productApplications: z.array(productApplicationItemSchema).default([]),
  followUpDate: z.string().optional().default(''),
})

export type ProcedureExecutionFormData = z.infer<typeof procedureExecutionFormSchema>
```

### Dynamic evaluation response schema

`web/src/lib/validations/build-evaluation-schema.ts` (new file):

```ts
export function buildEvaluationResponseSchema(
  templates: EvaluationTemplateForForm[],
): z.ZodType<Record<string, Record<string, unknown>>> {
  // Build a record<templateId, record<fieldId, zodType>> from runtime templates.
  // Required fields come from template.sections[].fields[].required.
  // Field types come from template.sections[].fields[].type ('text', 'number', 'choice', ...).
}
```

Plugged into `procedurePlanningFinalSchema` via a runtime wrapper (composition at the useForm call site):

```ts
const finalSchema = procedurePlanningFinalSchema.and(
  z.object({ evaluationResponses: buildEvaluationResponseSchema(evalTemplates) })
)
```

The wizard decides which schema (loose or final) to run based on the save trigger source:
- Próximo from step 3 that transitions to step 4 → final schema
- Salvar e sair on step 3 → loose schema
- Próximo on step 1/2/anywhere else → form's own schema

Implementation: `WizardOverrides` gains a `validationMode?: 'draft' | 'final'` field. The wizard sets it to `'final'` for Próximo-on-step-3 and `'draft'` otherwise. On save, the form's submit handler runs validation manually via `finalSchema.safeParse(form.getValues())` when `validationMode === 'final'`, otherwise it uses `form.handleSubmit(onValid, onInvalid)` with its default resolver (the draft schema). If the manual `safeParse` fails, the form populates `formState.errors` via `form.setError` for each issue, then invokes `onInvalid` with the aggregated error map. This keeps a single submit pipeline and avoids swapping resolvers mid-form.

## Component decomposition

### `procedure-form.tsx` (~1800 lines → target ~800)

New files under `web/src/components/procedures/planning/`:
- `financial-plan-field.tsx` — `<FinancialPlanField control={form.control} name="financialPlan" />`
- `procedure-types-section.tsx` — `<ProcedureTypesSection control name="procedureTypeId" additionalName="additionalTypeIds" />`
- `planning-details-section.tsx` — the five Textarea fields (technique, clinicalResponse, adverseEffects, notes, nextSessionObjectives) grouped with their section headers
- `evaluation-templates-section.tsx` — `<EvaluationTemplatesSection control name="evaluationResponses" templates={...} />`
- `diagram-section.tsx` — `<DiagramSection control name="diagramPoints" previousPoints={...} products={...} />` — wraps `<FaceDiagramEditor>`
- `consent-section.tsx` — `<ConsentSection control name="consentAccepted" consentTemplate={...} />`

`procedure-form.tsx` becomes a composition shell: RHF setup, data fetching, layout scaffolding, section composition.

### `procedure-approval.tsx` (~900 lines → target ~400)

New files under `web/src/components/procedures/approval/`:
- `signature-section.tsx` — `<SignatureSection control name="signature" />` wraps `<SignaturePad>`
- `approval-summary-card.tsx` — read-only procedure summary for patient confirmation
- `approval-consent-section.tsx` — the approval-specific consent line + checkbox

### `procedure-execution.tsx` (~1000 lines → target ~500)

New files under `web/src/components/procedures/execution/`:
- `product-application-row.tsx` — `<ProductApplicationRow control index onRemove />` — single row inside the `useFieldArray`
- `product-applications-section.tsx` — `<ProductApplicationsSection control name="productApplications" />` — wraps field array + add button
- `execution-details-section.tsx` — the post-execution textareas grouped
- `execution-photo-section.tsx` — photo uploads + refresh-key logic

## Controller integration points

| Form | Field | Wiring |
|---|---|---|
| planning | `procedureTypeId`, `additionalTypeIds` | `<Controller>` inside `ProcedureTypesSection` |
| planning | `technique`, `clinicalResponse`, `adverseEffects`, `notes`, `nextSessionObjectives` | `form.register` on `<Textarea>` |
| planning | `followUpDate` | `<Controller>` around `<DatePicker>` |
| planning | `financialPlan` | `<Controller>` inside `FinancialPlanField` |
| planning | `diagramPoints` | `<Controller>` around `<FaceDiagramEditor>` in `DiagramSection` |
| planning | `evaluationResponses` | `<Controller>` around `<TemplateRenderer>` in `EvaluationTemplatesSection` (single RHF field holds whole record) |
| planning | `consentAccepted` | `<Controller>` around Base UI `<Checkbox>` |
| approval | `signature` | `<Controller>` around `<SignaturePad>` |
| approval | `consentAccepted` | `<Controller>` around Base UI `<Checkbox>` |
| approval | `notes` | `form.register` |
| execution | `performedAt`, `followUpDate` | `<Controller>` around `<DatePicker>` |
| execution | `technique`, `clinicalResponse`, `adverseEffects`, `notes`, `nextSessionObjectives` | `form.register` |
| execution | `productApplications` | `useFieldArray({ name: 'productApplications' })` |

No changes to `<FaceDiagramEditor>`, `<SignaturePad>`, `<TemplateRenderer>`, or the Base UI components themselves — all already have clean controlled interfaces.

## Error display infrastructure

Shared components used by all three forms (Phase 1):

### `<FormServerErrorBanner>`

`web/src/components/forms/form-server-error-banner.tsx`:

```tsx
interface Props {
  form: UseFormReturn<any>
  onRetry?: () => void
}

export function FormServerErrorBanner({ form, onRetry }: Props) {
  const serverError = form.formState.errors.root?.serverError?.message
  if (!serverError) return null
  return (
    <div className="... red banner ...">
      <AlertCircle />
      <p>{serverError}</p>
      {onRetry && <button onClick={onRetry}>Tentar novamente</button>}
    </div>
  )
}
```

### `<FormValidationSummary>`

`web/src/components/forms/form-validation-summary.tsx`:

```tsx
// Renders when formState.errors has any non-root.serverError key.
// Shows "Corrija os campos destacados" summary with a click-to-scroll behavior
// that finds the first errored field via its registered ref.
```

### `<FormFieldError>`

`web/src/components/forms/form-field-error.tsx`:

```tsx
interface Props {
  form: UseFormReturn<any>
  name: string  // supports dot-path for nested fields
}

export function FormFieldError({ form, name }: Props) {
  const error = get(form.formState.errors, name)
  if (!error) return null
  return <p className="text-xs text-red-600 mt-1">{error.message}</p>
}
```

Used under every field:

```tsx
<Textarea {...form.register('technique')} />
<FormFieldError form={form} name="technique" />
```

### First-field scroll-into-view

In each form, a `useEffect` watching `formState.submitCount`:

```tsx
useEffect(() => {
  if (form.formState.submitCount === 0) return
  const firstError = findFirstError(form.formState.errors)
  if (firstError) {
    const el = document.querySelector(`[name="${firstError.name}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus()
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.formState.submitCount])
```

## Save flow

**Manual save (triggered by wizard's Próximo or Salvar e sair):**

1. Wizard increments `state.triggerSave` counter (existing mechanism, unchanged)
2. Form's `useEffect` on `triggerSave` change calls `form.handleSubmit(onValid, onInvalid)()`
3. `onValid(values)`:
   - Clear any previous `root.serverError`
   - `try { await upsertProcedure(values); form.reset(values); wizardOverrides.onSaveComplete({ success: true, procedureId }) }`
   - `catch (err) { form.setError('root.serverError', { message: err.message }); wizardOverrides.onSaveComplete({ success: false, errorType: 'server' }) }`
4. `onInvalid(errors)` → RHF has already populated `formState.errors` → `wizardOverrides.onSaveComplete({ success: false, errorType: 'validation' })` → wizard stays on current step, field errors visible inline, validation-summary banner visible at top

**Auto-save (anamnesis only — unchanged from existing behavior):**

- Anamnesis keeps its debounced `watch()` → save pattern
- Each successful auto-save calls `wizardOverrides.onAutoSaved(timestamp)` (new callback) to update `stepTimestamps.anamnesis` without advancing the step

## Save indicator + "Salvar e sair"

Carried over from the superseded spec. Key properties:

**Middle slot of bottom bar (desktop only, hidden below `md`):**
- Empty: no timestamp + not dirty + not saving + no error
- Dirty (amber dot + "Alterações não salvas"): `stepDirty[currentStep] === true`
- Saving (spinner + "Salvando..."): `state.isSaving === true`
- Saved (sage check + "Salvo há Xmin"): has `stepTimestamps[currentStep]`, not dirty, not saving
- Error (red ✗ + "Erro ao salvar"): `state.errorType === 'server'`
- Priority: Saving > Error > Dirty > Saved > Empty

**Relative-time label refreshes via a 30-second `setInterval` at wizard level:**
- `const [now, setNow] = useState<Date>(() => new Date())`
- `setInterval(() => setNow(new Date()), 30_000)` — cleared on unmount
- Passed to `<SaveStatusIndicator>` as `now` prop

**Dirty-state plumbing:**
- Wizard tracks `const [stepDirty, setStepDirty] = useState<Record<number, boolean>>({})`
- `useMemo`'d per-step stable callbacks `dirtyHandlers[1..5]`, each does `setStepDirty(p => (p[step] === d ? p : { ...p, [step]: d }))`
- Passed into each step's `wizardOverrides.onDirtyChange`
- Each form runs one `useEffect(() => { wizardOverrides?.onDirtyChange?.(form.formState.isDirty) }, [form.formState.isDirty])`
- `form.reset(values)` after save flips `isDirty` false → callback fires → indicator updates

**"Salvar e sair" button:**
- Visible on steps 1 and 3 only
- Always enabled when visible (no dirty gating)
- DOM-after Próximo, visually `md:order-2` between Pular (order-1) and Próximo (order-3)
- Click handler:
  1. Set `pendingActionRef.current = 'exit'`
  2. Call `triggerSave()` (same path as Próximo)
  3. In `handleStepComplete`: read `pendingActionRef.current` into local, reset ref to `'advance'`, if `result.success && pending === 'exit'` → `isExitingRef.current = true; router.push('/pacientes/{id}'); toast.success('Atendimento salvo. Retome quando quiser.')` instead of `nextStep()`

## Testing

### Phase 0 — Characterization tests (must pass before AND after each form's migration)

`web/src/components/procedures/__tests__/procedure-form.characterization.test.tsx`:
- Mocks mutations via `vi.mock('@/hooks/mutations/use-procedures')`
- Renders `<ProcedureForm>` with a realistic existing-procedure fixture
- Drives user interactions: type into every textarea, open/close DatePicker, toggle consent, add a diagram point, fill one evaluation response, set financial plan values
- Triggers save (pre-migration: Próximo button; post-migration: RHF handleSubmit via triggerSave)
- Deep snapshots the `upsertProcedure` mutation's arguments
- Pass = snapshot matches before and after migration with zero diff

Equivalent test files for `procedure-approval.characterization.test.tsx` and `procedure-execution.characterization.test.tsx`.

### Phase-level tests (added during each phase)

- Unit tests for each new zod schema: valid payload passes, every required-field-missing case fails, every format error (length, uuid, enum) fails
- Unit tests for `buildEvaluationResponseSchema` — generate schema from a fixture template, validate matching and non-matching responses
- Unit tests for `<FormServerErrorBanner>`, `<FormValidationSummary>`, `<FormFieldError>` — pure render tests
- Unit tests for `<SaveStatusIndicator>` — 5 states, state priority
- Unit tests for `formatRelativeSaveTime(savedAt, now)` — every bucket

### Manual smoke test (Phase 6)

Full walkthrough on the dev server:
1. Fresh patient → Atendimento
2. Step 1 (Anamnese): type in main complaint, observe indicator transitions `empty → dirty → saving → saved`
3. Advance to step 2, select 2 procedure types
4. Advance to step 3 (Planejamento): fill every textarea, click a face diagram point, fill one evaluation response, set financial plan (total value, installments), check consent
5. Click "Salvar e sair" → expect save success, route returns to patient detail, toast "Atendimento salvo. Retome quando quiser."
6. Return to Atendimento (step 3), observe all data preserved, indicator shows "Salvo há Xmin"
7. Trigger a validation error: clear financial plan total → Próximo → field-level error under financial plan, validation-summary banner at top, scroll-to-field fires
8. Fix, advance to step 4 (Aprovação): sign signature pad, check consent, advance — observe inline errors if consent unchecked
9. Step 5 (Execução): add 2 product application rows, fill dates, upload photos, finalize — observe field errors if required fields missing
10. Full flow complete → toast "Atendimento finalizado"
11. Mobile breakpoint (<md): indicator hidden, buttons stack vertically, layout doesn't break

## Non-goals / explicit YAGNI

- No auto-save for procedure forms (manual save only — chosen by user)
- No RHF migration of `AnamnesisForm` (already uses RHF, only its dirty-tracking wiring changes)
- No changes to `<FaceDiagramEditor>`, `<SignaturePad>`, `<TemplateRenderer>` components themselves
- No changes to validation of the top-level `procedureTypeStep` (step 2 is just a picker, no form)
- No mobile redesign
- No touched-state tracking (RHF provides it, but we don't expose it in UI)
- No undo/redo for dirty state

## Risk assessment

**High-risk areas:**
- `procedure-form.tsx` size and complexity — mitigated by Phase 0 characterization tests + subcomponent extraction
- Evaluation template dynamic validation — mitigated by `buildEvaluationResponseSchema` unit tests before Phase 2
- Face diagram Controller wrapping — mitigated by the clean `points` + `onChange(points)` interface (already verified)
- Draft-vs-final schema dispatch — mitigated by routing through a single wizard-level `validationMode` flag passed through `wizardOverrides`

**Medium-risk areas:**
- `procedure-form.tsx`'s existing `handleSubmit` has multiple branches (create/update/validation-fail/execution-path) — reconciling them to one `handleSubmit` requires careful branch mapping, documented in the plan

**Low-risk areas:**
- Save indicator component (pure render, 5 states, trivially tested)
- Top-error-banner and inline-error components (pure render)
- `relative-time.ts` helper (pure function, exhaustively tested)

## Commit policy

Per user preference: **no commits until explicit approval**. The plan will not include commit steps. Work stays staged until the user explicitly says "commit."
