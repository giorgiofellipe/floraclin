# Procedure Lifecycle Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the procedure system from a single-event model to a two-phase lifecycle (Evaluation → Execution) with plan tracking, consent/contract signing at approval, and planned-vs-executed quantity comparison.

**Architecture:** Modify existing procedure_records table, split the procedure form into 3 modes (planning, approval, execution), add service contract template support, rename Settings tab to "Contratos e Termos".

**Design Document:** `docs/plans/2026-03-29-procedure-lifecycle-redesign.md`

---

## Status Lifecycle

```
planned → approved → executed
                  ↘ cancelled
planned → cancelled
```

- `planned` — evaluation done, face diagram + financial plan created
- `approved` — patient signed consent terms + service contract, financial entry created
- `executed` — practitioner updated real quantities, added batch/lots, notes, photos
- `cancelled` — cancelled at any point with reason

---

## Task 1: Schema Changes

**Files:**
- Modify: `src/db/schema.ts`
- Run: `npx drizzle-kit generate`

**Step 1: Update `procedure_records` table**

Change the status CHECK constraint:
```typescript
status: varchar('status', { length: 20 }).notNull().default('planned')
  .check(status IN ('planned', 'approved', 'executed', 'cancelled')),
```

Add new columns:
```typescript
plannedSnapshot: jsonb('planned_snapshot'), // frozen diagram points + quantities at approval
approvedAt: timestamp('approved_at', { withTimezone: true }),
cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
cancellationReason: text('cancellation_reason'),
financialPlan: jsonb('financial_plan'), // {totalAmount, installmentCount, paymentMethod, notes}
```

**Step 2: Update `consent_templates` type CHECK**

Add `'service_contract'` to the allowed types:
```typescript
type: varchar('type', { length: 30 }).notNull()
  .check(type IN ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract')),
```

**Step 3: Update TypeScript types**

In `src/types/index.ts`:
```typescript
export type ProcedureStatus = 'planned' | 'approved' | 'executed' | 'cancelled'
export type ConsentType = 'general' | 'botox' | 'filler' | 'biostimulator' | 'custom' | 'service_contract'
```

**Step 4: Generate migration**
```bash
DOTENV_CONFIG_PATH=.env.local npx drizzle-kit generate
```

**Step 5: Data migration**

Create a manual migration SQL file `src/db/migrations/manual/0002_procedure_status_migration.sql`:
```sql
-- Map old statuses to new
UPDATE floraclin.procedure_records SET status = 'executed' WHERE status = 'completed';
UPDATE floraclin.procedure_records SET status = 'planned' WHERE status = 'in_progress';
-- 'cancelled' stays as 'cancelled'
```

**Verification:** Schema generates without errors. Types compile.

**Commit:** `feat: schema changes for procedure lifecycle - new statuses, planned snapshot, financial plan, service contract type`

---

## Task 2: Update Queries and Actions

**Files:**
- Modify: `src/db/queries/procedures.ts`
- Modify: `src/actions/procedures.ts`
- Modify: `src/validations/procedure.ts`

**Step 1: Update validation schemas**

```typescript
// New status enum
export const procedureStatusSchema = z.enum(['planned', 'approved', 'executed', 'cancelled'])

// Financial plan schema (stored as JSONB during planning, before real financial entry)
export const financialPlanSchema = z.object({
  totalAmount: z.number().positive(),
  installmentCount: z.number().int().min(1).max(12),
  paymentMethod: z.enum(['pix', 'credit_card', 'debit_card', 'cash', 'transfer']).optional(),
  notes: z.string().optional(),
})

// Update createProcedureSchema to include financialPlan
// Remove requirement for technique, clinicalResponse, etc. — those come at execution
```

**Step 2: Update queries**

- `createProcedure` — defaults status to `'planned'`, accepts `financialPlan` JSONB
- `approveProcedure(tenantId, procedureId, plannedSnapshot)` — NEW: sets status to `'approved'`, stores `plannedSnapshot`, sets `approvedAt`
- `executeProcedure(tenantId, procedureId, data)` — NEW: sets status to `'executed'`, sets `performedAt`, updates diagram/products/notes
- `cancelProcedure(tenantId, procedureId, reason)` — NEW: sets status to `'cancelled'`, sets `cancelledAt` and `cancellationReason`
- `getProcedure` — include new fields in select
- `listProcedures` — order by status priority (planned first, then approved, then executed)

**Step 3: Update actions**

- `createProcedureAction` — accepts financial plan, no longer requires consent or photos
- `approveProcedureAction(procedureId)` — NEW:
  1. Verify all required consents are signed
  2. Verify service contract is signed
  3. Snapshot current diagram points as `plannedSnapshot`
  4. Create financial entry from `financialPlan` (using `createFinancialEntry`)
  5. Set status to `'approved'`
  6. Audit log
