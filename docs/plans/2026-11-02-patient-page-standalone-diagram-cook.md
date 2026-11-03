# Patient Page Redesign and Standalone Face Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clinics create face diagrams and quotations without an atendimento, continue a quotation inside the wizard, approve without signatures (collect later), and replace the 10-tab patient page with a Resumo overview plus grouped navigation.

**Architecture:** A new `face_diagram_groups` table becomes the owner of every diagram (one group = all views of one diagram). Groups belong to a patient and optionally link to a procedure record (planning group) or a session (session group). Diagram status is derived from the linked procedure. Quotation PDFs are stored snapshots in `face_diagram_quotes`. The patient page becomes header + section navigation (side menu on desktop, bottom bar on phones) + section content, with the existing tab components reused unchanged.

**Tech Stack:** Next.js (App Router, project-specific version: read `node_modules/next/dist/docs/` before writing routes), Drizzle ORM on Postgres (`floraclin` schema), React Query, base-ui components in `src/components/ui`, Tailwind v4 tokens in `src/app/globals.css`, Vitest + Testing Library, puppeteer PDF via `src/lib/pdf.ts`.

**Spec:** `docs/superpowers/specs/2026-11-02-patient-page-and-standalone-diagram-design.md`

All paths below are relative to `web/` unless they start with `docs/`.

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages. Avoid en dashes in prose.
- UI copy is pt-BR. Chat/plan language is irrelevant to copy.
- Dates: follow `AGENTS.md`. `appointments.date` and `installments.due_date` are BR calendar days; use `brToday()`, `startOfBrDay`, `parseBrDate`, `toBrYmd` from `@/lib/dates`. Never `new Date('YYYY-MM-DD')` bare.
- Every query filters by `tenant_id`. Soft-deleted rows (`deleted_at`) are excluded.
- Migrations are hand-written SQL in `src/db/migrations/`, idempotent (`IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object`), fully qualified `"floraclin"."table"`, statements separated by `--> statement-breakpoint`, header comment says when to apply. New tables get `ENABLE ROW LEVEL SECURITY`. No drizzle-kit generate.
- No backward compatibility layers. Remove obsolete code paths and dead functions you replace.
- Comments: default none. Only for non-obvious external constraints or deliberate choices that look like mistakes.
- Before writing or changing any test, load the `test-audit` skill and pass its authoring gate. Every test names the regression it catches.
- base-ui composition uses the `render={<.../>}` prop, not `asChild`. `Sheet` exists (no `Drawer`).
- Card style: `rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]`. Colors: `forest`, `sage`, `mint`, `cream`, `charcoal`, `mid`, `amber-*`.
- Write permission for diagrams and quotes: `requireWrite('owner', 'practitioner')`. Reads: `getAuthContext()` (any role).
- Implementation agents do not commit. The orchestrator commits once per group.
- Only touch the files listed in your task. If you must touch another file, stop and report.

## Review Focus

1. A standalone quotation whose atendimento is later cancelled must show "Orçamento" again and reappear in the CRM list; a wizard-made diagram whose procedure is cancelled must not appear in the CRM list. (Tests in Task 2 and Task 12.)
2. Diagrams created before the migration must still appear in procedure detail, approval, prontuário, evolution point counts and the ghost overlay after migration. (Tests in Task 8, migration check in Task 1.)
3. Patient without in-app WhatsApp or with an invalid phone: the WhatsApp button falls back to WhatsApp Web or hides, never errors. (Test in Task 5.)
4. Old deep links (`?tab=procedimentos`, `?tab=timeline`) and role-hidden sections (`?tab=evolucoes` for receptionist) resolve to a valid section. (Tests in Task 4, grep step in Task 18.)
5. Approving with unsigned terms stores the required set and an audit row; signing later removes the item from the pending list. (Tests in Task 9 and Task 15.)

---

## File Structure

New:
- `src/db/migrations/0048_face_diagram_groups.sql` (pre-deploy, additive + backfill)
- `src/db/migrations/0049_face_diagram_groups_finalize.sql` (post-deploy: re-backfill, constraints, drop old columns)
- `src/lib/face-diagram-status.ts` (status derivation + labels)
- `src/validations/face-diagram-group.ts` (quotation line + group payload schemas)
- `src/lib/diagram-quote.ts` (quote total, cart from quote)
- `src/lib/consent-requirements.ts` (required/pending consent types)
- `src/db/queries/face-diagram-groups.ts` (group CRUD, listing, linking)
- `src/db/queries/face-diagram-quotes.ts`
- `src/components/face-diagram/diagram-pdf.tsx` (shared PDF diagram rendering)
- `src/components/face-diagram/quote-pdf.tsx`
- `src/app/api/patients/[id]/face-diagram-groups/route.ts`
- `src/app/api/face-diagram-groups/[id]/route.ts`
- `src/app/api/face-diagram-groups/[id]/quotes/route.ts`
- `src/app/api/face-diagram-groups/[id]/snooze/route.ts`
- `src/app/api/face-diagram-groups/[id]/followups/route.ts`
- `src/app/api/face-diagram-quotes/[id]/send-whatsapp/route.ts`
- `src/app/api/patients/[id]/appointments/route.ts`
- `src/app/api/patients/[id]/financial-summary/route.ts`
- `src/app/api/consent/pending/[patientId]/route.ts`
- `src/hooks/queries/use-face-diagram-groups.ts`, `src/hooks/mutations/use-face-diagram-group-mutations.ts`
- `src/hooks/queries/use-patient-overview.ts`
- `src/components/patients/patient-sections.ts`, `patient-section-nav.tsx`, `patient-header.tsx`, `patient-summary.tsx`, `patient-agenda-section.tsx`, `patient-diagrams-section.tsx`, `pending-consents-list.tsx`
- `src/components/face-diagram-groups/diagram-group-editor.tsx`, `quotation-lines-editor.tsx`, `quote-history.tsx`
- `src/app/(platform)/pacientes/[id]/diagramas/novo/page.tsx`, `src/app/(platform)/pacientes/[id]/diagramas/[groupId]/page.tsx` (+ client components next to them)

Deleted: `src/components/patients/patient-tabs.tsx`, `listDiagramsForRecord`, POST in `src/app/api/face-diagrams/route.ts` and `useSaveFaceDiagram` (no consumers).

---

## Group A (parallel, no dependencies)

