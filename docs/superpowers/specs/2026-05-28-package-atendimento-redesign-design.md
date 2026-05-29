# Packages in atendimento + per-session execution — design

**Status:** Approved (brainstorm) · awaiting user review of written spec
**Date:** 2026-05-28
**Scope:** Unify package sales into the atendimento wizard, eliminate the redundant per-session wizard, and introduce a per-session execution model so multi-session lines can be tracked accurately over time.

---

## Goal

Today every package session forces the patient through the full atendimento wizard (Anamnese → Procedimentos → Planejamento → Aprovação → Execução), even though anamnese, planning, and consent were already settled at sale time. And package sales happen in a `SellPackageDialog` separate from atendimento, even though the clinical intent ("this patient will receive these procedures") is the same.

This spec unifies the two flows. One atendimento creates a plan (single-procedure or multi-session bundle). Subsequent sessions skip the wizard entirely — they go straight to a per-session execution form recorded against that plan.

---

## Core model change

### Today

`procedure_records` is both **the plan** (procedure type, planning snapshot, consent ref, financial plan) AND **the single execution event** (`performedAt`, `technique`, `clinicalResponse`, `adverseEffects`, `notes`, `followUpDate`).

For ad-hoc procedures that's fine — one record = one event. But for a 4-session skinbooster line, the existing implementation creates 4 separate `procedure_records`, each re-walking the entire wizard.

### After

`procedure_records` becomes **the plan** — created once, lives forever as the durable "we agreed to deliver this." A new `procedure_sessions` table holds **each executed session** — products applied (with batch), photos, clinical response, follow-up, etc.

- An ad-hoc single-session procedure = 1 `procedure_record` (plan) + 1 `procedure_session` (the execution).
- A 4-session skinbooster line = 1 `procedure_record` (plan) + 4 `procedure_sessions` accumulated over weeks/months.

The atendimento wizard goes through steps 1–4 **once** to create the plan. Step 5 becomes a persistent execution dashboard for that atendimento — accessible whenever the patient returns for the next session.

---

## Data model

### `patient_packages` — kept, slightly repurposed

- Stays as the commercial bundle entity (name, totalAmount, purchasedAt, expiresAt, status, financialEntryId, soldBy, cancelledAt, cancelReason).
- New nullable columns for the "Encerrar pacote" action — kept separate from the `cancelledAt`/`cancelReason` pair so a `completed-early` package is never confused with a `cancelled` one in audit/financial reports:
  - `closedAt TIMESTAMPTZ` — set when staff invokes "Encerrar pacote".
  - `closedReason VARCHAR(50)` — one of: `'patient_lost_expiry'`, `'patient_stopped_treatment'`, `'other'`.
  - `closeNote TEXT` — free-text when `closedReason = 'other'`, null otherwise.
- `status` CHECK is unchanged: `'active' | 'completed' | 'cancelled' | 'expired'`. The lazy-expire writeback (already implemented) now also surfaces a warning in the UI rather than being silent.

**When a `patient_packages` row is created** (decided at atendimento finalization):
- Either a package template was picked in step 2, **or**
- Any selected line has `sessionsTotal > 1`.

There is at most ONE `patient_packages` row per atendimento. Multiple templates per atendimento are blocked at step 2 (template chooser is single-select). When both a template and ad-hoc lines coexist, they merge into the same package row.

**Metadata when no template was picked (pure ad-hoc multi-session):**
- `name`: auto-generated from lines — `"Pacote {procedureType} — {N} sessões"` for a single multi-session line, `"Pacote: {N}× {type1} + {M}× {type2}"` for mixed. Editable on the package card.
- `expiresAt`: pulled from a tenant-level default `whatsapp_settings`-style key (`default_package_validity_months`, nullable; default null = no expiry). Configurable in `Configurações > Clínica`.
- `totalAmount`: sum of (per-line defaultPrice × sessions), editable via the existing discount override.

When a template is picked, the template's `name`, `validityMonths`, and `defaultPrice` win; ad-hoc lines added alongside contribute their priced sessions to the total.

### `patient_package_lines` — dropped

Lines are now `procedure_records` directly. Migration: backfill `procedure_records.sessionsTotal` from the matching `patient_package_lines.sessionsTotal`, then drop the table.

### `procedure_records` — repurposed as "the plan"

New columns:

| Column | Type | Notes |
|---|---|---|
| `sessionsTotal` | `integer NOT NULL DEFAULT 1` | Snapshot of how many sessions this line was sold with. Defaults to 1 for ad-hoc. Frozen at atendimento finalization; future package edits do not back-modify history. |
| `atendimentoId` | `uuid` | Groups all procedure_records created from the same atendimento. Used by the wizard to navigate back to step 5's picker. |