- `executeProcedureAction(procedureId, data)` — NEW:
  1. Verify status is `'approved'`
  2. Update diagram points (new quantities)
  3. Save product applications (batch/lot numbers)
  4. Save clinical notes, technique, adverse effects
  5. Set status to `'executed'`, set `performedAt`
  6. Audit log
- `cancelProcedureAction(procedureId, reason)` — NEW:
  1. Verify status is `'planned'` or `'approved'`
  2. If `'approved'`, cancel associated financial entry
  3. Set status to `'cancelled'`
  4. Audit log

**Verification:** All actions enforce status transitions correctly. Can't execute a planned procedure. Can't approve an executed one.

**Commit:** `feat: procedure queries and actions for lifecycle - plan, approve, execute, cancel`

---

## Task 3: Service Contract Template Engine

**Files:**
- Create: `src/lib/contract-interpolation.ts`
- Modify: `src/components/consent/consent-template-form.tsx` (add placeholder docs for service_contract type)
- Modify: `src/validations/consent.ts` (add service_contract to DEFAULT_CONSENT_TEMPLATES)
- Modify: `src/lib/constants.ts` (add service_contract to relevant lists)

**Step 1: Create interpolation engine**

`src/lib/contract-interpolation.ts`:
```typescript
interface ContractData {
  nomePaciente: string
  cpfPaciente: string
  data: string
  procedimentos: string
  produtos: string
  valorTotal: string
  formaPagamento: string
  parcelas: string
  profissional: string
  clinica: string
}

export function interpolateContract(template: string, data: ContractData): string {
  return template
    .replace(/\{\{nome_paciente\}\}/g, data.nomePaciente)
    .replace(/\{\{cpf_paciente\}\}/g, data.cpfPaciente)
    .replace(/\{\{data\}\}/g, data.data)
    .replace(/\{\{procedimentos\}\}/g, data.procedimentos)
    .replace(/\{\{produtos\}\}/g, data.produtos)
    .replace(/\{\{valor_total\}\}/g, data.valorTotal)
    .replace(/\{\{forma_pagamento\}\}/g, data.formaPagamento)
    .replace(/\{\{parcelas\}\}/g, data.parcelas)
    .replace(/\{\{profissional\}\}/g, data.profissional)
    .replace(/\{\{clinica\}\}/g, data.clinica)
}

export function buildContractData(plan: ProcedurePlan, patient: Patient, practitioner: string, clinicName: string): ContractData {
  // Build all values from the plan data
}
```

**Step 2: Add default service contract template**

Add to `DEFAULT_CONSENT_TEMPLATES` in `src/validations/consent.ts`:
```typescript
service_contract: {
  title: 'Contrato de Prestação de Serviços Estéticos',
  content: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento, {{nome_paciente}}, CPF {{cpf_paciente}}, declara que...

Procedimentos contratados: {{procedimentos}}
Produtos a serem utilizados: {{produtos}}

Valor total: {{valor_total}}
Forma de pagamento: {{forma_pagamento}}
{{parcelas}}

Profissional responsável: {{profissional}}
Clínica: {{clinica}}

Data: {{data}}

[Assinatura do paciente]
[Assinatura do profissional]`
}
```

**Step 3: Update consent template form**

When type is `service_contract`, show a help section listing available placeholders with descriptions.

**Step 4: Update constants**

Add `'service_contract'` to consent type labels:
```typescript
service_contract: 'Contrato de Serviço'
```

**Step 5: Seed during onboarding**

Add service contract to default templates created during onboarding.

**Verification:** Can create service contract template with placeholders. Interpolation produces correct output.

**Commit:** `feat: service contract template engine with placeholder interpolation`

---

## Task 4: Rename "Termos" to "Contratos e Termos"

**Files:**
- Modify: `src/app/(platform)/configuracoes/settings-page-client.tsx` — tab label
- Modify: `src/components/patients/patient-tabs.tsx` — tab label "Termos" → "Contratos e Termos" (or just "Documentos")
- Modify: `src/i18n/messages/pt-BR.json` — update labels
- Modify: any hardcoded "Termos" references in components

**Step 1: Search and update all "Termos" labels**

Settings tab: "Termos" → "Contratos e Termos"
Patient tab: "Termos" → "Contratos e Termos"
Consent type labels: add "Contrato de Serviço"

**Verification:** All UI labels updated. No broken references.

**Commit:** `feat: rename Termos to Contratos e Termos across UI`

---

## Task 5: Refactor Procedure Form — Planning Mode

**Files:**
- Modify: `src/components/procedures/procedure-form.tsx`
- Modify: `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/page.tsx`

**Step 1: Planning mode (status: planned)**

The procedure form in planning mode shows ONLY:
1. Procedure type checkboxes (multi-select, same as now)
2. Face diagram editor (plan injection points, products, quantities)
3. **NEW: Financial plan section** — inline form with:
   - Total amount (currency masked input)
   - Installment count (1-12 select)
   - Payment method (select)
   - Notes (textarea, optional)
4. Save button → creates procedure with status `'planned'`

**Remove from planning mode:**
- Consent section (moves to approval)
- Pre/post photo upload (moves to execution)
- Batch/lot numbers (moves to execution)
- Clinical notes, technique, adverse effects (moves to execution)
- Follow-up scheduling (moves to execution)

**Step 2: Financial plan section component**

Create inline financial plan fields within the procedure form:
```tsx
<div>
  <Label>Valor total</Label>
  <MaskedInput mask={maskCurrency} ... />

  <Label>Parcelas</Label>
  <Select> 1x to 12x </Select>

  <Label>Forma de pagamento</Label>
  <Select> pix, credit, debit, cash, transfer </Select>

  <Label>Observações</Label>
  <Textarea />