### Task 1: Schema and migrations

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0048_face_diagram_groups.sql`, `src/db/migrations/0049_face_diagram_groups_finalize.sql`

**Interfaces:**
- Produces (Drizzle exports): `faceDiagramGroups`, `faceDiagramQuotes`, updated `faceDiagrams` (has `groupId`, no `procedureRecordId`, no `procedureSessionId`), `procedureRecords.requiredConsentTypes`, updated `procedureFollowups` (`procedureRecordId` nullable, new `faceDiagramGroupId`), relations for both new tables.

Final schema (what `schema.ts` describes, i.e. after 0049):

`face_diagram_groups`:
| column | type |
|---|---|
| id | uuid pk default random |
| tenant_id | uuid not null → tenants |
| patient_id | uuid not null → patients |
| practitioner_id | uuid not null → users (author) |
| procedure_record_id | uuid null → procedure_records |
| procedure_session_id | uuid null → procedure_sessions ON DELETE CASCADE |
| origin | varchar(20) not null default 'standalone', CHECK in ('standalone','wizard') |
| quotation_lines | jsonb null (array of `QuotationLine`, Task 2) |
| declined_at | timestamptz null |
| followup_snoozed_until | date null |
| last_contacted_at | timestamptz null |
| created_at, updated_at | timestamptz not null default now() |
| deleted_at | timestamptz null |

Indexes: `idx_face_diagram_groups_patient (tenant_id, patient_id)`; unique `uq_face_diagram_groups_planning (procedure_record_id) WHERE procedure_session_id IS NULL AND procedure_record_id IS NOT NULL AND deleted_at IS NULL`; unique `uq_face_diagram_groups_session (procedure_session_id) WHERE procedure_session_id IS NOT NULL`.

`face_diagram_quotes`: id, tenant_id, patient_id → patients, group_id → face_diagram_groups ON DELETE CASCADE, storage_path text not null, lines jsonb not null, total decimal(12,2) not null, created_by → users not null, whatsapp_status varchar(10) null CHECK in ('queued','sent'), whatsapp_requested_at timestamptz null, whatsapp_message_id varchar(255) null, created_at. Index `(tenant_id, group_id)`. (`queued` = handed to the WhatsApp queue outside the 24h window; the UI shows it as "Enviado para a fila do WhatsApp". Delivery tracking of queued messages is out of scope.)

`face_diagrams`: add `group_id uuid not null → face_diagram_groups ON DELETE CASCADE`; drop `procedure_record_id`, `procedure_session_id`, drop `uq_face_diagrams_session_view`; index `idx_face_diagrams_group (group_id)`. No unique index on `(group_id, view_type)`: legacy planning rows were never unique at DB level and may contain duplicates. Writers serialize instead (Task 8 locks the group row before upserting a view).

`procedure_records`: add `required_consent_types jsonb null`.

`procedure_followups`: `procedure_record_id` nullable; add `face_diagram_group_id uuid null → face_diagram_groups ON DELETE CASCADE`; CHECK `num_nonnulls(procedure_record_id, face_diagram_group_id) = 1`; index `(face_diagram_group_id, contacted_at)`.

Migration split (production runs 0048 before deploy; 0049 after the deploy is live and old instances have drained, at least one hour later, by hand). From this PR on, application code never reads or writes `face_diagrams.procedure_record_id` / `procedure_session_id`; 0049 only re-backfills rows that old instances wrote and drops the columns.
- 0048: create both tables + indexes + RLS; `face_diagrams.group_id` added NULLABLE; `face_diagrams.procedure_record_id` DROP NOT NULL; `procedure_records.required_consent_types`; `procedure_followups` changes. Backfill (below). Every statement that references the legacy columns runs inside a `DO $$` block guarded by an `information_schema.columns` check, so re-running 0048 after 0049 is a no-op.
- 0049: wrap the backfill in a `DO $$` block that only runs while `face_diagrams.procedure_record_id` still exists (check `information_schema.columns`), so a second run after the columns are dropped is a no-op. It runs the same backfill again (rows written by old code between 0048 and deploy), then `group_id SET NOT NULL`, drop `uq_face_diagrams_session_view`, drop columns `procedure_record_id` and `procedure_session_id` from `face_diagrams`.

Backfill (idempotent, both files, guarded as above):
1. Planning groups: for every `procedure_records pr` that has `face_diagrams fd` with `fd.procedure_session_id IS NULL AND fd.group_id IS NULL`, insert one group (`patient_id = pr.patient_id`, `practitioner_id = pr.practitioner_id`, `procedure_record_id = pr.id`, `origin = 'wizard'`, `created_at = min(fd.created_at)`) WHERE NOT EXISTS a planning group for `pr.id`. Then `UPDATE face_diagrams SET group_id = g.id` matching `g.procedure_record_id = fd.procedure_record_id AND g.procedure_session_id IS NULL AND fd.procedure_session_id IS NULL AND fd.group_id IS NULL`.
2. Session groups: same keyed on `procedure_session_id`, with `procedure_record_id` from the session's record. A procedure can have session groups and no planning group (planning diagrams are optional); that is valid and the UI handles it (Task 16).
Use `0015_package_atendimento_redesign.sql` lines 85-150 as the style template.

- [ ] **Step 1:** Update `src/db/schema.ts` tables and relations as above (remove `faceDiagramsRelations.procedureRecord`, add `group`; add `faceDiagramGroupsRelations` with `patient`, `practitioner`, `procedureRecord`, `procedureSession`, `diagrams: many`, `quotes: many`; `procedureRecordsRelations` replaces `faceDiagrams: many` with `faceDiagramGroups: many`).
- [ ] **Step 2:** Write `0048_face_diagram_groups.sql` and `0049_face_diagram_groups_finalize.sql`.
- [ ] **Step 3: Verify migration on local Docker Postgres (never Supabase).** Run `pnpm --filter @floraclin/web test:db:up` (or `docker compose -f docker-compose.test.yml up -d`), apply the migrations up to and including `0047_*` in filename order with `psql` (stop before 0048), insert one tenant/patient/user/procedure with two planning `face_diagrams` rows (front, left_profile) and one session row, then apply 0048, insert one more planning row for the same procedure with `view_type = 'right_profile'` (simulating old code), apply 0049. Expected: exactly 2 groups (1 planning group holding the 3 planning rows, 1 session group holding the session row), every `face_diagrams.group_id` non-null, and running 0048 and then 0049 a second time succeeds with no new groups and no errors. Also add a second procedure that has only a session row (no planning row) before 0048 and check it gets exactly 1 session group. Record the commands used in the task report. If the full migration chain does not apply on a fresh DB, report it and verify 0048/0049 against a DB built from `schema.ts` before this change instead.
- [ ] **Step 4:** `pnpm --filter @floraclin/web typecheck` is expected to FAIL only in files owned by Task 8 (callers of removed columns). List them in the report; do not fix them.

### Task 2: Quotation types, status derivation, cart from quote

**Files:**
- Create: `src/validations/face-diagram-group.ts`, `src/lib/face-diagram-status.ts`, `src/lib/diagram-quote.ts`
- Test: `src/lib/__tests__/face-diagram-status.test.ts`, `src/lib/__tests__/diagram-quote.test.ts`

**Interfaces (Produces):**
```ts
// validations/face-diagram-group.ts
export const quotationLineSchema: z.ZodObject<{ procedureTypeId: uuid; procedureTypeName: string(min 1); sessions: int 1..50; unitPrice: number >= 0 with at most 2 decimals (refine: Math.round(v*100) === v*100 within 1e-9) }>
export const quotationLinesSchema // z.array(quotationLineSchema) refined: no duplicate procedureTypeId (message 'Procedimento repetido no orçamento'); the encounter cart rejects duplicates too
export type QuotationLine = z.infer<typeof quotationLineSchema>
export const diagramViewSchema // { viewType: 'front'|'left_profile'|'right_profile', points: diagramPointSchema[] } reuse the point schema from validations/procedure.ts
export const createDiagramGroupSchema // { views: diagramViewSchema[] (min 1, unique viewType), quotationLines: quotationLinesSchema (default []) }
export const updateDiagramGroupSchema // same shape as create
export type DiagramGroupOrigin = 'standalone' | 'wizard'

// lib/face-diagram-status.ts
export type DiagramGroupStatus = 'quote' | 'in_service' | 'applied' | 'cancelled' | 'declined'
export const DIAGRAM_STATUS_LABELS: Record<DiagramGroupStatus, string> // quote 'Orçamento', in_service 'Em atendimento', applied 'Aplicado', cancelled 'Cancelado', declined 'Recusado'
export function deriveDiagramStatus(input: { isSessionGroup: boolean; procedureStatus: ProcedureStatus | null; declinedAt: Date | string | null }): DiagramGroupStatus

// lib/diagram-quote.ts
export function quoteTotal(lines: QuotationLine[]): number // Σ unitPrice*sessions computed in integer cents, returned in reais
export function buildCartFromQuote(lines: QuotationLine[]): EncounterCart // template fields null, totalOverride null, line.defaultPrice = unitPrice, sourceTemplateLineId null
```
Derivation rules, in order: `declinedAt` → `declined`; `isSessionGroup` → `applied`; no procedure → `quote`; `cancelled` → `cancelled`; `completed` → `applied`; any other status → `in_service`. A standalone group goes back to `quote` because cancelling releases it (its `procedure_record_id` becomes null, Task 8), not because of a status special case. `origin` stays on the row only to decide what cancellation releases.

- [ ] **Step 1: Write failing tests.**
  - `deriveDiagramStatus`: `procedureStatus: null` → `quote`; `'cancelled'` → `cancelled`; `'draft'` / `'planned'` / `'approved'` / `'in_progress'` → `in_service`; `'completed'` → `applied`; `isSessionGroup: true` → `applied`; `declinedAt` set with `procedureStatus: null` → `declined`.
  - `quotationLinesSchema` rejects two lines with the same `procedureTypeId` and rejects `unitPrice: 10.005` (regression: a saved quote must always be usable as a wizard cart).
  - `quoteTotal([{unitPrice: 1200, sessions: 1}, {unitPrice: 333.33, sessions: 3}])` → `2199.99`; `quoteTotal([{unitPrice: 0.1, sessions: 3}])` → `0.3` exactly; `quoteTotal([])` → `0`.
  - `buildCartFromQuote` returns a cart that passes `encounterCartSchema.parse` and whose `computeCartTotal` equals `quoteTotal` of the same lines (regression: custom values must survive into the wizard total).
- [ ] **Step 2:** Run `pnpm --filter @floraclin/web exec vitest run src/lib/__tests__/face-diagram-status.test.ts src/lib/__tests__/diagram-quote.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Re-run. Expected: PASS.