Existing columns stay; semantics shift:
- `performedAt` becomes nullable — no longer the canonical execution timestamp (sessions track that). Backfilled as the first session's `performedAt` for historical records.
- `status` CHECK widens: `'draft' | 'planned' | 'approved' | 'in_progress' | 'completed' | 'cancelled'`.
  - `approved` → all of step 4 done, no sessions executed yet.
  - `in_progress` → at least one but not all sessions executed.
  - `completed` → final session executed OR closed early via `patient_packages.closedReason`.

Existing fields like `plannedSnapshot`, `consent ref` (via `consent_acceptances.procedureRecordId`), `financialPlan` stay at the plan level.

### `procedure_sessions` — new table

One row per actually-executed session.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `tenantId` | `uuid NOT NULL` | FK → `tenants.id` |
| `procedureRecordId` | `uuid NOT NULL` | FK → `procedure_records.id` (cascade delete) |
| `sessionOrdinal` | `integer NOT NULL` | 1-indexed. Strict order enforced — see "Out-of-order execution" below. |
| `performedAt` | `timestamptz NOT NULL` | |
| `executedBy` | `uuid NOT NULL` | FK → `users.id`. Tracked separately from `procedure_records.practitionerId` because different staff may execute different sessions. |
| `technique` | `text` | |
| `clinicalResponse` | `text` | |
| `adverseEffects` | `text` | |
| `notes` | `text` | |
| `followUpDate` | `date` | |
| `nextSessionObjectives` | `text` | |
| `createdAt` | `timestamptz NOT NULL DEFAULT now()` | |
| `updatedAt` | `timestamptz NOT NULL DEFAULT now()` | |

Indexes: `(procedure_record_id, session_ordinal)` unique; `(tenant_id, performed_at)` for date-range reporting.

### Side tables move to per-session granularity

