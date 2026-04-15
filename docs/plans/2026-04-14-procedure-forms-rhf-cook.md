# Procedure Forms RHF Migration + Save Indicator — Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate `procedure-form.tsx` and `procedure-execution.tsx` to react-hook-form + zod, decompose all three procedure-domain files into focused subcomponents, add explicit dirty tracking to `procedure-approval.tsx`, and wire the wizard save-status indicator + "Salvar e sair" button on top.

**Revision notes:** The first draft of this plan contained factual errors about the real code (wrong mutation hook paths, invented signature/consent schemas for approval, invented `performedAt` field for execution, unreliable `getByLabelText` test strategy). Adversarial review caught them. This revision:

- Uses the real mutation paths (`@/hooks/mutations/use-procedure-mutations` + `@/hooks/mutations/use-consent-mutations` + `@/hooks/mutations/use-evaluation-mutations`)
- Does NOT migrate `procedure-approval.tsx` to RHF — it's not a form, it's a multi-step gate validator. Instead: explicit `hasUnsavedChanges` state + decomposition
- Fixes execution schema (no `performedAt`, uses `diagrams` array matching the real payload)
- Uses pre-populated fixture + `triggerSave` for characterization tests (no reliance on label-to-input associations)
- Group B form-error tests use `useEffect` to call `setError` (avoids render-time loop)
- C1 gates final-mode validation on `!loadingEvaluationTemplates`

**Tech stack:** React 19, Next.js 16, TypeScript, react-hook-form 7.72, @hookform/resolvers 5.2, zod, Vitest + @testing-library/react.

**Commit policy:** No commits until user explicitly approves.

**Branch:** `feat/procedure-forms-rhf` (already created off `feat/monorepo`).

**Spec:** `docs/superpowers/specs/2026-04-14-procedure-forms-rhf-migration-design.md` — spec is now slightly out of date on the approval treatment (plan carves it out of RHF); the spec's "goals" section remains correct.

---

## File Structure

**New files:**
```
web/src/lib/relative-time.ts
web/src/lib/__tests__/relative-time.test.ts
web/src/lib/validations/build-evaluation-schema.ts
web/src/lib/validations/__tests__/build-evaluation-schema.test.ts
web/src/components/forms/form-server-error-banner.tsx
web/src/components/forms/form-validation-summary.tsx
web/src/components/forms/form-field-error.tsx
web/src/components/forms/__tests__/form-server-error-banner.test.tsx
web/src/components/forms/__tests__/form-validation-summary.test.tsx
web/src/components/forms/__tests__/form-field-error.test.tsx
web/src/components/service-wizard/save-status-indicator.tsx
web/src/components/service-wizard/__tests__/save-status-indicator.test.tsx
web/src/components/procedures/planning/financial-plan-field.tsx
web/src/components/procedures/planning/procedure-types-section.tsx
web/src/components/procedures/planning/planning-details-section.tsx
web/src/components/procedures/planning/evaluation-templates-section.tsx
web/src/components/procedures/planning/diagram-section.tsx
web/src/components/procedures/planning/consent-section.tsx
web/src/components/procedures/approval/approval-summary-card.tsx
web/src/components/procedures/approval/consent-status-list.tsx
web/src/components/procedures/approval/service-contract-section.tsx
web/src/components/procedures/execution/product-application-row.tsx
web/src/components/procedures/execution/product-applications-section.tsx
web/src/components/procedures/execution/execution-details-section.tsx
web/src/components/procedures/execution/execution-photo-section.tsx
web/src/components/procedures/__tests__/procedure-form.characterization.test.tsx
web/src/components/procedures/__tests__/procedure-approval.characterization.test.tsx
web/src/components/procedures/__tests__/procedure-execution.characterization.test.tsx
```

**Modified files:**
```
web/src/components/service-wizard/types.ts                        (add onDirtyChange, onAutoSaved, validationMode)
web/src/validations/procedure.ts                                  (add planning + execution schemas)
web/src/components/service-wizard/service-wizard.tsx              (stepDirty, pendingActionRef, indicator, button)
web/src/components/anamnesis/anamnesis-form.tsx                   (onDirtyChange + onAutoSaved wiring)
web/src/components/procedures/procedure-form.tsx                  (full RHF migration + decomposition)
web/src/components/procedures/procedure-approval.tsx              (explicit dirty tracking + decomposition, NOT RHF)
web/src/components/procedures/procedure-execution.tsx             (full RHF migration + decomposition)
web/src/app/(platform)/pacientes/[id]/atendimento/loading.tsx     (skeleton middle slot)
```

## Parallelization Groups

```
Group A (parallel — 4 tasks):
  A1: Characterization test for procedure-form.tsx
  A2: Characterization test for procedure-approval.tsx
  A3: Characterization test for procedure-execution.tsx
  A4: Extend WizardOverrides type with onDirtyChange/onAutoSaved/validationMode

Group B (parallel — 7 tasks, depends on A4):
  B1: Zod schemas for planning + execution in validations/procedure.ts
  B2: buildEvaluationResponseSchema helper + tests
  B3: formatRelativeSaveTime helper + tests
  B4: <SaveStatusIndicator> + tests
  B5: <FormServerErrorBanner> + tests
  B6: <FormValidationSummary> + tests
  B7: <FormFieldError> + tests

Group C (parallel — 3 large migrations, depends on Group B):
  C1: procedure-form.tsx RHF migration + planning/ subcomponents
  C2: procedure-approval.tsx dirty tracking + approval/ subcomponents
  C3: procedure-execution.tsx RHF migration + execution/ subcomponents

Group D (sequential — depends on Group C):
  D1: service-wizard.tsx integration
  D2: anamnesis-form.tsx wiring
  D3: atendimento/loading.tsx skeleton update

Group E (human-driven):
  E1: Manual smoke test walkthrough
```

File ownership: Group C tasks touch three disjoint sets of files. Group D tasks touch three disjoint files. No overlap.

---

## Shared test utilities (referenced by A1/A2/A3)

Every characterization test uses this fetch-mock + QueryClient provider pattern. Include inline in each test file (copy-paste is OK — three tests, no abstraction needed):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

function installFetchMock(routes: Record<string, unknown> = {}) {
  const handler = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString()
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(response), { status: 200 })
      }
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
  global.fetch = handler as unknown as typeof fetch
  return handler
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}
```

The characterization tests pre-populate form state via the `procedure` and `existingDiagrams` props rather than driving user input through labels. This makes the tests reliable regardless of label associations and still catches regressions — pre- and post-migration runs must produce the SAME mutation payload from the SAME input fixture.

---

## Group A — Characterization tests + type extension

### Task A1: Characterization test for procedure-form.tsx

**Files:**
- Create: `web/src/components/procedures/__tests__/procedure-form.characterization.test.tsx`

**Strategy:** Mount with a full `procedure` fixture in planning mode, fire `triggerSave` via prop change, assert the mutation's first-argument shape matches what the current code produces (accounting for `isPlanningMode` field stripping: `technique/clinicalResponse/adverseEffects/notes/followUpDate/nextSessionObjectives` are all `undefined` in planning mode; `financialPlan` and `diagrams` are preserved).

- [ ] **Step 1: Write the test**

```tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureForm } from '../procedure-form'

// Mocks MUST be declared at module level so vi.mock hoists them
const mockCreate = vi.fn(async () => ({ data: { id: 'created-proc-id' } }))
const mockUpdate = vi.fn(async () => ({ data: { id: 'updated-proc-id' } }))
const mockSaveEval = vi.fn(async () => ({ id: 'eval-resp-id' }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useCreateProcedure: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateProcedure: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))