### Task 3: Consent requirements

**Files:**
- Create: `src/lib/consent-requirements.ts`
- Test: `src/lib/__tests__/consent-requirements.test.ts`

**Interfaces (Produces):**
```ts
export const CATEGORY_TO_CONSENT: Record<string, string> // move verbatim from components/procedures/procedure-approval.tsx:43-50
export function requiredConsentTypes(input: { categories: string[]; hasActiveContractTemplate: boolean }): string[] // always 'general', plus mapped categories (deduped, order: general, mapped in input order, then 'service_contract' when hasActiveContractTemplate)
export function pendingConsentTypes(required: string[], signed: string[]): string[] // required minus signed, keeps required order
```
- [ ] **Step 1: Failing tests:** `requiredConsentTypes({categories: ['botox','toxina_botulinica','skincare'], hasActiveContractTemplate: true})` → `['general','botox','service_contract']`; with no categories and no template → `['general']`; `pendingConsentTypes(['general','botox'], ['botox'])` → `['general']`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.
(Task 13 switches `procedure-approval.tsx` to import from here.)

### Task 4: Patient sections config and navigation

**Files:**
- Create: `src/components/patients/patient-sections.ts`, `src/components/patients/patient-section-nav.tsx`
- Test: `src/components/patients/__tests__/patient-sections.test.ts`, `src/components/patients/__tests__/patient-section-nav.test.tsx`

**Interfaces (Produces):**
```ts
export type PatientSectionKey = 'resumo'|'atendimentos'|'diagramas'|'evolucoes'|'fotos'|'anamnese'|'agenda'|'financeiro'|'pacotes'|'termos'|'documentos'|'dados'|'historico'
export type PatientSectionGroup = 'clinico'|'administrativo'|'documentos'|'paciente'
export const PATIENT_SECTION_GROUPS: { key: PatientSectionGroup; label: string }[] // 'Clínico','Administrativo','Documentos','Paciente'
export const PATIENT_SECTIONS: { key: PatientSectionKey; label: string; group: PatientSectionGroup | null; icon: LucideIcon; requiredRoles?: Role[] }[]
export function visibleSections(role: Role): typeof PATIENT_SECTIONS
export function resolveSection(param: string | null | undefined, role: Role): PatientSectionKey // invalid, missing, or role-hidden → 'resumo'
export const MOBILE_NAV_ENTRIES: { key: 'resumo'|'clinico'|'administrativo'|'outros'; label: string; groups: PatientSectionGroup[] }[] // outros = documentos + paciente
export function PatientSectionNav(props: { active: PatientSectionKey; role: Role; onChange: (key: PatientSectionKey) => void }): JSX.Element
```
Sections, labels and groups exactly as in the spec: Resumo; Clínico: Atendimentos, Diagramas faciais, Evoluções (`owner`,`practitioner` only), Fotos, Anamnese; Administrativo: Agenda, Financeiro, Pacotes; Documentos: Termos, Documentos; Paciente: Dados, Histórico.

`PatientSectionNav` renders two things: a desktop left menu (`hidden md:block`, one item per row, group labels, active item highlighted `bg-sage/10 text-forest`) and a phone bottom bar (`md:hidden fixed bottom-0 inset-x-0`, 4 entries from `MOBILE_NAV_ENTRIES`, active entry highlighted). Tapping Clínico/Administrativo/Outros on the phone opens a bottom `Sheet` listing that entry's sections, one per row; tapping one calls `onChange` and closes the sheet. Tapping Resumo calls `onChange('resumo')`.

- [ ] **Step 1: Failing tests.**
  - `resolveSection('procedimentos', 'owner')` → `'resumo'` and `resolveSection('timeline', 'owner')` → `'resumo'` (old keys are not valid; Task 18 updates links); `resolveSection('evolucoes', 'receptionist')` → `'resumo'`; `resolveSection('financeiro', 'receptionist')` → `'financeiro'`; `resolveSection(null, 'owner')` → `'resumo'`.
  - Nav: receptionist does not see "Evoluções"; clicking "Diagramas faciais" calls `onChange('diagramas')`; on the phone bar, clicking "Outros" shows "Termos", "Documentos", "Dados", "Histórico" each as its own button, and clicking "Histórico" calls `onChange('historico')`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

### Task 5: Patient header

**Files:**
- Create: `src/components/patients/patient-header.tsx`
- Test: `src/components/patients/__tests__/patient-header.test.tsx`

**Interfaces (Produces):**
```ts
export function PatientHeader(props: {
  patient: Patient; role: Role; hasActiveService: boolean; whatsappApiEnabled?: boolean
  onNewAppointment: () => void; onNewCharge: () => void; onNewDocument: () => void; onRequestDocuments: () => void
}): JSX.Element
```
Move (copy now, Task 18 deletes the original) from `src/components/patients/patient-detail-content.tsx`: `calculateAge`, `formatBirthDate`, `getInitials`, `handleOpenWhatsapp`, the details row (age + birth date, phone popover with Ligar / Iniciar conversa / Solicitar documentos / Abrir no WhatsApp Web under the same conditions, email mailto, masked CPF), back link "Voltar para lista", the action buttons with their tooltips and `ReadOnlyGuard`/`useWriteGuard` behaviour, and Iniciar/Continuar atendimento. Fix `calculateAge` to parse with `parseLocalDate(birthDate, '12:00:00')` instead of bare `new Date(birthDate)`.

New in the header:
- Visible WhatsApp button (desktop: outline icon+label button "WhatsApp" before Agendar). If `whatsappApiEnabled && normalizedPhone.ok` it runs `handleOpenWhatsapp` (wrapped in `guardWrite`); else if `toWaMeUrl(patient.phone)` returns a URL it is an anchor to it with `target="_blank"`; else it is not rendered.
- "Novo diagrama" button linking to `/pacientes/${patient.id}/diagramas/novo`, rendered only for `owner`/`practitioner`, inside `ReadOnlyGuard`.
- Phone layout (`md:hidden`): name, age, phone; one row of 4 icon buttons with captions: WhatsApp, Agendar, Cobrar, Mais; then full-width Iniciar/Continuar atendimento. "Mais" is a `DropdownMenu` with: Novo diagrama (owner/practitioner), Novo documento, Ligar, Solicitar documentos (same condition as today), Abrir no WhatsApp Web (when URL exists), Email (when email exists). Desktop layout keeps today's card.

- [ ] **Step 1: Failing tests** (regression: the redesign must not lose any header feature).
  - With `whatsappApiEnabled: true` and a valid phone: clicking the WhatsApp button POSTs `/api/whatsapp/conversations` with `{ patientId }` and pushes `/whatsapp?conversa=<id>` (mock fetch + router).
  - With `whatsappApiEnabled: false`: the WhatsApp button is a link whose `href` is `toWaMeUrl(patient.phone)`.
  - Every existing control is present: "Novo Agendamento", "Nova Cobrança", "Novo Documento" tooltips/labels call their callbacks; "Iniciar Atendimento" links to `/pacientes/<id>/atendimento` and reads "Continuar Atendimento" when `hasActiveService`; email renders as `mailto:`; CPF renders masked; phone popover shows "Ligar".
  - "Novo diagrama" present for `practitioner`, absent for `receptionist`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

### Task 6: Shared PDF diagram rendering

**Files:**
- Create: `src/components/face-diagram/diagram-pdf.tsx`
- Modify: `src/components/reports/prontuario-pdf.tsx`
- Test: `src/components/face-diagram/__tests__/diagram-pdf.test.tsx`