Each gains a nullable `procedureSessionId` column. New rows from the redesigned execution flow always set it. Existing rows are backfilled during migration (each is linked to the parent's single session row, see Migration).

- `product_applications.procedureSessionId` — products applied in THIS session, with batch numbers per session.
- `photo_assets.procedureSessionId` — pre/post photos per session.
- `face_diagrams.procedureSessionId` — a fresh diagram drawn each session (clinical norm; the previous session's diagram pre-fills as a starting point in the UI).

The `procedureRecordId` columns on these tables stay populated (they identify the plan/line); the new `procedureSessionId` identifies which specific session within the line.

### `consent_acceptances` — unchanged

Patient signs once at step 4 covering the whole plan including all sessions. The existing `consent_acceptances.procedureRecordId` link is the plan-level consent. Per-session sign-off is **not** required.

---

## Atendimento wizard changes

### Step 2 — Procedimentos chooser (augmented)

Three things in one chooser:

1. **Package templates** (left column or top section): list of active `package_templates`. Single-select — clicking one fills the cart with its lines (procedure types + sessionsCount each) and locks them. Click again to remove the package. Bundle price is the template's `defaultPrice`.
2. **Procedure types** (right column / grid below templates): existing multi-select grid grouped by category.
3. **Cart preview** (sticky bottom): per-line rows showing `procedureType × sessions @ R$ price`, an inline `Sessões` numeric input on ad-hoc lines (locked on template-driven lines), and a total with an override field for staff discount.

Pricing math:
- Template subtotal = `template.defaultPrice` (locked, but editable as a single override on the template row).
- Ad-hoc subtotal = `sum(procedureType.defaultPrice × sessions)` for non-template lines.
- Grand total = template subtotal + ad-hoc subtotal, with a final override allowed.

### Step 3 — Planejamento (per-line)

When the cart has multiple lines (template + ad-hoc, or just multi-line ad-hoc), step 3 shows tabs/panels — one per line — each carrying its own face diagram and product plan. Planning data is stored in `procedure_records.plannedSnapshot` per line at finalization.

### Step 4 — Aprovação

Single consent covering all lines of the atendimento. Single financial entry for the grand total. Installments per existing helper.

**On step 4 finalization (the "Aprovar" action):**
1. Compute "is package?" per the rule above.
2. If yes, create one `patient_packages` row.
3. Create N `procedure_records` (one per line) with `status = 'approved'`, `sessionsTotal` = the cart's per-line count, `patientPackageId` = the bundle row (or null for pure-ad-hoc single-session atendimentos), `atendimentoId` = a fresh UUID shared across all of them.
4. Create one `consent_acceptances` referencing each line's procedure_record (one row per line, same content hash).
5. Create one `financial_entries` with installments.

### Step 5 — Execução, picker-based queue

This is the major change. Step 5 stops being a one-shot recording and becomes a **persistent execution dashboard** for the atendimento.

**Picker view (default landing for step 5):**
- Progress summary at the top: `"3 sessões realizadas · 5 restantes"`.
- Per-line section showing every session in order:
  - Skinbooster (Pacote Hidratação) — 4 sessões:
    - `1` ✓ Realizada em 12/05/2026 por Dra. X (clickable → read-only view of `procedure_sessions[1]`)
    - `2` ✓ Realizada em 19/05/2026 por Dra. X
    - `3` **PRÓXIMA — [Executar agora]**
    - `4` Pendente (button disabled — order enforced)
  - Botox (avulso) — 1 sessão:
    - `1` **PRÓXIMA — [Executar agora]**
- "Executar agora" is **only enabled on the lowest-ordinal pending session per line**. All other pending sessions show as disabled with a tooltip "Conclua a sessão anterior primeiro."

**Execution view (clicked into "Executar agora"):**
- The current `ProcedureExecution` UI, scoped to a single `procedure_sessions` row in progress.
- Records: `performedAt` (default now), `technique`, products applied with batch numbers (per-session granularity), face diagram for THIS session (pre-filled from the line's previous session as a starting point), photos, clinical response, adverse effects, notes, next-session objectives, follow-up date.
- "Salvar sessão" → commits the `procedure_sessions` row, increments the line's executed count, returns to the picker.
- "Cancelar" → discards changes, returns to picker.

**After saving a session:**
- The line's session counter advances. If `count_executed == sessionsTotal`, set `procedure_records.status = 'completed'`.
- If every procedure_record in the atendimento is `completed`, also set the `patient_packages.status = 'completed'` (and `closedReason = null`, since it completed naturally).
- The picker re-renders showing the next pending session as "PRÓXIMA".

**Persistence guarantee:**
- Each `procedure_sessions` row is committed independently as it's saved. Closing the atendimento mid-execution loses nothing.
- Returning to the atendimento (via patient profile, package card, deep link) lands at step 5 picker with current state.

### Routing into step 5

- **From patient's Pacotes tab** — "Executar próxima sessão" button on a line: deep-links to `/pacientes/[id]/atendimento?procedure=<recordId>&action=executeNext`. Wizard opens at step 5, picker auto-selects that line's next pending session and immediately enters the execution view.
- **From patient's Procedimentos tab** — clicking a procedure_record with `status IN ('approved', 'in_progress')` opens the wizard at step 5 picker.
- **Completed procedures** — clicking them opens step 5 picker in read-only mode (all sessions visible, "Executar agora" buttons removed; existing sessions are still clickable for inspection).

### Status transitions summary

| Object | Transition | Trigger |
|---|---|---|
| `procedure_records` | `draft → planned` | Step 3 saved with at least one planning entry |
| `procedure_records` | `planned → approved` | Step 4 finalized |
| `procedure_records` | `approved → in_progress` | First `procedure_sessions` row created for the line **AND** `sessionsTotal > 1` |
| `procedure_records` | `approved → completed` (direct) | Single session saved on a line with `sessionsTotal = 1` (ad-hoc) — skips `in_progress` |
| `procedure_records` | `in_progress → completed` | Last pending session saved on a multi-session line |
| `procedure_records` | `→ cancelled` | Existing /cancel route (unchanged) |
| `patient_packages` | `active → completed` | Either: all linked procedure_records reached `completed`, OR "Encerrar pacote" action invoked |
| `patient_packages` | `active → cancelled` | Existing /cancel route (unchanged) |
| `patient_packages` | `active → expired` | Lazy expire on read past `expiresAt` (existing; now also surfaces a UI warning instead of being silent) |

---

## "Encerrar pacote" — early completion

New owner-only action on the patient package card. Opens a small confirm dialog:

> "Encerrar este pacote sem usar as sessões restantes?
> Motivo (obrigatório): [select]
>  - Paciente perdeu a data de validade
>  - Paciente desistiu do tratamento
>  - Outro: [text]
> [Cancelar] [Encerrar pacote]"

On confirm:
- Set `patient_packages.status = 'completed'`, `closedAt = now()`, `closedReason = <selected>`, `closeNote = <text>` only if `closedReason = 'other'`.
- For every linked `procedure_records` still in `approved` or `in_progress`, leave `status` as-is but the picker no longer shows "Executar agora" on pending sessions (the line is gated by the package's terminal state).
- Patient package card shows `"5 de 4 realizadas · pacote encerrado em 28/05/2026"` and the closed reason.
- Existing financial entry stays as-is; refunds (if any) are still handled manually via the existing financial UI.

---

## Expiry warning surface

When a `patient_packages` row has `expiresAt < brToday()`:

- The lazy-expire writeback flips `status` to `'expired'` (existing behavior).
- The patient's Pacotes tab shows an amber badge on the package card: "Pacote vencido em DD/MM/YYYY — sessões ainda podem ser realizadas até o encerramento."
- Step 5's picker shows an amber banner above the lines belonging to that package:
  > "Pacote vencido em DD/MM/YYYY. Você pode continuar executando as sessões restantes ou [Encerrar pacote]."
- Execution buttons are NOT disabled — the warning is informational.

The "Encerrar pacote" button is available from both surfaces.

---

## Things removed

- `SellPackageDialog`, the patient-detail "Vender pacote" button, and `/api/patient-packages` POST route — replaced by the atendimento wizard.
- `/api/patient-packages/[id]/lines/[lineId]/start-session` route and `<PackageCard>`'s "Iniciar próxima sessão" button — both replaced by the step 5 picker.
- `patient_package_lines` table — replaced by `procedure_records` directly.
- `lib/packages.ts:sellPackage()` and `startPackageSession()` helpers — replaced by atendimento-wizard finalization logic and the step 5 picker.
- The current "Pacote X · sessão Y/N" badge in `procedure-page-client.tsx` — replaced by step 5 picker's per-line progress (the badge query computed from `patient_package_lines` no longer applies).

---

## Migration

A single migration file does the data move. All steps are idempotent and safe against partial application.

1. **Add new columns and table:**
   - `procedure_records`: `ADD COLUMN sessionsTotal INTEGER NOT NULL DEFAULT 1`, `ADD COLUMN atendimentoId UUID`. Widen `status` CHECK to include `'in_progress'` and `'completed'` (the existing `'executed'` value stays valid during migration step 2; step 7 removes it after backfill).
   - `patient_packages`: `ADD COLUMN closedAt TIMESTAMPTZ, ADD COLUMN closedReason VARCHAR(50), ADD COLUMN closeNote TEXT`.
   - Create `procedure_sessions` table with the schema above + FK + indexes.
   - `product_applications`: `ADD COLUMN procedureSessionId UUID REFERENCES procedure_sessions(id)`.
   - `photo_assets`: `ADD COLUMN procedureSessionId UUID REFERENCES procedure_sessions(id)`.
   - `face_diagrams`: `ADD COLUMN procedureSessionId UUID REFERENCES procedure_sessions(id)`.
   - Tenant `settings` jsonb: introduce `default_package_validity_months` key (read-only consumers default to null).

2. **Backfill `procedure_sessions` from existing executed `procedure_records`:**
   For each `procedure_records` row with `status = 'executed'`:
   - Insert one `procedure_sessions` row with `sessionOrdinal = 1`, copying `performedAt`, `technique`, `clinicalResponse`, `adverseEffects`, `notes`, `followUpDate`, `nextSessionObjectives`, `practitionerId` → `executedBy`.
   - Then update related rows to point at this new session:
     - `UPDATE product_applications SET procedureSessionId = <new id> WHERE procedure_record_id = <record id>`
     - Same for `photo_assets`, `face_diagrams`.
   - Flip `procedure_records.status` from `'executed'` to `'completed'`.

3. **Backfill `procedure_records.sessionsTotal` from `patient_package_lines`:**
   For each `procedure_records` with `patientPackageLineId IS NOT NULL`, copy the matching line's `sessionsTotal` into `procedure_records.sessionsTotal`.

4. **Backfill `procedure_records.atendimentoId`:**
   For each `procedure_records` with `patientPackageId IS NOT NULL`, set `atendimentoId = patientPackageId` (treat the pre-existing package row as the implicit atendimento grouping).
   For each other `procedure_records`, set `atendimentoId = gen_random_uuid()` (each becomes its own atendimento).

5. **Drop `patient_package_lines`:** after backfill, drop the table. Update the schema.ts.

6. **Existing local data**: per user instruction, OK to break — the prior SellPackageDialog flow's data on the dev DB doesn't need to round-trip cleanly.

7. **Reset old status enum**: the `'executed'` value is removed from the `procedure_records.status` CHECK after step 2 reassigns all such rows to `'completed'`.

---

## Out of scope

- **Per-session pricing** — every package session is included in the bundle price. We don't support "sessions 1–3 free, session 4 extra".
- **Refund automation on encerrar/cancel** — manual financial adjustment via existing financial UI.
- **Session reordering** — sessions execute in strict order. No "swap sessions 2 and 3" UI.
- **Cross-line session ordering** — order is enforced per line, not across lines (executing line A session 1 before line B session 1 is allowed).
- **Auto-scheduling sessions onto the agenda** — sessions are still booked manually via the existing agenda UI.
- **Multi-template per atendimento** — staff books two atendimentos instead.
- **Patient-facing session reminders / per-session WhatsApp templates** — uses existing WhatsApp infra unchanged; per-session messaging is a future feature.