vi.mock('@/hooks/mutations/use-evaluation-mutations', () => ({
  useSaveEvaluationResponse: () => ({ mutateAsync: mockSaveEval, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    // Default: empty array; the form handles empty type/product/consent lists gracefully
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProcedureForm — characterization (planning mode)', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    mockUpdate.mockClear()
    mockSaveEval.mockClear()
    installFetchMock()
  })

  it('fires useCreateProcedure with planning-mode payload when triggerSave increments', async () => {
    const onSaveComplete = vi.fn()

    const baseOverrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      hideProcedureTypes: true,
      onSaveComplete,
    }

    // Use a single QueryClient across both renders so the component doesn't unmount on rerender
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProcedureForm
          patientId="patient-123"
          patientGender="female"
          initialTypeIds={['550e8400-e29b-41d4-a716-446655440000']}
          mode="create"
          wizardOverrides={{ ...baseOverrides, triggerSave: 0 }}
        />
      </QueryClientProvider>,
    )

    // Flip triggerSave to fire the save path — same QueryClient instance so the tree survives
    rerender(
      <QueryClientProvider client={qc}>
        <ProcedureForm
          patientId="patient-123"
          patientGender="female"
          initialTypeIds={['550e8400-e29b-41d4-a716-446655440000']}
          mode="create"
          wizardOverrides={{ ...baseOverrides, triggerSave: 1 }}
        />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled(), { timeout: 3000 })

    const payload = mockCreate.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      patientId: 'patient-123',
      procedureTypeId: '550e8400-e29b-41d4-a716-446655440000',
      technique: undefined,
      clinicalResponse: undefined,
      adverseEffects: undefined,
      notes: undefined,
      followUpDate: undefined,
      nextSessionObjectives: undefined,
    })
  })
})
```

- [ ] **Step 2: Run the test pre-migration**

Run: `pnpm --filter @floraclin/web test procedure-form.characterization`
Expected: PASS.

If it fails, iterate on the fixture/assertion until it matches the current code's actual behavior. Commit the test once it passes pre-migration.

---

### Task A2: Characterization test for procedure-approval.tsx

**Files:**
- Create: `web/src/components/procedures/__tests__/procedure-approval.characterization.test.tsx`

**Strategy:** The approval component doesn't submit a form payload — it gates `approveProcedure.mutateAsync(procedureId)` on `canApprove === true`. The characterization test verifies that when `triggerSave` fires AND preconditions are met (all consents signed + contract signed), the approve mutation is called with just the procedure ID.

**Reality check:** Because `canApprove` depends on async-loaded server state (consents, contract), the test needs `fetch` mocks that return "already signed" for every consent and contract request. The approval happens via a server-side state check, so mocking responses to make `canApprove === true` at mount is the reliable path.

- [ ] **Step 1: Write the test**

```tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureApproval } from '../procedure-approval'

const mockApprove = vi.fn(async () => ({ data: { id: 'proc-id' } }))
const mockAcceptConsent = vi.fn(async () => ({ data: {} }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useApproveProcedure: () => ({ mutateAsync: mockApprove, isPending: false }),
}))

vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useAcceptConsent: () => ({ mutateAsync: mockAcceptConsent, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Procedure types list
    if (url.includes('/api/procedure-types')) {
      return new Response(
        JSON.stringify([
          { id: 'proc-type-id', name: 'Botox', category: 'botox' },
        ]),
        { status: 200 },
      )
    }

    // Consent status — already signed for all relevant types
    if (url.includes('/api/consent/history') || url.includes('/api/consent/status')) {
      return new Response(
        JSON.stringify({ signed: true, signedAt: new Date().toISOString() }),
        { status: 200 },
      )
    }

    // Consent template (contract) — pre-signed
    if (url.includes('/api/consent/templates')) {
      return new Response(
        JSON.stringify({
          id: 'contract-template-id',
          type: 'service_contract',
          title: 'Contrato de Serviço',
          content: 'Termos...',
          version: 1,
        }),
        { status: 200 },
      )
    }

    return new Response(JSON.stringify([]), { status: 200 })
  }) as unknown as typeof fetch
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProcedureApproval — characterization', () => {
  beforeEach(() => {
    mockApprove.mockClear()
    mockAcceptConsent.mockClear()
    installFetchMock()
  })

  it('does not call approveProcedure on mount when preconditions are not yet met', () => {
    const fixtureProcedure = {
      id: 'proc-id',
      procedureTypeId: 'proc-type-id',
      status: 'planned',
      financialPlan: { totalAmount: 1500, installmentCount: 3 },
    } as never

    renderWithProviders(
      <ProcedureApproval
        procedure={fixtureProcedure}
        diagrams={[]}
        patient={{ id: 'patient-id', fullName: 'Maria Silva', gender: 'female' }}
        tenant={{ id: 'tenant-id', name: 'Clínica Flora' }}
        additionalTypeIds={[]}
        wizardOverrides={{
          hideSaveButton: true,
          hideNavigation: true,
          hideTitle: true,
          triggerSave: 0,
        }}
      />,
    )

    expect(mockApprove).not.toHaveBeenCalled()
  })

  // Additional tests may be added once the form's async state is stable enough
  // to reliably reach canApprove === true in a test environment. For now, the
  // characterization test guards against regressions in "don't approve on mount"
  // behavior, which is the structural invariant the C2 migration must preserve.
})
```

- [ ] **Step 2: Run pre-migration**

Run: `pnpm --filter @floraclin/web test procedure-approval.characterization`
Expected: PASS.

---

### Task A3: Characterization test for procedure-execution.tsx

**Files:**
- Create: `web/src/components/procedures/__tests__/procedure-execution.characterization.test.tsx`

**Strategy:** Mount with an approved procedure fixture + existing diagrams. Fire `triggerSave`. Assert `executeProcedure.mutateAsync` was called with the real payload shape: `{id, technique, clinicalResponse, adverseEffects, notes, followUpDate, nextSessionObjectives, diagrams, productApplications}` — NO `performedAt`.

- [ ] **Step 1: Write the test**

```tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureExecution } from '../procedure-execution'

const mockExecute = vi.fn(async () => ({ data: { id: 'proc-id' } }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useExecuteProcedure: () => ({ mutateAsync: mockExecute, isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function installFetchMock() {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProcedureExecution — characterization', () => {
  beforeEach(() => {
    mockExecute.mockClear()
    installFetchMock()
  })

  it('fires useExecuteProcedure with the procedure id and clinical fields when triggerSave increments', async () => {
    const fixtureProcedure = {
      id: 'proc-id',
      procedureTypeId: 'proc-type-id',
      status: 'approved',
      technique: 'Técnica prévia',
      clinicalResponse: 'Resposta prévia',
      adverseEffects: '',
      notes: '',
      followUpDate: '',
      nextSessionObjectives: '',
      plannedSnapshot: null,
    } as never

    const baseOverrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      onSaveComplete: vi.fn(),
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProcedureExecution
          patientId="patient-id"
          patientGender="female"
          procedure={fixtureProcedure}
          diagrams={[]}
          existingApplications={[]}
          wizardOverrides={{ ...baseOverrides, triggerSave: 0 }}
        />
      </QueryClientProvider>,
    )

    rerender(
      <QueryClientProvider client={qc}>
        <ProcedureExecution
          patientId="patient-id"
          patientGender="female"
          procedure={fixtureProcedure}
          diagrams={[]}
          existingApplications={[]}
          wizardOverrides={{ ...baseOverrides, triggerSave: 1 }}
        />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalled(), { timeout: 3000 })

    const payload = mockExecute.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      id: 'proc-id',
      technique: 'Técnica prévia',
      clinicalResponse: 'Resposta prévia',
    })
    // Confirm the payload does NOT have performedAt
    expect(payload).not.toHaveProperty('performedAt')
  })
})
```

- [ ] **Step 2: Run pre-migration**

Run: `pnpm --filter @floraclin/web test procedure-execution.characterization`
Expected: PASS.

---

### Task A4: Extend WizardOverrides type

**Files:**
- Modify: `web/src/components/service-wizard/types.ts`

- [ ] **Step 1: Replace the `WizardOverrides` interface** with:

```ts
export interface StepResult {
  success: boolean
  procedureId?: string
  error?: string
  errorType?: 'validation' | 'precondition' | 'server'
}