</div>
```

This is stored as `financialPlan` JSONB on the procedure record. NOT as a real financial entry yet — that happens at approval.

**Verification:** Can create a planned procedure with diagram + financial plan. No consent shown. No photos.

**Commit:** `feat: procedure form planning mode - diagram + financial plan, no consent/photos`

---

## Task 6: Approval Flow

**Files:**
- Create: `src/components/procedures/procedure-approval.tsx`
- Modify: `src/components/procedures/procedure-list.tsx` (add "Aprovar" action)
- Modify: `src/actions/procedures.ts` (approveProcedureAction)

**Step 1: Procedure approval component**

`ProcedureApproval` is a full-page or dialog component that shows:

1. **Plan summary** (read-only):
   - Procedure types
   - Face diagram (read-only mode) with product totals
   - Financial summary (total, installments, payment method)

2. **Consent signing section**:
   - Lists all required consent types based on procedure categories
   - Each shows signed/pending status
   - Pending ones have inline ConsentViewer for signing

3. **Service contract section**:
   - Loads active `service_contract` template
   - Interpolates with plan data (procedures, products, quantities, prices, patient info)
   - Shows rendered contract for review
   - Checkbox + signature pad for signing

4. **Approve button** (enabled only when all consents + contract are signed):
   - Calls `approveProcedureAction`
   - Snapshots diagram points as `plannedSnapshot`
   - Creates real financial entry from `financialPlan`
   - Sets status to `'approved'`

**Step 2: Add approval action to procedure list**

In the procedure card/list, when status is `'planned'`:
- Show "Aprovar" button → navigates to approval flow
- Show "Cancelar" button → cancels with reason

When status is `'approved'`:
- Show "Executar" button → navigates to execution flow
- Show "Cancelar" button

**Verification:** Full approval flow works end-to-end. Can't approve without all signatures. Financial entry is created.

**Commit:** `feat: procedure approval flow - consent signing, service contract, financial entry creation`

---

## Task 7: Execution Flow

**Files:**
- Create: `src/components/procedures/procedure-execution.tsx`
- Modify: `src/actions/procedures.ts` (executeProcedureAction)

**Step 1: Execution component**

`ProcedureExecution` shows:

1. **Diagram editor** (editable):
   - Pre-loaded with current (planned) points
   - Practitioner can adjust quantities, add/remove points
   - "Ver planejamento original" toggle shows ghost overlay of planned values
   - The planned values are preserved in `plannedSnapshot` (already saved at approval)

2. **Product details** (batch/lot numbers):
   - For each product used, add batch number, expiration date
   - "Adicionar lote" for multiple batches (same as current)

3. **Clinical notes**:
   - Technique
   - Clinical response
   - Adverse effects
   - General notes

4. **Photos**:
   - Pre-procedure photos (defaultStage: 'pre')
   - Post-procedure photos (defaultStage: 'immediate_post')

5. **Save as executed** button:
   - Calls `executeProcedureAction`
   - Sets status to `'executed'`, `performedAt` to now
   - Follow-up date + next session objectives (optional)

**Step 2: Plan comparison**

When viewing an executed procedure, show a summary:
- "Planejado: 20U Botox → Executado: 24U Botox" for each product where quantities differ
- This is computed by comparing `plannedSnapshot` with the current diagram points

**Verification:** Can execute an approved procedure. Quantities are editable. Planned snapshot is preserved. Comparison shows differences.

**Commit:** `feat: procedure execution flow - update quantities, batch numbers, notes, photos`

---

## Task 8: Procedure List & Card Updates

**Files:**
- Modify: `src/components/procedures/procedure-list.tsx`
- Modify: `src/components/procedures/procedure-card.tsx`
- Modify: `src/components/patients/patient-procedures-tab.tsx`

**Step 1: Status badges with brand colors**

```
planned  → bg-[#FFF4EF] text-amber, label "Planejado"
approved → bg-[#F0F7F1] text-sage, label "Aprovado"
executed → bg-[#F0F7F1] text-sage, label "Executado" (darker)
cancelled → bg-[#F4F6F8] text-mid, label "Cancelado"
```

**Step 2: Action buttons per status**

| Status | Actions |
|---|---|
| planned | "Aprovar", "Editar", "Cancelar" |
| approved | "Registrar Execução", "Cancelar" |
| executed | "Ver Detalhes" (read-only) |
| cancelled | "Ver Detalhes" (read-only) |

**Step 3: Procedure card content by status**

- `planned`: shows procedure types, diagram totals, financial plan summary
- `approved`: same + "Aprovado em [date]" + signed docs count
- `executed`: shows final quantities, performed_at date, photos thumbnail, plan diff summary
- `cancelled`: shows cancellation reason and date

**Verification:** All statuses render correctly with appropriate badges and actions.

**Commit:** `feat: procedure list and cards with lifecycle status badges and actions`

---

## Task 9: Integration & Polish

**Files:**
- Modify: `src/components/patients/patient-procedures-tab.tsx` — route to correct flow based on status
- Modify: `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/page.tsx` — handle all modes
- Modify: `src/components/dashboard/today-appointments.tsx` — show procedure status context
- Modify: `src/lib/constants.ts` — update status colors and labels

**Step 1: Procedure page routing**

The procedure page at `/pacientes/[id]/procedimentos/[procedureId]` renders different components based on status:
- `novo` → ProcedureForm (planning mode)
- `planned` → ProcedureForm (edit planning) OR ProcedureApproval (if `?action=approve`)
- `approved` → ProcedureExecution (if `?action=execute`) OR read-only summary
- `executed` → read-only view with plan comparison
- `cancelled` → read-only view with cancellation info

**Step 2: Update status color constants**

```typescript
export const PROCEDURE_STATUS_COLORS = {
  planned: 'bg-[#FFF4EF] text-amber',
  approved: 'bg-[#F0F7F1] text-sage',
  executed: 'bg-[#F0F7F1] text-[#2A2A2A]',
  cancelled: 'bg-[#F4F6F8] text-mid',
}

export const PROCEDURE_STATUS_LABELS = {
  planned: 'Planejado',
  approved: 'Aprovado',
  executed: 'Executado',
  cancelled: 'Cancelado',
}
```

**Step 3: Update onboarding**

Seed default service contract template during onboarding.

**Verification:** Full lifecycle works end-to-end: create plan → approve with signatures → execute with real data → view with comparison.

**Commit:** `feat: procedure lifecycle integration - routing, status colors, onboarding seed`

---

## Dependency Graph

```
Task 1: Schema Changes (must be first)
  ↓
Task 2: Queries & Actions (depends on 1)
  ↓
Tasks 3, 4, 5 can run IN PARALLEL:
  Task 3: Service Contract Engine
  Task 4: Rename Termos
  Task 5: Procedure Form Planning Mode
  ↓
Task 6: Approval Flow (depends on 2, 3, 5)
  ↓
Task 7: Execution Flow (depends on 2, 5)
  ↓
Task 8: List & Card Updates (depends on 2)
  ↓
Task 9: Integration (depends on all)
```

---

## Post-Implementation Checklist

- [ ] Can create a planned procedure with diagram + financial plan
- [ ] Planning mode has NO consent, photos, or batch numbers
- [ ] Can approve a planned procedure (consent signing + contract signing)
- [ ] Service contract interpolates placeholders correctly
- [ ] Financial entry is created at approval (not at planning)
- [ ] Planned snapshot is frozen at approval
- [ ] Can execute an approved procedure (update quantities, add lots, notes, photos)
- [ ] Plan vs executed comparison shows differences
- [ ] "Ver planejamento original" toggle works
- [ ] Can cancel at any status with reason
- [ ] Status badges render correctly
- [ ] Action buttons match status
- [ ] Settings tab shows "Contratos e Termos"
- [ ] Service contract template type available in settings
- [ ] Default service contract seeded during onboarding
- [ ] Old procedures migrated (completed → executed, in_progress → planned)