**Interfaces (Produces):**
```ts
export const DIAGRAM_PDF_CSS: string // the diagram slice of PRONTUARIO_PDF_CSS (lines ~56-69), class names renamed to diagram-pdf-*
export function getPointColor(productName: string): string
export function faceTemplateUrl(viewType: DiagramViewType, gender: string | null | undefined): string
export function FaceDiagramPdfSection(props: { diagrams: DiagramWithPoints[]; gender: string | null | undefined }): ReactElement
```
Move `FaceDiagramSection`, `getPointColor`, `faceTemplateUrl` out of `prontuario-pdf.tsx`; `prontuario-pdf.tsx` imports them and its CSS concatenates `DIAGRAM_PDF_CSS`.

- [ ] **Step 1: Failing test:** `renderToStaticMarkup(<FaceDiagramPdfSection diagrams={[front with 2 points]} gender="female" />)` contains two markers with `left:` / `top:` percentages equal to the points and an `<img` whose `src` ends with the female front template file (regression: prontuário diagram must render identically after the move).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement and update `prontuario-pdf.tsx`. **Step 4:** Run this test plus `src/db/queries/reports/__tests__/prontuario.test.ts` and any `prontuario-pdf` test. Expected: PASS.

### Task 7: Patient appointments and financial summary

**Files:**
- Modify: `src/db/queries/appointments.ts`, `src/db/queries/financial.ts`
- Create: `src/app/api/patients/[id]/appointments/route.ts`, `src/app/api/patients/[id]/financial-summary/route.ts`, `src/hooks/queries/use-patient-overview.ts`
- Test: `src/db/queries/__tests__/patient-appointments.test.ts`, `src/db/queries/__tests__/patient-financial-summary.test.ts`

**Interfaces (Produces):**
```ts
export interface PatientAppointment { id: string; date: string; startTime: string; endTime: string | null; status: string; procedureTypeName: string | null; practitionerName: string | null }
export async function listPatientAppointments(tenantId: string, patientId: string): Promise<PatientAppointment[]> // ordered date desc, startTime desc; excludes soft-deleted
export interface PatientFinancialSummary { openAmount: number; overdueAmount: number; nextDueDate: string | null }
export async function getPatientFinancialSummary(tenantId: string, patientId: string): Promise<PatientFinancialSummary>
// hooks
export function usePatientAppointments(patientId: string): UseQueryResult<PatientAppointment[]>
export function usePatientFinancialSummary(patientId: string, enabled?: boolean): UseQueryResult<PatientFinancialSummary>
```
`getPatientFinancialSummary`: open = Σ (`amount` - `amountPaid`) of installments with status not paid/cancelled whose entry belongs to the patient and is not cancelled; overdue = the part with `due_date < brToday()`; `nextDueDate` = min `due_date >= brToday()` among open installments. Read the installment status CHECK values from the migrations before writing the filter. Routes: GET only, `getAuthContext()`, verify patient belongs to tenant, respond `{ data }`. Financial-summary route allows roles `owner`, `financial`, `receptionist`, `practitioner` (same as `/api/financial`).

- [ ] **Step 1: Failing tests** (drizzle mock pattern from `src/tests/mocks/drizzle-tx.ts`): the appointments query filters by tenant and patient (assert captured where params); the summary computes `overdueAmount` with a BR "today" fixed via `vi.setSystemTime` at `2026-11-02T02:00:00Z` (23:00 BRT on Nov 1) so an installment due `2026-11-01` counts as NOT overdue (regression: UTC-host day flip).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement queries, routes and hooks. **Step 4:** Run, expect PASS.

**Group A exit:** run `pnpm --filter @floraclin/web exec vitest run` on the new test files; full typecheck is expected to fail only in Task 8 files. Orchestrator commits.

---

## Group B (depends on A)

### Task 8: Diagram query layer on groups