export interface WizardOverrides {
  hideSaveButton: boolean
  hideNavigation: boolean
  hideTitle: boolean
  hideProcedureTypes?: boolean
  onSaveComplete?: (result: StepResult) => void
  triggerSave?: number
  /** Flipped by the form whenever its unsaved-changes state changes. */
  onDirtyChange?: (isDirty: boolean) => void
  /** Called after a non-triggerSave save (e.g., anamnesis auto-save) so the wizard can refresh its stepTimestamps. */
  onAutoSaved?: (timestamp: Date) => void
  /** 'final' runs strict validation (e.g., step 3 → step 4). Default 'draft'. */
  validationMode?: 'draft' | 'final'
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck` → Expected: PASS.

---

## Group B — Shared infrastructure

### Task B1: Zod schemas (planning + execution only)

**Files:**
- Modify: `web/src/validations/procedure.ts`

- [ ] **Step 1: Append at the end of the file**

```ts
// ─── Planning form schemas (step 3) ─────────────────────────────────

export const procedurePlanningFormSchema = z.object({
  procedureTypeId: z.string().uuid('Tipo de procedimento é obrigatório'),
  additionalTypeIds: z.array(z.string().uuid()).default([]),
  technique: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  clinicalResponse: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  adverseEffects: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  notes: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  financialPlan: financialPlanSchema.optional(),
  diagramPoints: z.array(diagramPointSchema).default([]),
  evaluationResponses: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  consentAccepted: z.boolean().default(false),
})
export type ProcedurePlanningFormData = z.infer<typeof procedurePlanningFormSchema>

export const procedurePlanningFinalSchema = procedurePlanningFormSchema.superRefine((data, ctx) => {
  if (!data.financialPlan) {
    ctx.addIssue({ code: 'custom', path: ['financialPlan'], message: 'Plano financeiro obrigatório' })
  }
  if (data.diagramPoints.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['diagramPoints'], message: 'Marque ao menos um ponto no diagrama' })
  }
})

// ─── Execution form schemas (step 5) ────────────────────────────────
// NOTE: mirrors the real payload — no performedAt (server sets it).