**Files:**
- Modify: `src/db/queries/face-diagrams.ts`, `src/app/api/procedures/route.ts`, `src/app/api/procedures/[id]/route.ts`, `src/lib/session-execute.ts`, `src/lib/__tests__/session-execute.test.ts`, `src/lib/__tests__/session-execute.concurrency.test.ts`, `src/app/api/face-diagrams/route.ts`, `src/hooks/mutations/use-diagram-mutations.ts`, `src/db/queries/patient-evolutions.ts`, `src/db/queries/trial-recap.ts`, `scripts/demo-clinic/seed.ts`, `src/validations/procedure.ts`, `src/db/queries/procedures.ts` (`cancelProcedure` only)
- Create: `src/db/queries/face-diagram-groups.ts`
- Test: `src/db/queries/__tests__/face-diagrams.test.ts`, `src/db/queries/__tests__/face-diagram-groups.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 2 `QuotationLine`, `deriveDiagramStatus`, `DiagramGroupOrigin`.
- Produces:
```ts
// face-diagrams.ts
export async function saveFaceDiagram(tenantId: string, groupId: string, viewType: DiagramViewType, points: DiagramPointInput[], txDb?: typeof db): Promise<string>
export async function saveFaceDiagramForSession(tenantId: string, input: { patientId: string; practitionerId: string; procedureRecordId: string; procedureSessionId: string }, viewType: DiagramViewType, points: DiagramPointInput[], txDb?: typeof db): Promise<string>
export async function getFaceDiagram(tenantId: string, procedureRecordId: string, txDb?: typeof db): Promise<DiagramWithPoints[]> // planning + session groups of the record, same output as today
export async function listDiagramsForSession(tenantId: string, procedureSessionId: string, txDb?: typeof db): Promise<DiagramWithPoints[]>
export async function getPreviousDiagramPoints(tenantId: string, patientId: string, excludeProcedureId?: string): Promise<(DiagramPointRecord & { viewType: DiagramViewType })[]> // all views of the latest non-deleted group of the patient that has points, excluding groups linked to excludeProcedureId, ordered by group.created_at desc. Today only the first view is returned and viewType is dropped; return every view of that group with its viewType.
// face-diagram-groups.ts
export interface DiagramGroupDetail { id; patientId; practitionerId; practitionerName: string | null; origin: DiagramGroupOrigin; status: DiagramGroupStatus; procedureRecordId: string | null; procedureSessionId: string | null; sessionOrdinal: number | null; procedureTypeName: string | null; procedurePerformedAt: Date | null; quotationLines: QuotationLine[]; quotationTotal: number | null; createdAt: Date; updatedAt: Date; views: DiagramWithPoints[] }
// quotationTotal: quoteTotal(quotationLines) when lines exist; otherwise the linked procedure's financialPlan.totalAmount; otherwise null (wizard and migrated groups have no lines)
export async function ensurePlanningGroup(tx: typeof db, input: { tenantId: string; patientId: string; practitionerId: string; procedureRecordId: string }): Promise<string> // returns existing planning group id or inserts origin 'wizard'
export async function ensureSessionGroup(tx: typeof db, input: { tenantId: string; patientId: string; practitionerId: string; procedureRecordId: string; procedureSessionId: string }): Promise<string>
export async function createStandaloneGroup(tx: typeof db, input: { tenantId: string; patientId: string; practitionerId: string; views: { viewType: DiagramViewType; points: DiagramPointInput[] }[]; quotationLines: QuotationLine[] }): Promise<string>
export async function lockDiagramGroup(tx: typeof db, tenantId: string, groupId: string): Promise<{ id; patientId; origin; procedureRecordId; procedureSessionId; declinedAt; procedureStatus: ProcedureStatus | null; status: DiagramGroupStatus } | null> // SELECT ... FOR UPDATE on the group row; every state-sensitive group mutation calls this first
export async function updateStandaloneGroup(tx: typeof db, input: { tenantId: string; groupId: string; views: ...; quotationLines: QuotationLine[] }): Promise<void> // lockDiagramGroup, then throws DiagramGroupLockedError when status !== 'quote'; replaces all views (views not in the payload are deleted)
export async function linkGroupToProcedure(tx: typeof db, input: { tenantId: string; patientId: string; groupId: string; procedureRecordId: string }): Promise<void> // lockDiagramGroup; requires same patient, status 'quote', and no OTHER open procedure (isOpenStatus) for the patient besides procedureRecordId; otherwise throws DiagramGroupLockedError (message per case)
export async function releaseStandaloneGroups(tx: typeof db, tenantId: string, procedureRecordIds: string[]): Promise<number> // sets procedure_record_id = NULL on origin 'standalone' planning groups linked to these records; returns count
export async function getDiagramGroup(tenantId: string, groupId: string): Promise<DiagramGroupDetail | null>
export async function listPatientDiagramGroups(tenantId: string, patientId: string): Promise<DiagramGroupDetail[]> // newest first, excludes deleted
export class DiagramGroupLockedError extends Error {}
```
Changes:
- `POST /api/procedures`: accept optional `diagramGroupId` (add to the zod schema in `src/validations/procedure.ts`). Inside the existing transaction, after creating the procedure: if `diagramGroupId` → `linkGroupToProcedure` and save `body.diagrams` into that group; else `ensurePlanningGroup` then save. Map `DiagramGroupLockedError` to 409 `{ error: 'Este diagrama já está em outro atendimento' }`.
- `saveFaceDiagram` and `saveFaceDiagramForSession` lock the group row (`lockDiagramGroup` or an equivalent `FOR UPDATE`) before the view upsert, because there is no DB unique index on `(group_id, view_type)`.
- `cancelProcedure` in `src/db/queries/procedures.ts`: in the same transaction, call `releaseStandaloneGroups(tx, tenantId, [procedureId])` (spec: a cancelled atendimento sends its quotation back to Orçamento). If `cancelProcedure` does not take a tx today, wrap its update and the release in `withTransaction`. Task 12 does the same for the follow-up `desistiu` path.
- `PUT /api/procedures/[id]`: `ensurePlanningGroup` then `saveFaceDiagram`; move the `getFaceDiagram` used by `computePlanningStatus` inside the transaction (pass `tx`).
- `session-execute.ts`: call the new `saveFaceDiagramForSession` signature (patientId and practitionerId from the locked record / `executedBy`). Update the two test files' mocks to the new signature only.
- `api/face-diagrams/route.ts`: keep only GET `?patientId` (previous points). Delete the `?procedureRecordId` branch and POST if no caller remains (grep first). Delete `useSaveFaceDiagram` and the hook file if empty.
- Delete `listDiagramsForRecord`.
- `patient-evolutions.ts` `diagramPointCount` SQL: keep today's invariant exactly. Count the session group's points when the session has a group; fall back to the planning group (`g.procedure_record_id = pr.id AND g.procedure_session_id IS NULL`) only when NO session group exists for that record (`NOT EXISTS`), never both. `trial-recap.ts` count: join `face_diagrams` to `face_diagram_groups` with `g.deleted_at IS NULL` (standalone diagrams count too).
- `scripts/demo-clinic/seed.ts`: insert a planning group per seeded procedure and set `groupId` on diagram rows.

- [ ] **Step 1: Failing tests.**
  - `getFaceDiagram` selects through `face_diagram_groups` filtered by tenant and `procedure_record_id` (assert captured SQL/params) and returns rows from both planning and session groups (regression: pre-migration diagrams still show in approval/detail/prontuário).
  - `getPreviousDiagramPoints` excludes groups linked to `excludeProcedureId` and includes standalone groups (procedure null) (regression: ghost overlay must see standalone diagrams).
  - `linkGroupToProcedure` throws `DiagramGroupLockedError` when the group's derived status is `in_service`, and when `patientId` differs.
  - `updateStandaloneGroup` throws `DiagramGroupLockedError` when linked to an `approved` procedure.
  - `ensurePlanningGroup` returns the existing id without inserting when a planning group exists.
  - `linkGroupToProcedure` throws when the patient has another open procedure (status `in_progress`) besides the new one (regression: two tabs or a crafted URL must not attach a quote to a second atendimento).
  - `getPreviousDiagramPoints` returns points of all three views with their `viewType` (regression: profile points were collapsed to front).
  - Evolution `diagramPointCount`: planning-only record counts planning points; session with its own group counts only session points; both present counts only session points (regression: no double counting).
  - `cancelProcedure` releases a standalone group (its `procedure_record_id` becomes null) and leaves a wizard group linked.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run these tests plus `src/lib/__tests__/session-execute*.test.ts`. Expected: PASS.
- [ ] **Step 5:** `pnpm --filter @floraclin/web typecheck`. Expected: PASS.

### Task 9: Required consents at finalize and pending list

**Files:**
- Modify: `src/lib/encounter-finalize.ts`, `src/db/queries/consent.ts`, `src/hooks/queries/use-consent.ts`
- Create: `src/app/api/consent/pending/[patientId]/route.ts`
- Test: `src/lib/__tests__/encounter-finalize-consents.test.ts`, `src/db/queries/__tests__/pending-consents.test.ts`

**Interfaces:**
- Consumes: Task 3 `requiredConsentTypes`, `pendingConsentTypes`; Task 1 `procedureRecords.requiredConsentTypes`.
- Produces:
```ts
export interface PendingConsentItem { procedureRecordId: string; procedureTypeName: string; approvedAt: Date | null; pendingTypes: string[] }
export async function listPendingConsents(tenantId: string, patientId: string): Promise<PendingConsentItem[]> // records with status approved/in_progress/completed, required_consent_types not null, pending non-empty; signed types = distinct consent_templates.type of consent_acceptances for that record
export function usePendingConsents(patientId: string): UseQueryResult<PendingConsentItem[]> // key ['consent','pending',patientId]
```
`finalizeEncounter`: inside the transaction, compute categories of all cart line procedure types, check for an active `service_contract` template, compute `required = requiredConsentTypes(...)`, store it on the primary record (`draftRecordIds[0]`, or the first created record when there were no drafts). Read signed types for the primary record. If `pendingConsentTypes(required, signed)` is non-empty, write `createAuditLog({ action: 'update', entityType: 'procedure_record', entityId: primaryId, changes: { pendingSignatures: { old: null, new: pending } } }, tx)`. Route: GET, `getAuthContext()`, `{ data }`.

- [ ] **Step 1: Failing tests:** finalize with a botox line, an active contract template and only `general` signed stores `['general','botox','service_contract']` on the primary record and writes one audit row with `new: ['botox','service_contract']`; finalize with everything signed writes no audit row; `listPendingConsents` returns nothing for a record whose required types are all signed (regression: signing later clears the pending item).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run plus existing `encounter-finalize` tests. Expected: PASS.

**Group B exit:** full `pnpm --filter @floraclin/web test:run` and typecheck green. Orchestrator commits.

---

## Group C (depends on B)

### Task 10: Diagram group API and hooks

**Files:**
- Create: `src/app/api/patients/[id]/face-diagram-groups/route.ts`, `src/app/api/face-diagram-groups/[id]/route.ts`, `src/hooks/queries/use-face-diagram-groups.ts`, `src/hooks/mutations/use-face-diagram-group-mutations.ts`
- Modify: `src/hooks/queries/query-keys.ts`
- Test: `src/app/api/face-diagram-groups/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 8 group queries; Task 2 schemas.
- Produces:
  - `GET /api/patients/[id]/face-diagram-groups` → `{ data: DiagramGroupDetail[] }`
  - `POST /api/patients/[id]/face-diagram-groups` body `createDiagramGroupSchema` → `{ data: { id } }`, audit `create`/`face_diagram_group`
  - `GET /api/face-diagram-groups/[id]` → `{ data: DiagramGroupDetail }` or 404
  - `PUT /api/face-diagram-groups/[id]` body `updateDiagramGroupSchema` → `{ success: true }`; 409 `{ error: 'Este diagrama está vinculado a um atendimento e não pode ser editado' }` on `DiagramGroupLockedError`; audit `update`
  - Hooks: `usePatientDiagramGroups(patientId)` key `queryKeys.diagramGroups.byPatient(patientId)`, `useDiagramGroup(id)`, `useCreateDiagramGroup()`, `useUpdateDiagramGroup()` (invalidate `['diagram-groups']` and `['planejamentos']`).
  - Practitioner id for create = `ctx.userId`. Patient must belong to tenant (`verifyTenantOwnership`).
- [ ] **Step 1: Failing tests:** POST as `receptionist` → 403; POST with empty `views` → 400; PUT on a locked group → 409 with the message above; GET for another tenant's group → 404.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

### Task 11: Quotation PDF, storage, WhatsApp, timeline