export const procedureExecutionFormSchema = z.object({
  technique: z.string().max(5000).optional().default(''),
  clinicalResponse: z.string().max(5000).optional().default(''),
  adverseEffects: z.string().max(5000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000).optional().default(''),
  diagramPoints: z.array(diagramPointSchema).default([]),
  productApplications: z.array(productApplicationItemSchema).default([]),
})
export type ProcedureExecutionFormData = z.infer<typeof procedureExecutionFormSchema>
```

- [ ] **Step 2: Write schema tests**

Create `web/src/validations/__tests__/procedure-forms.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  procedurePlanningFormSchema,
  procedurePlanningFinalSchema,
  procedureExecutionFormSchema,
} from '../procedure'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('procedurePlanningFormSchema (draft)', () => {
  it('accepts a minimal draft with just a valid procedureTypeId', () => {
    expect(procedurePlanningFormSchema.safeParse({ procedureTypeId: VALID_UUID }).success).toBe(true)
  })

  it('rejects a missing procedureTypeId', () => {
    expect(procedurePlanningFormSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a technique longer than 5000 chars', () => {
    const r = procedurePlanningFormSchema.safeParse({ procedureTypeId: VALID_UUID, technique: 'x'.repeat(5001) })
    expect(r.success).toBe(false)
  })
})

describe('procedurePlanningFinalSchema (strict)', () => {
  it('rejects when financialPlan is missing', () => {
    expect(procedurePlanningFinalSchema.safeParse({ procedureTypeId: VALID_UUID }).success).toBe(false)
  })

  it('rejects when diagramPoints is empty', () => {
    expect(
      procedurePlanningFinalSchema.safeParse({
        procedureTypeId: VALID_UUID,
        financialPlan: { totalAmount: 100, installmentCount: 1 },
        diagramPoints: [],
      }).success,
    ).toBe(false)
  })

  it('accepts a complete final payload', () => {
    expect(
      procedurePlanningFinalSchema.safeParse({
        procedureTypeId: VALID_UUID,
        financialPlan: { totalAmount: 100, installmentCount: 1 },
        diagramPoints: [{ x: 50, y: 50, productName: 'Botox', quantity: 10, quantityUnit: 'U' }],
      }).success,
    ).toBe(true)
  })
})

describe('procedureExecutionFormSchema', () => {
  it('accepts an empty draft (all fields optional)', () => {
    expect(procedureExecutionFormSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a product application with an empty productName', () => {
    expect(
      procedureExecutionFormSchema.safeParse({
        productApplications: [{ productName: '', totalQuantity: 10, quantityUnit: 'U' }],
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test procedure-forms` → Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck` → Expected: PASS.

---

### Task B2: `buildEvaluationResponseSchema` helper + tests

**Files:**
- Create: `web/src/lib/validations/build-evaluation-schema.ts`
- Create: `web/src/lib/validations/__tests__/build-evaluation-schema.test.ts`

- [ ] **Step 1: Find the template type**

Grep for `EvaluationTemplateForForm` to find its definition and use its fields (likely `{ id, procedureTypeId, procedureTypeName, version, sections: [{ id, title, fields: [{ id, type, label, required }] }] }`).

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { buildEvaluationResponseSchema } from '../build-evaluation-schema'

const fixture = [
  {
    id: 'template-1',
    procedureTypeId: 'type-1',
    procedureTypeName: 'Botox',
    version: 1,
    sections: [
      {
        id: 'section-a',
        title: 'Avaliação',
        fields: [
          { id: 'field-notes', type: 'text', label: 'Notas', required: true },
          { id: 'field-score', type: 'number', label: 'Score', required: false },
        ],
      },
    ],
  },
]

describe('buildEvaluationResponseSchema', () => {
  it('accepts a valid response', () => {
    const schema = buildEvaluationResponseSchema(fixture as never)
    expect(schema.safeParse({ 'template-1': { 'field-notes': 'ok', 'field-score': 5 } }).success).toBe(true)
  })

  it('rejects when a required text field is empty', () => {
    const schema = buildEvaluationResponseSchema(fixture as never)
    expect(schema.safeParse({ 'template-1': { 'field-notes': '', 'field-score': 5 } }).success).toBe(false)
  })

  it('allows optional fields to be missing', () => {
    const schema = buildEvaluationResponseSchema(fixture as never)
    expect(schema.safeParse({ 'template-1': { 'field-notes': 'ok' } }).success).toBe(true)
  })

  it('returns a permissive schema for empty templates list', () => {
    expect(buildEvaluationResponseSchema([] as never).safeParse({}).success).toBe(true)
  })
})
```

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'

type Field = { id: string; type: string; required?: boolean }
type Section = { id: string; fields: Field[] }
type Template = { id: string; sections: Section[] }

function fieldSchema(type: string, required: boolean): z.ZodTypeAny {
  switch (type) {
    case 'text':
    case 'choice':
      return required ? z.string().min(1, 'Campo obrigatório') : z.string().optional()
    case 'number':
      return required ? z.number() : z.number().optional()
    case 'boolean':
      return required ? z.boolean() : z.boolean().optional()
    case 'multi-choice':
      return required ? z.array(z.string()).min(1, 'Campo obrigatório') : z.array(z.string()).optional()
    default:
      return z.unknown()
  }
}

export function buildEvaluationResponseSchema(
  templates: Template[],
): z.ZodType<Record<string, Record<string, unknown>>> {
  if (templates.length === 0) {
    return z.record(z.string(), z.record(z.string(), z.unknown()))
  }

  const templateShapes: Record<string, z.ZodTypeAny> = {}
  for (const template of templates) {
    const fieldShapes: Record<string, z.ZodTypeAny> = {}
    for (const section of template.sections) {
      for (const field of section.fields) {
        fieldShapes[field.id] = fieldSchema(field.type, field.required ?? false)
      }
    }
    templateShapes[template.id] = z.object(fieldShapes)
  }

  return z.object(templateShapes) as z.ZodType<Record<string, Record<string, unknown>>>
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @floraclin/web test build-evaluation-schema` → Expected: PASS.

---

### Task B3: `formatRelativeSaveTime` helper + tests

**Files:**
- Create: `web/src/lib/relative-time.ts`
- Create: `web/src/lib/__tests__/relative-time.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeSaveTime } from '../relative-time'

describe('formatRelativeSaveTime', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('returns "Salvo agora" when saved < 1 minute ago', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:40Z'), now)).toBe('Salvo agora')
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
  it('clamps negative differences to "Salvo agora"', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T12:00:10Z'), now)).toBe('Salvo agora')
  })
})
```

- [ ] **Step 2: Implement**

```ts
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

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test relative-time` → Expected: PASS.

---

### Task B4: `<SaveStatusIndicator>` + tests

**Files:**
- Create: `web/src/components/service-wizard/save-status-indicator.tsx`
- Create: `web/src/components/service-wizard/__tests__/save-status-indicator.test.tsx`

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaveStatusIndicator } from '../save-status-indicator'

describe('SaveStatusIndicator', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('renders nothing when empty', () => {
    const { container } = render(
      <SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={null} errorType={null} now={now} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows "Salvando..." when saving (highest priority)', () => {
    render(<SaveStatusIndicator isSaving={true} isDirty={true} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType="server" now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvando...')
  })

  it('shows "Erro ao salvar" for errorType server', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={null} errorType="server" now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Erro ao salvar')
  })

  it('shows "Alterações não salvas" when dirty', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={null} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Alterações não salvas')
  })

  it('shows "Salvo há 2min" for saved 2 min ago', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo há 2min')
  })

  it('shows "Salvo agora" for saved <1 min ago', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={new Date('2026-04-14T11:59:40Z')} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo agora')
  })

  it('dirty wins over saved', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType={null} now={now} />)
    const el = screen.getByTestId('save-status-indicator')
    expect(el).toHaveTextContent('Alterações não salvas')
    expect(el).not.toHaveTextContent('Salvo há')
  })
})
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { formatRelativeSaveTime } from '@/lib/relative-time'

export interface SaveStatusIndicatorProps {
  isSaving: boolean
  isDirty: boolean
  lastSavedAt: Date | null
  errorType: 'validation' | 'precondition' | 'server' | null
  now: Date
}

export function SaveStatusIndicator({ isSaving, isDirty, lastSavedAt, errorType, now }: SaveStatusIndicatorProps) {
  if (isSaving) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-mid">
        <Loader2 className="size-3 animate-spin text-mid" />
        <span>Salvando...</span>
      </div>
    )
  }
  if (errorType === 'server') {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-red-600">
        <AlertCircle className="size-3" />
        <span>Erro ao salvar</span>
      </div>
    )
  }
  if (isDirty) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-amber-700">
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        <span>Alterações não salvas</span>
      </div>
    )
  }
  if (lastSavedAt) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-sage">
        <Check className="size-3" />
        <span>{formatRelativeSaveTime(lastSavedAt, now)}</span>
      </div>
    )
  }
  return null
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test save-status-indicator` → Expected: PASS.

---

### Task B5: `<FormServerErrorBanner>` + tests

**Files:**
- Create: `web/src/components/forms/form-server-error-banner.tsx`
- Create: `web/src/components/forms/__tests__/form-server-error-banner.test.tsx`

**Important:** Tests must NOT call `form.setError()` synchronously during render. Use `useEffect`.

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { FormServerErrorBanner } from '../form-server-error-banner'

function Host({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const form = useForm()
  useEffect(() => {
    if (message) form.setError('root.serverError', { message })
  }, [form, message])
  return <FormServerErrorBanner form={form} onRetry={onRetry} />
}

describe('FormServerErrorBanner', () => {
  it('renders nothing when no server error is set', () => {
    const { container } = render(<Host />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the error message when set', async () => {
    render(<Host message="Erro de servidor" />)
    expect(await screen.findByText('Erro de servidor')).toBeInTheDocument()
  })

  it('calls onRetry when the retry button is clicked', async () => {
    const onRetry = vi.fn()
    render(<Host message="Erro" onRetry={onRetry} />)
    await userEvent.click(await screen.findByRole('button', { name: /Tentar novamente/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import { AlertCircle } from 'lucide-react'
import type { UseFormReturn, FieldValues } from 'react-hook-form'

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>
  onRetry?: () => void
}

export function FormServerErrorBanner<T extends FieldValues>({ form, onRetry }: Props<T>) {
  const root = (form.formState.errors as Record<string, { serverError?: { message?: string } }>).root
  const serverError = root?.serverError?.message
  if (!serverError) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">Erro ao salvar</p>
        <p className="text-red-700">{serverError}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-sm font-medium text-red-800 underline hover:text-red-900">
          Tentar novamente
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run tests** → PASS.

---

### Task B6: `<FormValidationSummary>` + tests

**Files:**
- Create: `web/src/components/forms/form-validation-summary.tsx`
- Create: `web/src/components/forms/__tests__/form-validation-summary.test.tsx`

- [ ] **Step 1: Test (use `useEffect` for setError)**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { FormValidationSummary } from '../form-validation-summary'

function Host({ errorCount = 0 }: { errorCount?: number }) {
  const form = useForm()
  useEffect(() => {
    for (let i = 0; i < errorCount; i++) {
      form.setError(`field${i}`, { message: `Error ${i}` })
    }
  }, [form, errorCount])
  return <FormValidationSummary form={form} />
}

function HostRootOnly() {
  const form = useForm()
  useEffect(() => {
    form.setError('root.serverError', { message: 'Server error' })
  }, [form])
  return <FormValidationSummary form={form} />
}

describe('FormValidationSummary', () => {
  it('renders nothing when no errors', () => {
    const { container } = render(<Host />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the summary banner when errors exist', async () => {
    render(<Host errorCount={2} />)
    expect(await screen.findByText(/Corrija os campos destacados/i)).toBeInTheDocument()
  })

  it('ignores root.serverError', () => {
    const { container } = render(<HostRootOnly />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import type { UseFormReturn, FieldValues } from 'react-hook-form'

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>
}

export function FormValidationSummary<T extends FieldValues>({ form }: Props<T>) {
  const errors = form.formState.errors as Record<string, unknown>
  const fieldErrorKeys = Object.keys(errors).filter((k) => {
    if (k === 'root') {
      const rootVal = errors.root as Record<string, unknown> | undefined
      const rootKeys = Object.keys(rootVal ?? {})
      return rootKeys.some((rk) => rk !== 'serverError')
    }
    return true
  })
  if (fieldErrorKeys.length === 0) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">Corrija os campos destacados antes de continuar</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run tests** → PASS.

---

### Task B7: `<FormFieldError>` + tests

**Files:**
- Create: `web/src/components/forms/form-field-error.tsx`
- Create: `web/src/components/forms/__tests__/form-field-error.test.tsx`

- [ ] **Step 1: Test (useEffect for setError)**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { FormFieldError } from '../form-field-error'

function Host({ path, message }: { path?: string; message?: string }) {
  const form = useForm()
  useEffect(() => {
    if (path && message) form.setError(path, { message })
  }, [form, path, message])
  return <FormFieldError form={form} name={path ?? 'missing'} />
}

describe('FormFieldError', () => {
  it('renders nothing when no error at the path', () => {
    const { container } = render(<Host />)
    expect(container.firstChild).toBeNull()
  })

  it('renders error message when error exists', async () => {
    render(<Host path="technique" message="Campo obrigatório" />)
    expect(await screen.findByText('Campo obrigatório')).toBeInTheDocument()
  })

  it('supports nested dot-paths', async () => {
    render(<Host path="financialPlan.totalAmount" message="Valor inválido" />)
    expect(await screen.findByText('Valor inválido')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import type { UseFormReturn, FieldValues } from 'react-hook-form'

function getNestedError(errors: Record<string, unknown>, path: string): { message?: string } | null {
  const parts = path.split('.')
  let current: unknown = errors
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  if (!current || typeof current !== 'object') return null
  if ('message' in current && typeof (current as { message?: string }).message === 'string') {
    return current as { message?: string }
  }
  return null
}

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>
  name: string
}

export function FormFieldError<T extends FieldValues>({ form, name }: Props<T>) {
  const error = getNestedError(form.formState.errors as Record<string, unknown>, name)
  if (!error?.message) return null
  return <p className="mt-1 text-xs text-red-600">{error.message}</p>
}
```