**Files:**
- Create: `src/db/queries/face-diagram-quotes.ts`, `src/components/face-diagram/quote-pdf.tsx`, `src/app/api/face-diagram-groups/[id]/quotes/route.ts`, `src/app/api/face-diagram-quotes/[id]/send-whatsapp/route.ts`
- Modify: `src/types/timeline.ts`, `src/app/api/patients/[id]/timeline/route.ts`, `src/components/patients/patient-timeline-tab.tsx` (render the two new kinds)
- Test: `src/app/api/face-diagram-groups/__tests__/quotes.test.ts`, `src/components/face-diagram/__tests__/quote-pdf.test.tsx`

**Interfaces:**
- Consumes: Task 6 `FaceDiagramPdfSection`, `DIAGRAM_PDF_CSS`; Task 8 `getDiagramGroup`; Task 2 `quoteTotal`.
- Produces:
```ts
export interface DiagramQuote { id; groupId; patientId; storagePath; lines: QuotationLine[]; total: number; createdBy; createdAt: Date; whatsappStatus: 'queued' | 'sent' | null; whatsappRequestedAt: Date | null }
export async function createDiagramQuote(tx, input: { tenantId; patientId; groupId; storagePath; lines; total; createdBy }): Promise<DiagramQuote>
export async function listDiagramQuotes(tenantId: string, groupId: string): Promise<DiagramQuote[]>
export async function getDiagramQuote(tenantId: string, quoteId: string): Promise<DiagramQuote | null>
export async function markQuoteWhatsapp(tenantId: string, quoteId: string, input: { status: 'queued' | 'sent'; whatsappMessageId: string | null }): Promise<void>
export function QuotePdf(props: { tenant: TenantHeaderInfo; patient: { fullName: string; gender: string | null }; group: DiagramGroupDetail; lines: QuotationLine[]; total: number; generatedAt: Date }): ReactElement
```
  - `POST /api/face-diagram-groups/[id]/quotes` (`requireWrite('owner','practitioner')`, `runtime='nodejs'`): rejects with 400 `{ error: 'Adicione ao menos um procedimento ao orçamento' }` when `quotationLines` is empty; renders `QuotePdf` with `renderReactToPdf(..., PRINT_BASE_CSS + DIAGRAM_PDF_CSS)` (logo via `fetchLogoDataUri`), uploads with `uploadPdfBuffer({ fileName: \`quotes/${quoteId}.pdf\`, visibility: 'signed' })` (generate `quoteId` with `crypto.randomUUID()` first), then inserts the row and audits (`create`/`face_diagram_quote`) in one transaction; if that transaction throws, call `deleteFile(path)` before rethrowing so no untracked patient PDF stays in storage. Returns `{ data: { id, url } }`.
  - `GET /api/face-diagram-groups/[id]/quotes` → `{ data: (DiagramQuote & { url: string })[] }` with fresh signed URLs.
  - `POST /api/face-diagram-quotes/[id]/send-whatsapp`: mirror `src/app/api/clinical-documents/[id]/send-whatsapp/route.ts` (phone normalization, `sendOrEnqueueDocument` with `documentLabel: 'Orçamento'`, caption `Orçamento - <clinic name>`, filename `orcamento.pdf`), then `markQuoteWhatsapp` with `status: 'sent'` or `'queued'` from the sender's result, audit. Same error mapping as that route. Quote history and timeline show "Enviado por WhatsApp em <data>" for `sent` and "Na fila do WhatsApp desde <data>" for `queued`.
  - PDF content: clinic header (`ClinicHeader`), title "Orçamento", patient name, date (BR), diagram views that have points, lines table (Procedimento, Sessões, Valor unitário, Subtotal), total, footer "Valores sujeitos a alteração após avaliação." (my call).
  - Timeline kinds: `quote_generated`, `quote_sent_whatsapp` (labels "Orçamento gerado", "Orçamento enviado por WhatsApp").
- [ ] **Step 1: Failing tests:** POST quotes with empty lines → 400; POST stores a row whose `total` equals `quoteTotal(lines)` and whose `lines` are a copy (mutating the group afterwards does not change the stored quote row, regression: snapshot); when the DB insert throws, `deleteFile` is called with the uploaded path; send-whatsapp marks `queued` when the sender returns `{ queued: true }`; `QuotePdf` markup contains each line name and the formatted total `R$ 2.199,99`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

### Task 12: CRM follow-up for quotations

**Files:**
- Modify: `src/db/queries/followups.ts`, `src/lib/followups.ts` (including the existing procedure `desistiu` path), `src/app/api/planejamentos/route.ts`, `src/hooks/queries/use-planejamentos.ts`, `src/components/planejamentos/planejamentos-table.tsx`, `src/components/dashboard/open-planejamentos-card.tsx`, `src/components/planejamentos/followup-modal.tsx`, `src/components/planejamentos/snooze-modal.tsx`
- Create: `src/app/api/face-diagram-groups/[id]/snooze/route.ts`, `src/app/api/face-diagram-groups/[id]/followups/route.ts`
- Test: `src/db/queries/__tests__/followups-diagram-quotes.test.ts`, `src/lib/__tests__/followups-diagram.test.ts`

**Interfaces:**
- Consumes: Task 1 group follow-up columns, Task 2 `deriveDiagramStatus`, `quoteTotal`.
- Produces:
  - `OpenPlanejamentoRow` gains `kind: 'procedure' | 'diagram_quote'` and `href: string` (procedure rows: `/pacientes/${patientId}/atendimento`; quote rows: `/pacientes/${patientId}/diagramas/${groupId}`). Quote rows use the group id as `id`, `procedureTypeName` = first line name plus ` +N` when more lines, `totalAmount` = `quoteTotal` as string, `practitionerId/Name` = author, `status: 'quote'`, `performedAt: null`.
  - `listOpenDiagramQuotes(args: ListOpenPlanejamentosArgs): Promise<OpenPlanejamentoRow[]>`: non-deleted groups with `origin = 'standalone'`, `procedure_session_id IS NULL`, `procedure_record_id IS NULL`, `declined_at IS NULL`, same snooze rule and practitioner filter, `procedureTypeId` filter matches any line (jsonb containment).
  - API route merges both lists and sorts by `COALESCE(lastContactedAt, createdAt)` ascending, then applies `limit`.
  - `recordDiagramFollowup({ tenantId, groupId, userId, channel, outcome, notes })`: in a transaction, `lockDiagramGroup` (Task 8) and require status `quote` (else throw; route maps to 409 `{ error: 'Este orçamento não está mais aguardando' }`); inserts `procedure_followups` with `faceDiagramGroupId`, sets `last_contacted_at = now()`; outcome `desistiu` sets `declined_at = now()`. `snoozeDiagramGroup({ tenantId, groupId, until })` with the same lock and status check.
  - Existing `recordFollowup` with outcome `desistiu` cancels the procedure: call `releaseStandaloneGroups(tx, tenantId, [procedureRecordId])` (Task 8) in the same transaction. Routes mirror the procedure ones (same roles, same zod schemas, same responses).
  - Hooks `useRecordFollowup` / `useSnoozeProcedure` accept `kind` and call the matching endpoint. Table and dashboard card link with `row.href`; modals pass `kind` through.
- [ ] **Step 1: Failing tests:** a standalone unlinked group is listed; a wizard group (linked to a cancelled procedure) is not (Review Focus 1); a declined group is not listed; procedure `recordFollowup` with `desistiu` releases the linked standalone group; `recordDiagramFollowup` with `desistiu` sets `declined_at`; `recordDiagramFollowup` on a group with status `in_service` throws; practitioner filter is applied for role practitioner (route test).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run plus existing planejamentos/followups tests. Expected: PASS.

### Task 13: Approve without signatures, sign later

**Files:**
- Create: `src/components/procedures/procedure-signatures-panel.tsx`
- Modify: `src/components/procedures/procedure-approval.tsx`, `src/components/service-wizard/service-wizard.tsx`, `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx`
- Test: `src/components/procedures/__tests__/procedure-approval-pending.test.tsx`, `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/__tests__/procedure-page-sign.test.tsx`