- [ ] **Step 3: Run tests** → PASS.

---

## Group C — Form migrations

### Task C1: procedure-form.tsx RHF migration

**Files:**
- Modify: `web/src/components/procedures/procedure-form.tsx`
- Create: `web/src/components/procedures/planning/financial-plan-field.tsx`
- Create: `web/src/components/procedures/planning/procedure-types-section.tsx`
- Create: `web/src/components/procedures/planning/planning-details-section.tsx`
- Create: `web/src/components/procedures/planning/evaluation-templates-section.tsx`
- Create: `web/src/components/procedures/planning/diagram-section.tsx`
- Create: `web/src/components/procedures/planning/consent-section.tsx`

**Constraint:** The characterization test at `web/src/components/procedures/__tests__/procedure-form.characterization.test.tsx` must PASS with ZERO diff before AND after migration.

**Context to load before starting:**
- Read `web/src/components/procedures/procedure-form.tsx` in full (chunk by chunk — ~1800 lines)
- Read `web/src/components/face-diagram/face-diagram-editor.tsx`
- Read `web/src/components/evaluation/template-renderer.tsx`
- Read `web/src/hooks/mutations/use-procedure-mutations.ts` — `useCreateProcedure` + `useUpdateProcedure`

- [ ] **Step 1:** Verify characterization test passes pre-migration. Run: `pnpm --filter @floraclin/web test procedure-form.characterization`. PASS.

- [ ] **Step 2:** Install `useForm` alongside existing state:

```tsx
import { useForm, Controller, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  procedurePlanningFormSchema,
  procedurePlanningFinalSchema,
  type ProcedurePlanningFormData,
} from '@/validations/procedure'
import { buildEvaluationResponseSchema } from '@/lib/validations/build-evaluation-schema'
import { FormServerErrorBanner } from '@/components/forms/form-server-error-banner'
import { FormValidationSummary } from '@/components/forms/form-validation-summary'
import { FormFieldError } from '@/components/forms/form-field-error'
```

Inside the component body (after props destructure):

```tsx
const form = useForm<ProcedurePlanningFormData>({
  resolver: zodResolver(procedurePlanningFormSchema),
  defaultValues: {
    procedureTypeId: procedure?.procedureTypeId ?? (initialTypeIds?.[0] ?? ''),
    additionalTypeIds: (() => {
      const existing = (procedure as unknown as Record<string, unknown> | null)?.additionalTypeIds
      if (Array.isArray(existing)) return existing as string[]
      if (initialTypeIds && initialTypeIds.length > 1) return initialTypeIds.slice(1)
      return []
    })(),
    technique: procedure?.technique ?? '',
    clinicalResponse: procedure?.clinicalResponse ?? '',
    adverseEffects: procedure?.adverseEffects ?? '',
    notes: procedure?.notes ?? '',
    followUpDate: procedure?.followUpDate ?? '',
    nextSessionObjectives: procedure?.nextSessionObjectives ?? '',
    financialPlan: /* reuse the existing derivation logic for initial financialPlan */ undefined,
    diagramPoints: /* reuse existing derivation from existingDiagrams */ [],
    evaluationResponses: (existingEvaluationResponses ?? []).reduce((acc, r) => ({ ...acc, [r.templateId]: r.responses as Record<string, unknown> }), {}),
    consentAccepted: /* derive from consentStatus if already accepted, else false */ false,
  },
})
```

- [ ] **Step 3:** Re-run characterization test (form is shadow-tracking, behavior unchanged). PASS.

- [ ] **Step 4:** Migrate fields one at a time. After each migration, re-run the characterization test.

| Order | Field | Migration pattern |
|---|---|---|
| 1 | `technique` | `<Textarea {...form.register('technique')} />` + delete `useState` |
| 2 | `clinicalResponse` | `<Textarea {...form.register('clinicalResponse')} />` |
| 3 | `adverseEffects` | `<Textarea {...form.register('adverseEffects')} />` |
| 4 | `notes` | `<Textarea {...form.register('notes')} />` |
| 5 | `nextSessionObjectives` | `<Textarea {...form.register('nextSessionObjectives')} />` |
| 6 | `followUpDate` | `<Controller control={form.control} name="followUpDate" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />` |
| 7 | `consentAccepted` | `<Controller ... name="consentAccepted" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />` |
| 8 | `procedureTypeId` + `additionalTypeIds` | Controller-wrapped inside `ProcedureTypesSection` subcomponent (Step 5) |
| 9 | `financialPlan` | Controller-wrapped inside `FinancialPlanField` subcomponent |
| 10 | `diagramPoints` | `<Controller ... name="diagramPoints" render={({ field }) => <FaceDiagramEditor points={field.value} onChange={field.onChange} previousPoints={previousPoints} gender={patientGender} products={catalogProducts} />} />` |
| 11 | `evaluationResponses` | `<Controller ... name="evaluationResponses" render={({ field }) => <TemplateRenderer responses={field.value} onChange={field.onChange} templates={evalTemplates} />} />` |

- [ ] **Step 5:** Extract subcomponents. Each file under `web/src/components/procedures/planning/`:

**a. `financial-plan-field.tsx`** — full implementation required:

```tsx
'use client'

import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FormFieldError } from '@/components/forms/form-field-error'
import type { ProcedurePlanningFormData } from '@/validations/procedure'

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  disabled?: boolean
}

export function FinancialPlanField({ control, form, disabled }: Props) {
  return (
    <Controller
      control={control}
      name="financialPlan"
      render={({ field }) => {
        const value = field.value ?? { totalAmount: 0, installmentCount: 1, paymentMethod: undefined, notes: '' }
        const update = (patch: Partial<typeof value>) => field.onChange({ ...value, ...patch })
        return (
          <div className="space-y-4">
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">Valor total</Label>
              <Input
                type="number"
                step="0.01"
                value={value.totalAmount || ''}
                onChange={(e) => update({ totalAmount: parseFloat(e.target.value) || 0 })}
                disabled={disabled}
                placeholder="0.00"
              />
              <FormFieldError form={form} name="financialPlan.totalAmount" />
            </div>
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">Parcelas</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={value.installmentCount}
                onChange={(e) => update({ installmentCount: parseInt(e.target.value, 10) || 1 })}
                disabled={disabled}
              />
              <FormFieldError form={form} name="financialPlan.installmentCount" />
            </div>
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">Método de pagamento</Label>
              <Select
                value={value.paymentMethod ?? ''}
                onValueChange={(v) => update({ paymentMethod: v as typeof value.paymentMethod })}
                disabled={disabled}
              >
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                  <SelectItem value="debit_card">Cartão de débito</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">Observações do plano</Label>
              <Textarea
                value={value.notes ?? ''}
                onChange={(e) => update({ notes: e.target.value })}
                maxLength={1000}
                disabled={disabled}
              />
              <FormFieldError form={form} name="financialPlan.notes" />
            </div>
          </div>
        )
      }}
    />
  )
}
```

**b. `procedure-types-section.tsx`** — Controller-wrapped procedure type picker. Props: `{ control, form, procedureTypes: ProcedureType[], disabled? }`. Renders the existing primary type dropdown + additional-types chips, reading and writing through `form.control`.

**c. `planning-details-section.tsx`** — Props: `{ form, disabled? }`. Renders the five textareas with section headers, each `{...form.register(fieldName)}` + `<FormFieldError form={form} name={fieldName} />`.

**d. `evaluation-templates-section.tsx`** — Props: `{ control, form, templates: EvaluationTemplateForForm[], isLoading: boolean }`. Renders a Controller around TemplateRenderer that binds to `evaluationResponses`.

**e. `diagram-section.tsx`** — Props: `{ control, form, previousPoints, gender, products, showComparison? }`. Renders a Controller around FaceDiagramEditor with the existing comparison toggle.

**f. `consent-section.tsx`** — Props: `{ control, form, consentTemplate, consentStatus, onViewFullTemplate }`. Renders the consent checkbox via Controller + the consent template preview link + async status display.

Each subcomponent MUST:
- Have a typed `Props` interface (no `any`)
- Import `FormFieldError` and render it under each controlled field
- Not own its own form instance — always receive `control` and `form` via props

- [ ] **Step 6:** Replace submit handler. Delete `handleSubmit` / `isSubmitting` / `submitError` state. Replace with:

```tsx
const [submittingAction, setSubmittingAction] = useState(false)

async function onValid(values: ProcedurePlanningFormData) {
  setSubmittingAction(true)
  try {
    const validationMode = wizardOverrides?.validationMode ?? 'draft'
    if (validationMode === 'final') {
      // Block final-mode validation if evaluation templates are still loading
      if (loadingEvaluationTemplates) {
        form.setError('root.serverError' as never, {
          type: 'manual',
          message: 'Aguarde o carregamento dos templates de avaliação',
        })
        wizardOverrides?.onSaveComplete?.({ success: false, error: 'Templates loading', errorType: 'precondition' })
        return
      }

      const finalSchema = procedurePlanningFinalSchema.and(
        z.object({ evaluationResponses: buildEvaluationResponseSchema((evalTemplates ?? []) as never) }),
      )
      const finalResult = finalSchema.safeParse(values)
      if (!finalResult.success) {
        for (const issue of finalResult.error.issues) {
          form.setError(issue.path.join('.') as never, { type: 'manual', message: issue.message })
        }
        wizardOverrides?.onSaveComplete?.({ success: false, error: 'Validation failed', errorType: 'validation' })
        return
      }
    }

    // Build the wire-format payload (mirror the existing payload construction,
    // including isPlanningMode field stripping if still applicable)
    const diagramsPayload = values.diagramPoints.length > 0
      ? [{ viewType: 'front' as const, points: values.diagramPoints }]
      : undefined

    const payload: Record<string, unknown> = {
      patientId,
      procedureTypeId: values.procedureTypeId,
      additionalTypeIds: values.additionalTypeIds.length > 0 ? values.additionalTypeIds : undefined,
      // Planning mode still strips these — preserves characterization test invariants
      technique: isPlanningMode ? undefined : (values.technique || undefined),
      clinicalResponse: isPlanningMode ? undefined : (values.clinicalResponse || undefined),
      adverseEffects: isPlanningMode ? undefined : (values.adverseEffects || undefined),
      notes: isPlanningMode ? undefined : (values.notes || undefined),
      followUpDate: isPlanningMode ? undefined : (values.followUpDate || undefined),
      nextSessionObjectives: isPlanningMode ? undefined : (values.nextSessionObjectives || undefined),
      diagrams: diagramsPayload,
      financialPlan: values.financialPlan,
    }

    let result
    if (isEdit && procedure?.id) {
      result = await updateProcedureMutation.mutateAsync({ id: procedure.id, ...payload })
    } else {
      result = await createProcedureMutation.mutateAsync(payload)
    }

    const createdId = (result?.data as { id: string } | undefined)?.id ?? procedure?.id

    // Save evaluation responses (reuse existing logic)
    if (createdId && evalTemplates && evalTemplates.length > 0) {
      const responsePromises = evalTemplates
        .filter((t) => {
          const resp = (values.evaluationResponses as Record<string, unknown>)[t.id]
          return resp && Object.keys(resp as object).length > 0
        })
        .map((t) =>
          saveEvalResponse.mutateAsync({
            procedureRecordId: createdId,
            templateId: t.id,
            responses: (values.evaluationResponses as Record<string, unknown>)[t.id] as never,
          }),
        )
      if (responsePromises.length > 0) {
        await Promise.all(responsePromises)
      }
    }

    // Reset form to flip isDirty false
    form.reset(values)
    wizardOverrides?.onSaveComplete?.({ success: true, procedureId: createdId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao salvar procedimento'
    form.setError('root.serverError' as never, { type: 'manual', message })
    wizardOverrides?.onSaveComplete?.({ success: false, error: message, errorType: 'server' })
  } finally {
    setSubmittingAction(false)
  }
}

function onInvalid() {
  wizardOverrides?.onSaveComplete?.({ success: false, error: 'Validation failed', errorType: 'validation' })
}
```

Wire `triggerSave`:

```tsx
const prevTriggerSaveRef = useRef(wizardOverrides?.triggerSave ?? 0)
useEffect(() => {
  const current = wizardOverrides?.triggerSave ?? 0
  if (current === 0 || current === prevTriggerSaveRef.current) return
  prevTriggerSaveRef.current = current
  form.handleSubmit(onValid, onInvalid)()
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [wizardOverrides?.triggerSave])
```

- [ ] **Step 7:** Wire dirty-state propagation:

```tsx
useEffect(() => {
  wizardOverrides?.onDirtyChange?.(form.formState.isDirty)
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.formState.isDirty])
```

- [ ] **Step 8:** Wire error display at the top of the render:

```tsx
<FormServerErrorBanner form={form} onRetry={() => form.handleSubmit(onValid, onInvalid)()} />
<FormValidationSummary form={form} />
```

Every controlled field renders `<FormFieldError form={form} name="..." />` underneath.

- [ ] **Step 9:** Delete all `submitError` state + inline validation throughout the file.