**Interfaces:**
- Consumes: Task 3 `CATEGORY_TO_CONSENT`.
- Produces:
  - `ProcedureSignaturesPanel(props: { procedure; patient; tenant; additionalTypeIds?: string[]; primaryRecordId: string; onPendingChange?: (pending: { types: string[]; labels: string[] }) => void })`: the consent status list, contract signing, signing link and 15s polling, extracted from `procedure-approval.tsx` without behaviour change.
  - `ProcedureApproval` renders the panel and accepts `onPendingSignaturesChange?: (labels: string[]) => void`.
  - Procedure page mode `?action=sign` for `approved`, `in_progress`, `completed`: header "Assinaturas pendentes", the panel, and a back link to `/pacientes/<id>?tab=termos`. Task 15 links here.

Behaviour:
- `procedure-approval.tsx` imports `CATEGORY_TO_CONSENT` from `@/lib/consent-requirements` (delete the local copy) and uses the panel.
- Remove the signature gate from approval: `runApprove` no longer returns early when signatures are missing, and its button is enabled while items are unsigned. Label: "Aprovar e assinar depois" when anything is pending, otherwise today's label. This covers the standalone approval page (`procedure-card.tsx` → `?action=approve`).
- When anything is unsigned, show a neutral note (sage tones, not amber/red, no modal) above the signing controls: "Você pode coletar as assinaturas agora ou depois. As pendentes ficam em Termos, no cadastro do paciente."
- `service-wizard.tsx` keeps the pending labels in state; at step 4, when pending is non-empty, the primary button label is "Aprovar e assinar depois"; otherwise the current label. `handleApprove` already finalizes without checking signatures; keep it. "Adiar Aprovação" is unchanged.
- Replace `?tab=procedimentos` with `?tab=atendimentos` in `procedure-approval.tsx` (around line 617).
- [ ] **Step 1: Failing tests:**
  - `ProcedureApproval` with `general` unsigned: the note is visible, `onPendingSignaturesChange` received a non-empty array, the button reads "Aprovar e assinar depois", is enabled, and clicking it POSTs to the finalize endpoint (regression: the old gate blocked approval on the standalone page).
  - With everything signed: note absent, callback got `[]`, today's label.
  - Procedure page with a `completed` procedure and `?action=sign` renders the panel (regression: signatures must be collectable after Execução).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run plus existing `procedure-approval`, `service-wizard` and procedure page tests. Expected: PASS.

### Task 15: Pending signatures in Termos

**Files:**
- Create: `src/components/patients/pending-consents-list.tsx`
- Modify: `src/components/patients/patient-consent-tab.tsx`
- Test: `src/components/patients/__tests__/pending-consents-list.test.tsx`

**Interfaces:**
- Consumes: Task 9 `usePendingConsents`, `PendingConsentItem`.
- Produces: `PendingConsentsList({ patientId }: { patientId: string })`, rendered at the top of the Termos tab, hidden when empty.

Each item: procedure type name, approval date (BR format), pending items as chips (labels: `general` "Termo geral", `botox` "Toxina botulínica", `filler` "Preenchimento", `biostimulator` "Bioestimulador", `service_contract` "Contrato"), and a button "Coletar assinaturas" linking to `/pacientes/${patientId}/procedimentos/${procedureRecordId}?action=sign` (Task 13). Keep React Query's refetch on window focus for `usePendingConsents` so items disappear after signing.

- [ ] **Step 1: Failing test:** with one pending item, the chips "Termo geral" and "Contrato" render and the link href is exact; with an empty list nothing renders.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run plus `patient-consent-tab.test.tsx`. Expected: PASS.

**Group C exit:** full tests + typecheck. Orchestrator commits.

---

## Group D (depends on C)

### Task 14: Start an atendimento from a saved quotation

**Files:**
- Modify: `src/app/(platform)/pacientes/[id]/atendimento/atendimento-page-client.tsx`, `src/components/service-wizard/service-wizard.tsx`, `src/components/service-wizard/procedure-type-step.tsx`, `src/components/procedures/procedure-form.tsx`
- Test: `src/components/service-wizard/__tests__/procedure-type-step-quote.test.tsx`

**Interfaces:**
- Consumes: Task 10 `usePatientDiagramGroups`; Task 2 `buildCartFromQuote`, `DIAGRAM_STATUS_LABELS`; Task 8 `diagramGroupId` on `POST /api/procedures`.
- Produces:
  - `atendimento-page-client.tsx` reads `?diagram=<groupId>` and passes `initialDiagramGroupId` to `ServiceWizard`.
  - `ServiceWizard` holds `sourceDiagramGroupId: string | null` (local state, initial from prop) and passes `quoteSelection={{ selectedGroupId, onSelect }}` to `ProcedureTypeStep` and `sourceDiagram={{ groupId, views } | null}` to `ProcedureForm`.
  - `ProcedureTypeStep`: when the cart is empty and the patient has groups with status `quote`, show a card at the top: "Este paciente tem um orçamento de <dd/MM/yyyy>" with buttons "Usar orçamento" (primary) and "Começar do zero". When more than one quote exists, a select lists them by date and total, newest preselected. "Usar orçamento" → `setCart(buildCartFromQuote(lines))` + `onSelect(groupId)`. When `selectedGroupId` came from the URL, apply it automatically on mount once the groups load. Hide the card after a choice.
  - `ProcedureForm` (create mode only): when `sourceDiagram` is set and there are no existing diagrams, seed the form points from `sourceDiagram.views` (keep each point's `viewType`) and send `diagramGroupId` in the `POST /api/procedures` body. On a 409 show a toast with the server message.
  - `ProcedureForm` save payload: group points by `viewType` (default `front`) and send one `{ viewType, points }` entry per view, for create and edit. Today every point is sent as a single `front` view (`procedure-form.tsx` ~635-658), which would move profile points onto the front face.
  - `ProcedureForm` ghost overlay mapping (~360-386): keep `viewType` from `getPreviousDiagramPoints` (Task 8) on each previous point.
  - Replace `?tab=procedimentos` with `?tab=atendimentos` in `procedure-form.tsx` (around lines 744, 748, 1015).
- [ ] **Step 1: Failing tests:** `ProcedureTypeStep` with one quote group (2 lines, custom unit prices) and empty cart: clicking "Usar orçamento" calls `onCartChange` with a cart whose `computeCartTotal` equals the quote total and calls `onSelect(groupId)`; with no quote groups the card is absent; with `selectedGroupId` preset the cart is applied without a click. `ProcedureForm` seeded with a source diagram holding front, left_profile and right_profile points POSTs `diagrams` with three entries, each with its own points, plus `diagramGroupId` (regression: view collapse). Form test file: `src/components/procedures/__tests__/procedure-form-source-diagram.test.tsx`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run plus existing service-wizard and procedure-form tests. Expected: PASS.

### Task 16: Diagram pages and the Diagramas section

**Files:**
- Create: `src/components/face-diagram-groups/diagram-group-editor.tsx`, `src/components/face-diagram-groups/quotation-lines-editor.tsx`, `src/components/face-diagram-groups/quote-history.tsx`, `src/components/patients/patient-diagrams-section.tsx`, `src/app/(platform)/pacientes/[id]/diagramas/novo/page.tsx`, `src/app/(platform)/pacientes/[id]/diagramas/[groupId]/page.tsx` and their `*-page-client.tsx`
- Test: `src/components/face-diagram-groups/__tests__/diagram-group-editor.test.tsx`, `src/components/face-diagram-groups/__tests__/quotation-lines-editor.test.tsx`, `src/components/patients/__tests__/patient-diagrams-section.test.tsx`

**Interfaces:**
- Consumes: Task 10 hooks; Task 11 quote endpoints; Task 2 status/labels/`quoteTotal`; existing `FaceDiagramEditor` (`readOnly` prop), `useProcedureTypes`, `useProducts` (catalog for the editor, as `procedure-form.tsx` does), `useProcedures(patientId)` with `isOpenStatus` from `@/lib/procedure-status` for `hasActiveService` (includes `in_progress`), `useReadOnly` from `@/components/layout/subscription-access`.
- Produces:
  - `QuotationLinesEditor({ value, onChange, readOnly }: { value: QuotationLine[]; onChange: (l: QuotationLine[]) => void; readOnly?: boolean })`: add a procedure type (select of active types, prefilled `unitPrice = type.defaultPrice`, `sessions = 1`), edit sessions and unit price (currency input already used in the financial forms), remove line, shows total.
  - `DiagramGroupEditor({ patient, group, role }: { patient: Patient; group: DiagramGroupDetail | null; role: Role })`: top: patient name + status badge; body: `FaceDiagramEditor` and `QuotationLinesEditor`, both read-only when status is not `quote`, or the role is not `owner`/`practitioner`, or `useReadOnly()` is true; in those cases every write action (Salvar, Gerar PDF, Enviar por WhatsApp, Iniciar atendimento) is hidden, while existing quotes in the history stay openable. The `diagramas/novo` page shows a not-allowed message for other roles; actions: "Salvar" (create → redirect to `/pacientes/<id>/diagramas/<newId>`; update), "Gerar PDF" (opens the returned URL in a new tab; disabled until saved and lines non-empty), "Enviar por WhatsApp" (generates a quote then calls send-whatsapp; hidden when the patient phone is invalid), "Iniciar atendimento com este diagrama" (link `/pacientes/<id>/atendimento?new=1&diagram=<groupId>`; when the patient has an active service it becomes "Continuar atendimento" linking to `/pacientes/<id>/atendimento` without the diagram param). Below: `QuoteHistory` (date, total, "Abrir", "Enviado por WhatsApp em ..." when sent). Back link to `/pacientes/<id>?tab=diagramas`. Mobile: stacked layout, editor full width.
  - `PatientDiagramsSection({ patientId, role }: ...)`: list newest first. An item is either a planning group (thumbnail via read-only `FaceDiagramEditor` small, date, author, status badge, quotation total when not null) with that procedure's session groups nested as "Sessão N", or, for a procedure that has session groups but no planning group, a heading "Atendimento <dd/MM/yyyy> · <procedure type>" with its sessions nested. Click opens the group page; "Novo diagrama" button for owner/practitioner; empty state "Nenhum diagrama facial ainda".
- [ ] **Step 1: Failing tests:** editor with a group in status `in_service` renders the diagram read-only and no "Salvar"; editor for role `receptionist` (status `quote`) is read-only with no write actions; with an `in_progress` procedure, the start button reads "Continuar atendimento" and its href has no `diagram=` (spec call 4); "Gerar PDF" is disabled when lines are empty; `QuotationLinesEditor` updates the total when a unit price changes and hides already-added procedure types from the add select; section nests a session group under its planning group, and shows a session-only procedure under an "Atendimento" heading (regression: migrated session-only diagrams must not vanish).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

### Task 17: Resumo and Agenda

**Files:**
- Create: `src/components/patients/patient-summary.tsx`, `src/components/patients/patient-agenda-section.tsx`
- Test: `src/components/patients/__tests__/patient-summary.test.tsx`, `src/components/patients/__tests__/patient-agenda-section.test.tsx`

**Interfaces:**
- Consumes: Task 7 hooks; Task 10 `usePatientDiagramGroups`; existing `useProcedures`, `usePatientPackages`; Task 4 `PatientSectionKey`.
- Produces:
  - `PatientSummary({ patientId, role, onNavigate }: { patientId: string; role: Role; onNavigate: (key: PatientSectionKey) => void })`: 2-column grid on `md+`, 1 column on phones; 4 cards:
    - "Diagramas faciais": latest planning group (read-only small editor, date, status badge, quote total); link "Ver todos" → `onNavigate('diagramas')`; empty state with "Novo diagrama" link for owner/practitioner.
    - "Próximos agendamentos": up to 3 upcoming, status not cancelled, ascending; link "Agenda" → `agenda`; empty "Nenhum agendamento futuro". Upcoming = `date > brToday()` or (`date === brToday()` and `startTime >=` the current BR wall-clock `HH:mm`). Put this rule in one exported helper `isUpcomingAppointment(a: { date: string; startTime: string }, now?: Date): boolean` in `patient-agenda-section.tsx` and use it in both components. BR wall-clock via `formatInTimeZone(now, 'America/Sao_Paulo', 'HH:mm')` from `date-fns-tz` (or a `@/lib/dates` helper if one exists).
    - "Últimos atendimentos": up to 3 non-draft procedures by `performedAt ?? approvedAt` desc with status chip; link "Ver todos" → `atendimentos`.
    - "Financeiro": open amount (BRL), overdue amount in amber when > 0, next due date (BR format), active package progress "Pacote: X de Y sessões"; link "Ver tudo" → `financeiro`.
  - `PatientAgendaSection({ patientId })`: "Próximos" (ascending) and "Anteriores" (descending) lists: date, time, procedure type, practitioner, status chip.
- [ ] **Step 1: Failing tests:** with system time `2026-11-02T02:00:00Z` (BR: 2026-11-01 23:00): `2026-10-31 10:00` is past; `2026-11-01 20:00` is past (same BR day, earlier time); `2026-11-01 23:30` is upcoming; `2026-11-02 09:00` is upcoming (regression: BR day and time boundaries on a UTC host); clicking "Ver todos" in the diagram card calls `onNavigate('diagramas')`; overdue amount renders with the amber class only when > 0.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.

**Group D exit:** full tests + typecheck. Orchestrator commits.

---

## Group E (depends on D)

### Task 18: Wire the new patient page

**Files:**
- Modify: `src/components/patients/patient-detail-content.tsx`, `src/app/(platform)/pacientes/[id]/patient-detail-page-client.tsx`, `src/app/(platform)/pacientes/[id]/loading.tsx`, `src/components/procedures/procedure-detail-view.tsx`
- Delete: `src/components/patients/patient-tabs.tsx`
- Test: `src/components/patients/__tests__/patient-detail-content.test.tsx`

**Interfaces:**
- Consumes: Tasks 4, 5, 15, 16, 17 components.
- Produces: `PatientDetailContent` props unchanged (`patient`, `activeTab`, `hasActiveService`, `whatsappApiEnabled`, `role`).

Layout: `PatientHeader` on top; below, `md:grid md:grid-cols-[200px_1fr] gap-5` with `PatientSectionNav` and the content card. Section state from `resolveSection(activeTab, role)`; changing section writes `?tab=<key>` with `router.replace(..., { scroll: false })` and removes it for `resumo`. Section → component map: resumo `PatientSummary`, atendimentos `PatientProceduresTab`, diagramas `PatientDiagramsSection`, evolucoes `PatientEvolutionsTab`, fotos `PatientPhotosTab`, anamnese `PatientAnamnesisTab`, agenda `PatientAgendaSection`, financeiro `PatientFinancialTab`, pacotes `PatientPackagesTab`, termos `PatientConsentTab`, documentos `PatientDocumentsTab`, dados `PatientDataTab`, historico `PatientTimelineTab`, each with the same props as today. Keep `PaymentForm` (on success go to `financeiro`), `AppointmentForm`, `RequestDocumentsDialog`, `IssueDocumentDialog`. Add `pb-20 md:pb-0` so the phone bottom bar does not cover content. Remove the code moved to `PatientHeader`.

- [ ] **Step 1: Failing tests:** default render shows the Resumo cards; a patient whose only procedure is `in_progress` gets "Continuar Atendimento" (test in `src/app/(platform)/pacientes/[id]/__tests__/patient-detail-page-client.test.tsx`); `activeTab="atendimentos"` renders the procedures tab; `activeTab="procedimentos"` falls back to Resumo; selecting "Financeiro" calls `router.replace` with `?tab=financeiro`; saving a charge (PaymentForm `onSuccess`) switches to Financeiro.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. Replace `?tab=procedimentos` with `?tab=atendimentos` in `procedure-detail-view.tsx:285` (Tasks 13 and 14 changed the other links). In `patient-detail-page-client.tsx`, compute `hasActiveService` with `isOpenStatus` from `@/lib/procedure-status` (today it misses `in_progress`). Update `loading.tsx` skeleton to the new layout.
- [ ] **Step 4:** `grep -rn "tab=procedimentos\|tab=timeline\|patient-tabs" src` returns nothing. Run full `pnpm --filter @floraclin/web test:run` and typecheck. Expected: PASS.

**Group E exit:** `pnpm ci:checks` green. Orchestrator commits.

---

## Deploy notes (for the PR body)

1. Apply `0048_face_diagram_groups.sql` in production before deploying.
2. Deploy.
3. Wait until the deploy is live and old instances have drained (at least one hour), then apply `0049_face_diagram_groups_finalize.sql`.