- [ ] **Step 10:** Re-run characterization test — **must** PASS with ZERO diff. Run: `pnpm --filter @floraclin/web test procedure-form.characterization`.

- [ ] **Step 11:** Typecheck + lint:

```
pnpm --filter @floraclin/web typecheck
pnpm --filter @floraclin/web lint
```

- [ ] **Step 12:** Verify file size:

Run: `wc -l web/src/components/procedures/procedure-form.tsx` → Expected: ≤ 900 lines.

---

### Task C2: procedure-approval.tsx explicit dirty tracking + decomposition (NOT RHF)

**Files:**
- Modify: `web/src/components/procedures/procedure-approval.tsx`
- Create: `web/src/components/procedures/approval/approval-summary-card.tsx`
- Create: `web/src/components/procedures/approval/consent-status-list.tsx`
- Create: `web/src/components/procedures/approval/service-contract-section.tsx`

**Rationale:** `procedure-approval.tsx` is a gate validator, not a form. The approve mutation takes only `procedure.id`. The contract-signing flow uses a separate `acceptConsent` mutation. RHF adds ceremony without value here.

**Approach:** Add explicit `hasUnsavedChanges` state that flips true on user interactions (contract checkbox, signature pad draw) and false on successful `handleSignContract` or `handleApprove`. Propagate via `wizardOverrides.onDirtyChange`.

- [ ] **Step 1:** Verify characterization test passes. Run: `pnpm --filter @floraclin/web test procedure-approval.characterization`. PASS.

- [ ] **Step 2:** Add state:

```tsx
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

const markDirty = useCallback(() => setHasUnsavedChanges(true), [])
const markClean = useCallback(() => setHasUnsavedChanges(false), [])
```

Propagate to wizard:

```tsx
useEffect(() => {
  wizardOverrides?.onDirtyChange?.(hasUnsavedChanges)
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [hasUnsavedChanges])
```

- [ ] **Step 3:** Wrap user-interaction callbacks with `markDirty`:

```tsx
// Contract checkbox (around line 749):
onCheckedChange={(val) => {
  setContractChecked(val === true)
  markDirty()
}}

// Signature pad (around line 766):
<SignaturePad
  onSignatureChange={(data) => {
    setContractSignature(data)
    if (data) markDirty()
  }}
  disabled={contractSigning}
/>
```

- [ ] **Step 4:** Mark clean after successful mutations:

In `handleSignContract` success path:
```tsx
setContractSigned(true)
markClean() // contract has been persisted
```

In the `triggerSave` effect's success path for `approveProcedure`:
```tsx
setApproved(true)
markClean()
wizardOverrides?.onSaveComplete?.({ success: true, procedureId: procedure.id })
```

- [ ] **Step 5:** Extract subcomponents under `web/src/components/procedures/approval/`:

**a. `approval-summary-card.tsx`** — Read-only display of procedure type, additional types, diagram points summary (via `productTotals`), and financial plan. Props: `{ procedure, procedureTypes, diagramPoints, productTotals, financialPlan }`. ~150 lines extracted from the existing header/summary region.

**b. `consent-status-list.tsx`** — Renders the list of required consent types with their signed/unsigned status and "Assinar" buttons for unsigned ones. Props: `{ consentStatuses, onSignConsent }`. Owns the small UI for each consent row.

**c. `service-contract-section.tsx`** — The contract text viewer, "I agree" checkbox, signature pad, and "Sign" button. Props: `{ contractTemplate, contractText, contractChecked, onCheckedChange, contractSignature, onSignatureChange, contractSigned, contractSigning, contractError, onSignContract }`. ~200 lines extracted.

- [ ] **Step 6:** Run characterization test — PASS.

- [ ] **Step 7:** Typecheck + lint.

- [ ] **Step 8:** Verify file size:

Run: `wc -l web/src/components/procedures/procedure-approval.tsx` → Expected: ≤ 500 lines.

---

### Task C3: procedure-execution.tsx RHF migration

**Files:**
- Modify: `web/src/components/procedures/procedure-execution.tsx`
- Create: `web/src/components/procedures/execution/product-application-row.tsx`
- Create: `web/src/components/procedures/execution/product-applications-section.tsx`
- Create: `web/src/components/procedures/execution/execution-details-section.tsx`
- Create: `web/src/components/procedures/execution/execution-photo-section.tsx`

**Constraint:** Characterization test must PASS with zero diff before and after.

- [ ] **Step 1:** Verify characterization test passes pre-migration.

- [ ] **Step 2:** Install `useForm`:

```tsx
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  procedureExecutionFormSchema,
  type ProcedureExecutionFormData,
} from '@/validations/procedure'
import { FormServerErrorBanner } from '@/components/forms/form-server-error-banner'
import { FormValidationSummary } from '@/components/forms/form-validation-summary'
import { FormFieldError } from '@/components/forms/form-field-error'
```

```tsx
const form = useForm<ProcedureExecutionFormData>({
  resolver: zodResolver(procedureExecutionFormSchema),
  defaultValues: {
    technique: procedure.technique ?? '',
    clinicalResponse: procedure.clinicalResponse ?? '',
    adverseEffects: procedure.adverseEffects ?? '',
    notes: procedure.notes ?? '',
    followUpDate: procedure.followUpDate ?? '',
    nextSessionObjectives: procedure.nextSessionObjectives ?? '',
    diagramPoints: /* existing derivation from diagrams */ [],
    productApplications: (existingApplications ?? []).map((a) => ({
      productName: a.productName,
      activeIngredient: a.activeIngredient ?? undefined,
      totalQuantity: parseFloat(a.totalQuantity),
      quantityUnit: a.quantityUnit as 'U' | 'mL',
      batchNumber: a.batchNumber ?? undefined,
      expirationDate: a.expirationDate ?? undefined,
      labelPhotoId: a.labelPhotoId ?? undefined,
      applicationAreas: a.applicationAreas ?? undefined,
      notes: a.notes ?? undefined,
    })),
  },
})

const productsFieldArray = useFieldArray({ control: form.control, name: 'productApplications' })
```

- [ ] **Step 3:** Field migration table:

| Field | Pattern |
|---|---|
| `technique`, `clinicalResponse`, `adverseEffects`, `notes`, `nextSessionObjectives` | `{...form.register(...)}` |
| `followUpDate` | `<Controller>` around DatePicker |
| `diagramPoints` | `<Controller>` around FaceDiagramEditor |
| `productApplications` (array) | `productsFieldArray.fields.map(...)` rendering `<ProductApplicationRow index={i} form={form} control={form.control} onRemove={() => productsFieldArray.remove(i)} />` |

- [ ] **Step 4:** Extract subcomponents:

**a. `product-application-row.tsx`** — single row. Props: `{ control, form, index, onRemove, disabled? }`. Renders Input fields via `form.register(\`productApplications.${index}.fieldName\`)`, Controller-wrapped DatePicker for `expirationDate`, and Controller for the product-photo picker. Each field with `<FormFieldError form={form} name="productApplications.${index}.fieldName" />`.

**b. `product-applications-section.tsx`** — Props: `{ form, fieldArray }`. Renders the list iteration + "Adicionar produto" button via `fieldArray.append({ productName: '', totalQuantity: 0, quantityUnit: 'U' })`.

**c. `execution-details-section.tsx`** — Props: `{ form, disabled? }`. Groups the post-execution textareas.

**d. `execution-photo-section.tsx`** — NOT RHF-tracked. Keeps the existing `photoRefreshKey` useState + photo upload components as-is. Props: `{ procedureId, photoRefreshKey, onRefresh }`.

- [ ] **Step 5:** Replace submit handler:

```tsx
const [submittingAction, setSubmittingAction] = useState(false)

async function onValid(values: ProcedureExecutionFormData) {
  if (isReadOnly) {
    wizardOverrides?.onSaveComplete?.({ success: false, error: 'Formulário indisponível', errorType: 'precondition' })
    return
  }
  setSubmittingAction(true)
  try {
    const diagramsPayload = values.diagramPoints.length > 0
      ? [{ viewType: 'front' as const, points: values.diagramPoints }]
      : undefined

    await executeProcedure.mutateAsync({
      id: procedure.id,
      technique: values.technique || undefined,
      clinicalResponse: values.clinicalResponse || undefined,
      adverseEffects: values.adverseEffects || undefined,
      notes: values.notes || undefined,
      followUpDate: values.followUpDate || undefined,
      nextSessionObjectives: values.nextSessionObjectives || undefined,
      diagrams: diagramsPayload,
      productApplications: values.productApplications.length > 0 ? values.productApplications : undefined,
    })

    form.reset(values)
    wizardOverrides?.onSaveComplete?.({ success: true, procedureId: procedure.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar execução'
    form.setError('root.serverError' as never, { type: 'manual', message })
    wizardOverrides?.onSaveComplete?.({ success: false, error: message, errorType: 'server' })
  } finally {
    setSubmittingAction(false)
  }
}

function onInvalid() {
  wizardOverrides?.onSaveComplete?.({ success: false, error: 'Validation failed', errorType: 'validation' })
}
```

Wire `triggerSave` same as C1 Step 6.

- [ ] **Step 6:** Wire dirty-state propagation (same pattern as C1 Step 7).

- [ ] **Step 7:** Wire error display (FormServerErrorBanner + FormValidationSummary + per-field FormFieldError).

- [ ] **Step 8:** Delete `submitError` state + inline validation.

- [ ] **Step 9:** Re-run characterization test — PASS with zero diff.

- [ ] **Step 10:** Typecheck + lint.

- [ ] **Step 11:** Verify file size ≤ 600 lines.

---

## Group D — Wizard integration

### Task D1: service-wizard.tsx — indicator + Salvar e sair

**Files:**
- Modify: `web/src/components/service-wizard/service-wizard.tsx`

Follows the original prior-cook plan's C1 verbatim — see the superseded spec. Key elements:

1. Add imports: `useMemo`, `SaveStatusIndicator`, `WizardOverrides`
2. Add `stepDirty` state + `useMemo`'d stable `dirtyHandlers[1..5]`
3. Add `pendingActionRef`
4. Add `now` state + 30-second `setInterval`
5. Update `getOverridesForStep` to pass `onDirtyChange`, `onAutoSaved` (only for step 1), `validationMode: 'final'` when `state.currentStep === 3 && pendingActionRef.current === 'advance'`
6. Update `handleStepComplete` to read `pendingActionRef`, branch on `pending === 'exit'` → route to patient detail + toast instead of `nextStep()`
7. Add `handleSaveAndExit` (sets ref, calls `triggerSave`)
8. Add `showSaveAndExit = state.currentStep === 1 || state.currentStep === 3`
9. Render `<SaveStatusIndicator>` in the nav bar middle slot between Voltar and action group
10. Render the "Salvar e sair" button with `md:order-2`, update Próximo to `md:order-3`

- [ ] Execute all 10 sub-steps (full code templates in the superseded cook plan at `docs/plans/2026-04-14-wizard-save-indicator-and-exit-cook.md` Task C1 Steps 1-10 — reference them but update class names / props to match the revised `WizardOverrides`).

- [ ] Run: `pnpm --filter @floraclin/web typecheck && pnpm --filter @floraclin/web lint && pnpm --filter @floraclin/web test` → PASS.

---

### Task D2: anamnesis-form.tsx wiring

**Files:**
- Modify: `web/src/components/anamnesis/anamnesis-form.tsx`

- [ ] **Step 1:** Add `hasUnsavedChanges` state (RHF `formState.isDirty` is permanently true after first edit because the form never calls `reset()`):

```tsx
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
const wizardOverridesRef = useRef(wizardOverrides)
wizardOverridesRef.current = wizardOverrides
```

**Use a ref — do NOT add `wizardOverrides` to any useCallback dep array.** The wizard passes a fresh overrides object every render, so putting it in deps breaks auto-save debouncing.

- [ ] **Step 2:** Update `saveForm` success branch:

```tsx
if (result?.updatedAt) {
  const savedAt = new Date(result.updatedAt)
  expectedUpdatedAtRef.current = savedAt.toISOString()
  setLastSaved(savedAt)
  setLastSavedBy(null)
  setHasUnsavedChanges(false)
  wizardOverridesRef.current?.onAutoSaved?.(savedAt)
}
```

- [ ] **Step 3:** Mark dirty inside the watch effect:

```tsx
const subscription = watch(() => {
  setHasUnsavedChanges(true)
  debouncedSave()
})
```

- [ ] **Step 4:** Propagate via ref:

```tsx
useEffect(() => {
  wizardOverridesRef.current?.onDirtyChange?.(hasUnsavedChanges)
}, [hasUnsavedChanges])
```

- [ ] **Step 5:** Typecheck → PASS. Manual test: type in anamnesis, verify auto-save still fires after 1s, verify indicator transitions work.

---

### Task D3: atendimento/loading.tsx skeleton

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/atendimento/loading.tsx`

- [ ] **Step 1:** Replace the `<nav>` block:

```tsx
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

- [ ] **Step 2:** Typecheck → PASS.

---

## Group E — Manual smoke test

### Task E1: Full wizard walkthrough

Dev server: http://localhost:3000

- [ ] 1. Patient → Atendimento → step 1 (Anamnese) — type in main complaint, observe indicator: empty → dirty → saving → saved
- [ ] 2. Click "Salvar e sair" → toast "Atendimento salvo. Retome quando quiser." → returns to patient detail
- [ ] 3. Re-enter → step 1 data preserved, indicator shows "Salvo há Xmin"
- [ ] 4. Advance through step 2 (pick 2 types) → step 3 (Planejamento)
- [ ] 5. Fill every textarea, click a face diagram point, fill one evaluation response, set financial plan, check consent → indicator flips to dirty
- [ ] 6. Click "Salvar e sair" → saves → returns → data preserved
- [ ] 7. Re-enter → Próximo on step 3 → attempt with empty financial plan (clear total) → field-level error under financial plan + top validation summary banner + first-error scroll
- [ ] 8. Fix, advance → step 4 (Aprovação)
- [ ] 9. Indicator empty; check contract → dirty; sign → still dirty; click "Assinar Contrato" → contract saves → indicator back to clean; click approve → advances
- [ ] 10. Step 5 (Execução) → fill performedAt (wait: no performedAt field — fill technique + add 1 product application row) → click Finalizar → toast "Atendimento finalizado"
- [ ] 11. Mobile breakpoint (<md): indicator hidden, buttons stack, layout intact
- [ ] 12. Simulate server error (disconnect network, click Próximo on step 3) → indicator shows "Erro ao salvar" + top banner with retry button

---

## Pre-merge checks

- [ ] `pnpm --filter @floraclin/web typecheck` — PASS
- [ ] `pnpm --filter @floraclin/web lint` — PASS
- [ ] `pnpm --filter @floraclin/web test` — PASS
- [ ] All 3 characterization tests pass with zero diff pre- and post-migration
- [ ] File size targets: procedure-form ≤ 900, procedure-approval ≤ 500, procedure-execution ≤ 600
- [ ] Manual smoke test checklist above completed
- [ ] **Await user approval before committing**
