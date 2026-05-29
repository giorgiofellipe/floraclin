# Package + Atendimento Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-28-package-atendimento-redesign-design.md`

**Goal:** Unify package sales into the atendimento wizard, eliminate the redundant per-session wizard, and introduce a per-session execution model so multi-session lines can be tracked accurately over time.

**Architecture:** `procedure_records` becomes "the plan" (one row per line, durable). A new `procedure_sessions` table holds each executed session (with per-session products, photos, diagram, clinical fields). Step 5 becomes a persistent execution picker. Multiple lines under one atendimento share a `patient_packages` row when any line is multi-session or a template was picked at step 2.

**Tech Stack:** Next.js 15 (App Router), Drizzle (`floraclin` schema, Postgres), React Query, shadcn/ui, Vitest. Brazil-only — date helpers from `@/lib/dates`.

**Branch:** `feat/clinic-feature-pack` (existing worktree).

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `web/src/db/migrations/0015_package_atendimento_redesign.sql` | Schema migration (add columns, table, backfill, drop). |
| `web/src/db/queries/procedure-sessions.ts` | CRUD over `procedure_sessions`. |
| `web/src/lib/atendimento-finalize.ts` | Service: bundles `approve + create patient_package + create procedure_records + create consent + create financial entry` into one transaction. |
| `web/src/lib/session-execute.ts` | Service: creates a session, updates side-table FKs, advances procedure_records/patient_packages status. |
| `web/src/validations/atendimento-cart.ts` | Zod schema for step-2 cart (template + lines + sessions counts + override price). |
| `web/src/validations/procedure-session.ts` | Zod schema for the per-session execution form. |
| `web/src/validations/encerrar-pacote.ts` | Zod schema for the "Encerrar pacote" dialog. |
| `web/src/components/service-wizard/template-chooser.tsx` | Step-2 single-select package-template picker. |
| `web/src/components/service-wizard/wizard-cart.tsx` | Step-2 sticky cart preview with per-line sessions + total override. |
| `web/src/components/procedures/session-picker.tsx` | Step-5 persistent picker showing every session ordinal per line. |
| `web/src/components/procedures/session-execution-form.tsx` | Step-5 single-session execution form (extracted from `procedure-execution.tsx`). |
| `web/src/components/packages/close-package-dialog.tsx` | "Encerrar pacote" confirm dialog. |
| `web/src/app/api/procedures/[id]/sessions/route.ts` | `POST` creates a `procedure_sessions` row + updates status. |
| `web/src/app/api/patient-packages/[id]/close/route.ts` | `POST` invokes "Encerrar pacote". |

### Modified files

| File | Change |
|---|---|
| `web/src/db/schema.ts` | Add `procedureSessions`; add columns to `procedureRecords` (`sessionsTotal`, `atendimentoId`); add `closedAt/closedReason/closeNote` to `patientPackages`; add `procedureSessionId` to `photoAssets`, `productApplications`, `faceDiagrams`; drop `patientPackageLines`. |
| `web/src/db/migrations/meta/_journal.json` | Append `0015` entry. |
| `web/src/db/queries/procedures.ts` | Remove `patientPackageLineId` projections; add `sessionsTotal` and `atendimentoId`; widen status type. |
| `web/src/db/queries/packages.ts` | Refactor `*WithConsumption` to derive line counts from `procedure_records` + `procedure_sessions`, not lines table. |
| `web/src/db/queries/product-applications.ts` | `saveProductApplications` accepts `procedureSessionId`. |
| `web/src/db/queries/face-diagrams.ts` | `saveFaceDiagram` accepts `procedureSessionId`. |
| `web/src/db/queries/photos.ts` | `createPhotoAsset` accepts `procedureSessionId`. |
| `web/src/lib/packages.ts` | Remove `sellPackage`, `startPackageSession`; update `maybeCompletePackageForProcedure` to count from sessions; add `closePackage` helper; keep `computePackageExpiresAt`, `shouldCompletePackage`, `cancelPackage`, `maybeCompletePackage`. |
| `web/src/lib/tenant-settings.ts` (new minimal helper, or inline in existing settings if helper exists) | Expose `getDefaultPackageValidityMonths(settings)`. |
| `web/src/app/api/procedures/[id]/approve/route.ts` | Delegate to `atendimento-finalize`. |
| `web/src/app/api/procedures/[id]/execute/route.ts` | Removed (replaced by `/api/procedures/[id]/sessions`). |
| `web/src/app/api/patient-packages/route.ts` | Remove `POST` handler (old `sellPackage`). Keep `GET` if present. |
| `web/src/app/api/patient-packages/[id]/lines/[lineId]/start-session/route.ts` | Delete file. |
| `web/src/app/api/photos/route.ts` | Accept `procedureSessionId` in form data; pass through. |
| `web/src/app/api/tenant/route.ts` | Accept `_action === 'clinic_settings'` with `defaultPackageValidityMonths` value. |
| `web/src/components/settings/clinic-settings-form.tsx` (if exists) or new under `web/src/components/settings/` | Field for `defaultPackageValidityMonths`. |
| `web/src/components/service-wizard/service-wizard.tsx` | Wire cart state across steps 2–5; pass `atendimentoId` and per-line state down. |
| `web/src/hooks/use-service-wizard.ts` | Extend state: `cart`, `atendimentoId`. Multi-line support. |
| `web/src/components/service-wizard/procedure-type-step.tsx` | Embed template chooser + procedure-type grid + wizard cart; emit cart updates. |
| `web/src/components/procedures/procedure-form.tsx` | Support multi-line planning (tabs/panels per line). |
| `web/src/components/procedures/procedure-approval.tsx` | Show all lines; pass cart to finalize endpoint. |
| `web/src/components/procedures/procedure-execution.tsx` | Replace single-shot form with `<SessionPicker>` + `<SessionExecutionForm>` orchestration. |
| `web/src/components/packages/package-card.tsx` | Remove "Iniciar próxima sessão"; add "Encerrar pacote"; show expiry banner; per-line session progress derived from records + sessions. |
| `web/src/components/packages/patient-packages-tab.tsx` | Remove "Vender pacote" button + SellPackageDialog usage. |
| `web/src/components/packages/sell-package-dialog.tsx` | **Delete file.** |
| `web/src/hooks/queries/use-packages.ts` | Refactor `PatientPackageWithConsumption` shape; remove `useStartPackageSession`, add `useClosePackage`. |
| `web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx` | Replace `PackageBadgeBanner` (badge sourced from `patient_package_lines`) with a session-count badge sourced from `procedure_records.sessionsTotal` + executed session count. |
| `web/src/app/(platform)/pacientes/[id]/atendimento/atendimento-page-client.tsx` | Accept query params `?procedure=<recordId>&action=executeNext` to deep-link into step 5 picker. |
| `web/src/components/procedures/procedure-detail-view.tsx` | If it imports `patientPackageLineId`, remove; redirect navigation to step-5 picker for in-progress lines. |

### Deleted files

- `web/src/components/packages/sell-package-dialog.tsx`
- `web/src/app/api/patient-packages/[id]/lines/[lineId]/start-session/route.ts` (and possibly its parent `lines/` folder)
- `web/src/app/api/procedures/[id]/execute/route.ts` (replaced by `/sessions`)

---

## Parallelization Groups

```
Group A — Foundation (4 parallel tasks)
  A1 migration SQL
  A2 schema.ts
  A3 validations (3 new files)
  A4 tenant settings helper

Group B — Data layer (depends on A; 7 parallel tasks by file)
  B1 procedure-sessions.ts (new)
  B2 procedures.ts
  B3 packages.ts
  B4 lib/packages.ts
  B5 product-applications.ts
  B6 face-diagrams.ts
  B7 photos.ts

Group C — Domain services (depends on B; 2 parallel tasks)
  C1 atendimento-finalize.ts (new)
  C2 session-execute.ts (new)

Group D — API routes (depends on C; 5 parallel tasks)
  D1 approve route refactor
  D2 sessions route (new) + delete execute route
  D3 close pacote route (new)
  D4 photos route accepts procedureSessionId
  D5 tenant route accepts clinic_settings

Group E — Step-2 building blocks (parallel; no shared files)
  E1 wizard-cart.tsx (new)
  E2 template-chooser.tsx (new)

Group F — Wizard state (single task; gates F.B)
  F1 hooks/use-service-wizard.ts

Group F.B — Wizard composition + step UIs (depends on F1, D1, E1, E2; 4 parallel tasks by file)
  F2 service-wizard.tsx
  F3 procedure-type-step.tsx
  F4 procedure-form.tsx
  F5 procedure-approval.tsx

Group G — Step-5 UI (depends on D2; 2 parallel)
  G1 session-picker.tsx (new)
  G2 session-execution-form.tsx (new)
  Then G3 (single, after G1+G2): procedure-execution.tsx wrap

Group H — Package UI tidy (depends on D3 and B3; 6 parallel by file)
  H1 package-card.tsx
  H2 patient-packages-tab.tsx
  H3 use-packages.ts
  H4 procedure-page-client.tsx
  H5 close-package-dialog.tsx (new)
  H6 Delete sell-package-dialog.tsx

Group I — Settings UI (depends on D5; 1 task)
  I1 clinic-settings-form.tsx (modify or create)

Group J — Atendimento page wiring (depends on G3; 1 task)
  J1 atendimento-page-client.tsx

Group K — Cleanup (after all UI no longer references removed routes; 2 parallel)
  K1 Delete /api/patient-packages POST handler
  K2 Delete /api/patient-packages/[id]/lines folder

Group L — Tests (depends on everything else; 7 parallel)
  L1 procedure-sessions.test.ts
  L2 atendimento-finalize.test.ts
  L3 session-execute.test.ts
  L4 lib/packages.test.ts (update)
  L5 session-picker characterization
  L6 session-execution-form characterization
  L7 wizard-cart unit
```

---

# Tasks

---

## Group A — Foundation

### Task A1: Migration SQL (0015_package_atendimento_redesign)

**Files:**
- Create: `web/src/db/migrations/0015_package_atendimento_redesign.sql`
- Modify: `web/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `web/src/db/migrations/0015_package_atendimento_redesign.sql`:

```sql
-- 0015: Package + atendimento redesign.
-- 1. Add new columns/tables.
-- 2. Backfill procedure_sessions from executed procedure_records.
-- 3. Backfill procedure_records.sessionsTotal and atendimentoId.
-- 4. Drop patient_package_lines.
-- 5. Replace 'executed' with 'completed' in procedure_records.status CHECK.

-- ── 1. Schema additions ────────────────────────────────────────────────

-- procedure_records: new columns + widened status CHECK
ALTER TABLE "floraclin"."procedure_records"
  ADD COLUMN IF NOT EXISTS "sessions_total" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "atendimento_id" uuid;--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_status_check";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  ADD CONSTRAINT "procedure_records_status_check"
  CHECK ("status" IN ('draft', 'planned', 'approved', 'in_progress', 'completed', 'cancelled', 'executed'));--> statement-breakpoint
-- 'executed' is included temporarily; step 5 removes it after the backfill.

ALTER TABLE "floraclin"."procedure_records"
  ALTER COLUMN "performed_at" DROP NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_procedure_records_atendimento"
  ON "floraclin"."procedure_records" ("atendimento_id");--> statement-breakpoint

-- patient_packages: new close columns
ALTER TABLE "floraclin"."patient_packages"
  ADD COLUMN IF NOT EXISTS "closed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "closed_reason" varchar(50),
  ADD COLUMN IF NOT EXISTS "close_note" text;--> statement-breakpoint

ALTER TABLE "floraclin"."patient_packages"
  ADD CONSTRAINT "patient_packages_closed_reason_check"
  CHECK ("closed_reason" IS NULL OR "closed_reason" IN ('patient_lost_expiry', 'patient_stopped_treatment', 'other'));--> statement-breakpoint

-- procedure_sessions: new table
CREATE TABLE IF NOT EXISTS "floraclin"."procedure_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "procedure_record_id" uuid NOT NULL REFERENCES "floraclin"."procedure_records"("id") ON DELETE CASCADE,
  "session_ordinal" integer NOT NULL,
  "performed_at" timestamptz NOT NULL,
  "executed_by" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "technique" text,
  "clinical_response" text,
  "adverse_effects" text,
  "notes" text,
  "follow_up_date" date,
  "next_session_objectives" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_procedure_sessions_record_ordinal"
  ON "floraclin"."procedure_sessions" ("procedure_record_id", "session_ordinal");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_procedure_sessions_tenant_performed"
  ON "floraclin"."procedure_sessions" ("tenant_id", "performed_at");--> statement-breakpoint

-- product_applications: link to session
ALTER TABLE "floraclin"."product_applications"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- photo_assets: link to session
ALTER TABLE "floraclin"."photo_assets"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- face_diagrams: link to session
ALTER TABLE "floraclin"."face_diagrams"
  ADD COLUMN IF NOT EXISTS "procedure_session_id" uuid
    REFERENCES "floraclin"."procedure_sessions"("id");--> statement-breakpoint

-- ── 2. Backfill procedure_sessions from executed records ──────────────

INSERT INTO "floraclin"."procedure_sessions" (
  "id", "tenant_id", "procedure_record_id", "session_ordinal",
  "performed_at", "executed_by", "technique", "clinical_response",
  "adverse_effects", "notes", "follow_up_date", "next_session_objectives",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  pr."tenant_id",
  pr."id",
  1, -- ordinal 1 for backfilled rows
  COALESCE(pr."performed_at", pr."created_at"),
  pr."practitioner_id",
  pr."technique",
  pr."clinical_response",
  pr."adverse_effects",
  pr."notes",
  pr."follow_up_date",
  pr."next_session_objectives",
  pr."created_at",
  pr."updated_at"
FROM "floraclin"."procedure_records" pr
WHERE pr."status" = 'executed'
  AND NOT EXISTS (
    SELECT 1 FROM "floraclin"."procedure_sessions" ps
    WHERE ps."procedure_record_id" = pr."id"
  );--> statement-breakpoint

-- Link side tables to the newly-created sessions
UPDATE "floraclin"."product_applications" pa
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE pa."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND pa."procedure_session_id" IS NULL;--> statement-breakpoint

UPDATE "floraclin"."photo_assets" ph
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE ph."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND ph."procedure_session_id" IS NULL;--> statement-breakpoint

UPDATE "floraclin"."face_diagrams" fd
SET "procedure_session_id" = ps."id"
FROM "floraclin"."procedure_sessions" ps
WHERE fd."procedure_record_id" = ps."procedure_record_id"
  AND ps."session_ordinal" = 1
  AND fd."procedure_session_id" IS NULL;--> statement-breakpoint

-- Flip 'executed' to 'completed'
UPDATE "floraclin"."procedure_records"
SET "status" = 'completed'
WHERE "status" = 'executed';--> statement-breakpoint

-- ── 3. Backfill procedure_records.sessions_total from patient_package_lines ──

UPDATE "floraclin"."procedure_records" pr
SET "sessions_total" = COALESCE(ppl."sessions_total", 1)
FROM "floraclin"."patient_package_lines" ppl
WHERE pr."patient_package_line_id" = ppl."id"
  AND pr."patient_package_line_id" IS NOT NULL;--> statement-breakpoint

-- ── 4. Backfill atendimento_id ────────────────────────────────────────

-- Procedures that belonged to a package share that package id as atendimentoId
UPDATE "floraclin"."procedure_records"
SET "atendimento_id" = "patient_package_id"
WHERE "atendimento_id" IS NULL
  AND "patient_package_id" IS NOT NULL;--> statement-breakpoint

-- Every remaining procedure becomes its own atendimento
UPDATE "floraclin"."procedure_records"
SET "atendimento_id" = gen_random_uuid()
WHERE "atendimento_id" IS NULL;--> statement-breakpoint

-- ── 5. Drop patient_package_lines + related FK ────────────────────────

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_patient_package_line_id_patient_package_lines_id_fk";--> statement-breakpoint

DROP INDEX IF EXISTS "floraclin"."idx_procedure_records_package_line";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  DROP COLUMN IF EXISTS "patient_package_line_id";--> statement-breakpoint

DROP TABLE IF EXISTS "floraclin"."patient_package_lines";--> statement-breakpoint

-- ── 6. Remove 'executed' from procedure_records.status CHECK ──────────

ALTER TABLE "floraclin"."procedure_records"
  DROP CONSTRAINT IF EXISTS "procedure_records_status_check";--> statement-breakpoint

ALTER TABLE "floraclin"."procedure_records"
  ADD CONSTRAINT "procedure_records_status_check"
  CHECK ("status" IN ('draft', 'planned', 'approved', 'in_progress', 'completed', 'cancelled'));--> statement-breakpoint
```

- [ ] **Step 2: Append journal entry**

In `web/src/db/migrations/meta/_journal.json`, append after the `0014` entry:

```json
    {
      "idx": 15,
      "version": "7",
      "when": 1780600000000,
      "tag": "0015_package_atendimento_redesign",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply migration locally**

Run: `pnpm --filter @floraclin/web db:migrate`
Expected: migration applies cleanly. If it errors (e.g., on a tenant that already lacks `patient_package_lines`), the `IF EXISTS` guards keep it idempotent.

- [ ] **Step 4: Commit**

```bash
git add web/src/db/migrations/0015_package_atendimento_redesign.sql web/src/db/migrations/meta/_journal.json
git commit -m "db: migration 0015 — procedure sessions + atendimento package redesign"
```

---

### Task A2: schema.ts updates

**Files:**
- Modify: `web/src/db/schema.ts`

- [ ] **Step 1: Update `procedureRecords` table definition**

Replace the existing block at `web/src/db/schema.ts:184-217`:

```ts
export const procedureRecords = floraclinSchema.table('procedure_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  appointmentId: uuid('appointment_id').references(() => appointments.id),
  performedAt: timestamp('performed_at', { withTimezone: true }),
  technique: text('technique'),
  clinicalResponse: text('clinical_response'),
  adverseEffects: text('adverse_effects'),
  notes: text('notes'),
  followUpDate: date('follow_up_date'),
  nextSessionObjectives: text('next_session_objectives'),
  additionalTypeIds: jsonb('additional_type_ids').default([]),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  plannedSnapshot: jsonb('planned_snapshot'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  financialPlan: jsonb('financial_plan'),
  patientPackageId: uuid('patient_package_id').references((): AnyPgColumn => patientPackages.id),
  sessionsTotal: integer('sessions_total').notNull().default(1),
  atendimentoId: uuid('atendimento_id'),
  followupSnoozedUntil: date('followup_snoozed_until'),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_procedure_records_patient').on(table.tenantId, table.patientId),
  index('idx_procedure_records_practitioner').on(table.tenantId, table.practitionerId),
  index('idx_procedure_records_atendimento').on(table.atendimentoId),
  index('idx_procedure_records_followup_status').on(table.tenantId, table.status, table.followupSnoozedUntil),
])
```

Removed: `patientPackageLineId`, `idx_procedure_records_package_line`. Added: `sessionsTotal`, `atendimentoId`, new index. `performedAt` is now nullable.

- [ ] **Step 2: Add procedureSessionId to side tables**

In the `faceDiagrams` block (around line 221), add a column inside the `table(` definition:

```ts
procedureSessionId: uuid('procedure_session_id').references((): AnyPgColumn => procedureSessions.id),
```

Do the same in `photoAssets` (around line 253) and `productApplications` (around line 286).

- [ ] **Step 3: Add `procedureSessions` table**

Insert before the `faceDiagrams` block (right after `procedureRecords` closes at line 217):

```ts
// ─── PROCEDURE SESSIONS ─────────────────────────────────────────────

export const procedureSessions = floraclinSchema.table('procedure_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references((): AnyPgColumn => procedureRecords.id, { onDelete: 'cascade' }),
  sessionOrdinal: integer('session_ordinal').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  executedBy: uuid('executed_by').notNull().references(() => users.id),
  technique: text('technique'),
  clinicalResponse: text('clinical_response'),
  adverseEffects: text('adverse_effects'),
  notes: text('notes'),
  followUpDate: date('follow_up_date'),
  nextSessionObjectives: text('next_session_objectives'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_procedure_sessions_record_ordinal').on(table.procedureRecordId, table.sessionOrdinal),
  index('idx_procedure_sessions_tenant_performed').on(table.tenantId, table.performedAt),
])
```

`procedureRecords` is declared above so `(): AnyPgColumn => procedureRecords.id` resolves at runtime (matches the existing `patientPackages` pattern).

- [ ] **Step 4: Update `patientPackages` table**

In the `patientPackages` block (line 841-860), add inside the column list:

```ts
closedAt: timestamp('closed_at', { withTimezone: true }),
closedReason: varchar('closed_reason', { length: 50 }),
closeNote: text('close_note'),
```

- [ ] **Step 5: Delete `patientPackageLines`**

Remove the entire block at lines 862-872. Search the file for any other reference to `patientPackageLines` (none should remain after migration, but verify).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: typecheck fails because consumers of `patientPackageLines` and the removed `patientPackageLineId` column still reference them. **This is expected and will be fixed by tasks B2, B3, B4, H1, H3, H4.** Note the file paths in failures — they should match the modified-files list above. Do NOT try to fix typecheck here; commit the schema change as-is.

- [ ] **Step 7: Commit**

```bash
git add web/src/db/schema.ts
git commit -m "db(schema): redesign procedure records + procedure sessions + patient packages"
```

---

### Task A3: New validation schemas

**Files:**
- Create: `web/src/validations/atendimento-cart.ts`
- Create: `web/src/validations/procedure-session.ts`
- Create: `web/src/validations/encerrar-pacote.ts`

- [ ] **Step 1: Write `atendimento-cart.ts`**

```ts
import { z } from 'zod'

export const cartLineSchema = z.object({
  procedureTypeId: z.string().uuid(),
  procedureTypeName: z.string().min(1),
  sessions: z.number().int().min(1).max(50),
  defaultPrice: z.number().nonnegative(),
  sourceTemplateLineId: z.string().uuid().nullable(),
})

export const atendimentoCartSchema = z.object({
  templateId: z.string().uuid().nullable(),
  templateName: z.string().nullable(),
  templateDefaultPrice: z.number().nonnegative().nullable(),
  templateValidityMonths: z.number().int().min(1).max(120).nullable(),
  lines: z.array(cartLineSchema).min(1),
  totalOverride: z.number().nonnegative().nullable(),
}).refine(
  (c) => c.lines.length === new Set(c.lines.map((l) => l.procedureTypeId)).size || c.templateId !== null,
  { message: 'Linhas ad-hoc não podem repetir o mesmo procedimento.' }
)

export type AtendimentoCart = z.infer<typeof atendimentoCartSchema>
export type CartLine = z.infer<typeof cartLineSchema>

export function isBundleCart(cart: AtendimentoCart): boolean {
  return cart.templateId !== null || cart.lines.some((l) => l.sessions > 1)
}

export function computeCartTotal(cart: AtendimentoCart): number {
  if (cart.totalOverride !== null) return cart.totalOverride
  const adhocSubtotal = cart.lines
    .filter((l) => l.sourceTemplateLineId === null)
    .reduce((sum, l) => sum + l.defaultPrice * l.sessions, 0)
  const templateSubtotal = cart.templateDefaultPrice ?? 0
  return adhocSubtotal + templateSubtotal
}

export function autoPackageName(cart: AtendimentoCart): string {
  if (cart.templateId !== null && cart.templateName) return cart.templateName
  if (cart.lines.length === 1) {
    const l = cart.lines[0]
    return `Pacote ${l.procedureTypeName} — ${l.sessions} sessões`
  }
  const parts = cart.lines.map((l) => `${l.sessions}× ${l.procedureTypeName}`)
  return `Pacote: ${parts.join(' + ')}`
}
```

- [ ] **Step 2: Write `procedure-session.ts`**

```ts
import { z } from 'zod'

export const procedureSessionFormSchema = z.object({
  performedAt: z.string().min(1, 'Informe a data e hora.'),
  technique: z.string().max(2000).optional().default(''),
  clinicalResponse: z.string().max(2000).optional().default(''),
  adverseEffects: z.string().max(2000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().nullable().optional(),
  nextSessionObjectives: z.string().max(2000).optional().default(''),
})

export type ProcedureSessionFormValues = z.infer<typeof procedureSessionFormSchema>

export const createSessionWireSchema = procedureSessionFormSchema.extend({
  procedureRecordId: z.string().uuid(),
  productApplications: z.array(z.object({
    productName: z.string().min(1),
    activeIngredient: z.string().optional(),
    totalQuantity: z.number().nonnegative(),
    quantityUnit: z.string(),
    batchNumber: z.string().optional(),
    expirationDate: z.string().nullable().optional(),
    applicationAreas: z.string().optional(),
    notes: z.string().optional(),
  })).optional().default([]),
  diagramPoints: z.array(z.object({
    viewType: z.string(),
    points: z.array(z.object({
      x: z.number(),
      y: z.number(),
      productName: z.string(),
      activeIngredient: z.string().optional(),
      quantity: z.number(),
      quantityUnit: z.string(),
      technique: z.string().optional(),
      depth: z.string().optional(),
      notes: z.string().optional(),
      sortOrder: z.number().int(),
    })),
  })).optional().default([]),
  photoAssetIds: z.array(z.string().uuid()).optional().default([]),
})

export type CreateSessionWire = z.infer<typeof createSessionWireSchema>
```

- [ ] **Step 3: Write `encerrar-pacote.ts`**

```ts
import { z } from 'zod'

export const closeReasonValues = ['patient_lost_expiry', 'patient_stopped_treatment', 'other'] as const
export type CloseReason = typeof closeReasonValues[number]

export const closePackageSchema = z.object({
  closedReason: z.enum(closeReasonValues),
  closeNote: z.string().max(1000).optional().default(''),
}).superRefine((data, ctx) => {
  if (data.closedReason === 'other' && data.closeNote.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closeNote'],
      message: 'Descreva o motivo quando selecionar "Outro".',
    })
  }
})

export const closeReasonLabels: Record<CloseReason, string> = {
  patient_lost_expiry: 'Paciente perdeu a data de validade',
  patient_stopped_treatment: 'Paciente desistiu do tratamento',
  other: 'Outro',
}

export type ClosePackageFormValues = z.infer<typeof closePackageSchema>
```

- [ ] **Step 4: Commit**

```bash
git add web/src/validations/atendimento-cart.ts web/src/validations/procedure-session.ts web/src/validations/encerrar-pacote.ts
git commit -m "validations: cart, procedure-session, encerrar-pacote schemas"
```

---

### Task A4: Tenant settings helper

**Files:**
- Create or modify: `web/src/lib/tenant-settings.ts`

- [ ] **Step 1: Check whether a helper already exists**

Run: `ls web/src/lib/tenant-settings.ts 2>/dev/null || echo "missing"`
Run: `grep -rn 'getTenantSettings\|tenantSettings' web/src/lib --include='*.ts' | head -5`

If a tenant settings helper already exists, extend it; otherwise create the file.

- [ ] **Step 2: Write the helper**

If creating a new file, write `web/src/lib/tenant-settings.ts`:

```ts
import { z } from 'zod'

const clinicSettingsSchema = z.object({
  defaultPackageValidityMonths: z.number().int().min(1).max(120).nullable().optional(),
}).passthrough()

export type ClinicSettings = z.infer<typeof clinicSettingsSchema>

export function getDefaultPackageValidityMonths(settings: unknown): number | null {
  const parsed = clinicSettingsSchema.safeParse(settings ?? {})
  if (!parsed.success) return null
  return parsed.data.defaultPackageValidityMonths ?? null
}

export const clinicSettingsKey = 'defaultPackageValidityMonths'
```

If extending an existing file, add the same `getDefaultPackageValidityMonths` function and `clinicSettingsKey` export.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/tenant-settings.ts
git commit -m "lib(tenant-settings): default_package_validity_months helper"
```

---

## Group B — Data layer (depends on A2 schema)

### Task B1: `procedure-sessions` query module

**Files:**
- Create: `web/src/db/queries/procedure-sessions.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/db/queries/__tests__/procedure-sessions.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/db/client'
import { procedureSessions } from '@/db/schema'
import {
  countSessionsForRecord,
  createSession,
  getSessionByOrdinal,
  listSessionsForAtendimento,
  listSessionsForRecord,
} from '../procedure-sessions'

const tenantId = '00000000-0000-0000-0000-000000000001'

describe('procedure-sessions queries', () => {
  beforeEach(async () => {
    await db.delete(procedureSessions)
  })

  it('createSession assigns the next ordinal for the record', async () => {
    const recordId = '00000000-0000-0000-0000-00000000aaaa'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    const first = await createSession({
      tenantId, procedureRecordId: recordId, executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
    })
    const second = await createSession({
      tenantId, procedureRecordId: recordId, executedBy: userId,
      performedAt: new Date('2026-05-08T12:00:00Z'),
    })
    expect(first.sessionOrdinal).toBe(1)
    expect(second.sessionOrdinal).toBe(2)
  })

  it('countSessionsForRecord returns 0 with no sessions', async () => {
    expect(await countSessionsForRecord('00000000-0000-0000-0000-00000000cccc')).toBe(0)
  })
})
```

- [ ] **Step 2: Write the implementation**

```ts
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { procedureRecords, procedureSessions } from '@/db/schema'

export type ProcedureSessionRow = typeof procedureSessions.$inferSelect

export interface CreateSessionInput {
  tenantId: string
  procedureRecordId: string
  executedBy: string
  performedAt: Date
  technique?: string | null
  clinicalResponse?: string | null
  adverseEffects?: string | null
  notes?: string | null
  followUpDate?: string | null
  nextSessionObjectives?: string | null
}

export async function createSession(
  input: CreateSessionInput,
  tx: typeof db = db,
): Promise<ProcedureSessionRow> {
  const [{ nextOrdinal }] = await tx
    .select({ nextOrdinal: sql<number>`COALESCE(MAX(${procedureSessions.sessionOrdinal}), 0) + 1` })
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, input.procedureRecordId))

  const [row] = await tx
    .insert(procedureSessions)
    .values({
      tenantId: input.tenantId,
      procedureRecordId: input.procedureRecordId,
      sessionOrdinal: nextOrdinal,
      performedAt: input.performedAt,
      executedBy: input.executedBy,
      technique: input.technique ?? null,
      clinicalResponse: input.clinicalResponse ?? null,
      adverseEffects: input.adverseEffects ?? null,
      notes: input.notes ?? null,
      followUpDate: input.followUpDate ?? null,
      nextSessionObjectives: input.nextSessionObjectives ?? null,
    })
    .returning()
  return row
}

export async function listSessionsForRecord(
  procedureRecordId: string,
  tx: typeof db = db,
): Promise<ProcedureSessionRow[]> {
  return tx
    .select()
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, procedureRecordId))
    .orderBy(asc(procedureSessions.sessionOrdinal))
}

export async function countSessionsForRecord(
  procedureRecordId: string,
  tx: typeof db = db,
): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, procedureRecordId))
  return n
}

export async function getSessionByOrdinal(
  procedureRecordId: string,
  ordinal: number,
  tx: typeof db = db,
): Promise<ProcedureSessionRow | null> {
  const [row] = await tx
    .select()
    .from(procedureSessions)
    .where(and(
      eq(procedureSessions.procedureRecordId, procedureRecordId),
      eq(procedureSessions.sessionOrdinal, ordinal),
    ))
    .limit(1)
  return row ?? null
}

export async function listSessionsForAtendimento(
  atendimentoId: string,
  tx: typeof db = db,
): Promise<ProcedureSessionRow[]> {
  const recordIds = await tx
    .select({ id: procedureRecords.id })
    .from(procedureRecords)
    .where(eq(procedureRecords.atendimentoId, atendimentoId))
  if (recordIds.length === 0) return []
  return tx
    .select()
    .from(procedureSessions)
    .where(inArray(procedureSessions.procedureRecordId, recordIds.map((r) => r.id)))
    .orderBy(asc(procedureSessions.sessionOrdinal))
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @floraclin/web test:run src/db/queries/__tests__/procedure-sessions.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/db/queries/procedure-sessions.ts web/src/db/queries/__tests__/procedure-sessions.test.ts
git commit -m "db(queries): procedure-sessions module"
```

---

### Task B2: Refactor `db/queries/procedures.ts`

**Files:**
- Modify: `web/src/db/queries/procedures.ts`

- [ ] **Step 1: Remove `patientPackageLineId` references**

Search for every occurrence of `patientPackageLineId` in the file (lines 43, 175, 206, 428, 443 from the audit) and delete them. Also remove the projection from `ProcedureWithDetails`.

- [ ] **Step 2: Add `sessionsTotal` and `atendimentoId` projections**

In every `db.select({...})` that builds a procedure row (lines ~168-210, ~420-440), add:

```ts
sessionsTotal: procedureRecords.sessionsTotal,
atendimentoId: procedureRecords.atendimentoId,
```

And add them to the `ProcedureWithDetails` interface block:

```ts
sessionsTotal: number
atendimentoId: string | null
```

- [ ] **Step 3: Widen the `status` type union**

In every `Status` / `ProcedureStatus` literal that's exported from this module or referenced via `lib/procedure-status.ts`, replace `'executed'` with `'in_progress' | 'completed'`. (See task A2 — schema CHECK already widened.)

- [ ] **Step 4: Add `createProcedureRecord` overload accepting `atendimentoId` + `sessionsTotal`**

In `createProcedure` (line 68+), accept new optional params:

```ts
export async function createProcedure(
  tenantId: string,
  patientId: string,
  practitionerId: string,
  data: {
    procedureTypeId: string
    additionalTypeIds?: string[]
    financialPlan?: unknown
    patientPackageId?: string | null
    sessionsTotal?: number
    atendimentoId?: string | null
    status?: 'draft' | 'planned' | 'approved'
  },
  tx: typeof db = db,
): Promise<ProcedureRow> {
  // ... existing body, mapping sessionsTotal (default 1) and atendimentoId
}
```

Update the insert values accordingly. The callers (atendimento-finalize, task C1) will pass these. Existing call sites that don't pass them remain compatible (defaults).

- [ ] **Step 5: Drop `executeProcedure` from this module**

`executeProcedure` is no longer called — sessions are written through `procedure-sessions.createSession` + `lib/session-execute.ts`. Remove `executeProcedure` and any helper it owns. Leave `approveProcedure`, `cancelProcedure`, `getLatestNonExecutedProcedure`, `listProcedures`, `getProcedure`, etc., intact (adjusting for the column removals above).

Rename `getLatestNonExecutedProcedure` to `getLatestOpenProcedure` and change the status filter from `NOT IN ('executed', 'cancelled')` to `IN ('draft', 'planned', 'approved', 'in_progress')`. Search the repo for callers (`grep -rn 'getLatestNonExecutedProcedure\|useLatestNonExecutedProcedure' web/src`) — they will be updated in subsequent tasks; mark the old name as a deprecated re-export for one task cycle:

```ts
/** @deprecated Use getLatestOpenProcedure */
export const getLatestNonExecutedProcedure = getLatestOpenProcedure
```

- [ ] **Step 6: Typecheck this file**

```bash
pnpm --filter @floraclin/web typecheck
```

The file itself should compile. Errors in other files (use-packages, package-card, etc.) are expected and addressed in later groups.

- [ ] **Step 7: Commit**

```bash
git add web/src/db/queries/procedures.ts
git commit -m "db(queries): procedures — atendimentoId, sessionsTotal, drop lineId, drop executeProcedure"
```

---

### Task B3: Refactor `db/queries/packages.ts`

**Files:**
- Modify: `web/src/db/queries/packages.ts`

- [ ] **Step 1: Remove the `patientPackageLines` import**

Delete `patientPackageLines` from the `import` statement at line 6 (now-removed table).

- [ ] **Step 2: Replace `PatientPackageLineWithConsumption` with record-based shape**

The new `PatientPackageWithConsumption` should expose `records` instead of `lines`:

```ts
export interface PatientPackageRecordWithConsumption {
  procedureRecordId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsTotal: number
  sessionsExecuted: number
}

export interface PatientPackageWithConsumption {
  id: string
  tenantId: string
  patientId: string
  templateId: string | null
  name: string
  totalAmount: string
  purchasedAt: string
  expiresAt: string | null
  status: string
  cancelledAt: Date | null
  cancelReason: string | null
  closedAt: Date | null
  closedReason: string | null
  closeNote: string | null
  financialEntryId: string
  soldBy: string
  records: PatientPackageRecordWithConsumption[]
}
```

Drop `PatientPackageLineWithConsumption`.

- [ ] **Step 3: Refactor `getPatientPackagesWithConsumption`**

Replace the `patient_package_lines` join with two queries:

1. Fetch `patient_packages` rows for the patient.
2. Fetch `procedure_records` where `patientPackageId IN (...)`, joining `procedure_types` for the name and counting sessions via `procedure_sessions`:

```ts
import { procedureSessions } from '@/db/schema'

const records = await db
  .select({
    id: procedureRecords.id,
    patientPackageId: procedureRecords.patientPackageId,
    procedureTypeId: procedureRecords.procedureTypeId,
    procedureTypeName: procedureTypes.name,
    sessionsTotal: procedureRecords.sessionsTotal,
    sessionsExecuted: sql<number>`(
      SELECT COUNT(*)::int FROM floraclin.procedure_sessions ps
      WHERE ps.procedure_record_id = ${procedureRecords.id}
    )`,
  })
  .from(procedureRecords)
  .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
  .where(and(
    inArray(procedureRecords.patientPackageId, packageIds),
    isNull(procedureRecords.deletedAt),
  ))
```

Group records by `patientPackageId` into the returned array.

- [ ] **Step 4: Update `getPatientPackage` (single)**

Apply the same refactor: fetch one package, then its records.

- [ ] **Step 5: Add `closePackage` query function**

```ts
import { closeReasonValues } from '@/validations/encerrar-pacote'
import type { CloseReason } from '@/validations/encerrar-pacote'

export async function closePackageQuery(
  tenantId: string,
  packageId: string,
  args: { closedReason: CloseReason; closeNote: string | null },
  tx: typeof db = db,
): Promise<void> {
  await tx
    .update(patientPackages)
    .set({
      status: 'completed',
      closedAt: new Date(),
      closedReason: args.closedReason,
      closeNote: args.closedReason === 'other' ? args.closeNote : null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(patientPackages.tenantId, tenantId),
      eq(patientPackages.id, packageId),
    ))
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Failures in lib/packages.ts, hooks/use-packages.ts, components/packages/* are expected.

- [ ] **Step 7: Commit**

```bash
git add web/src/db/queries/packages.ts
git commit -m "db(queries): packages — drop lines, derive consumption from procedure_sessions"
```

---

### Task B4: Refactor `lib/packages.ts`

**Files:**
- Modify: `web/src/lib/packages.ts`

- [ ] **Step 1: Remove obsolete functions**

Delete the entire `sellPackage` function (lines ~46-178) and `startPackageSession` function (lines ~180-289). Also delete the helper query at line 397 that scans `patient_package_lines` for line consumption (replaced by session-counting in `db/queries/packages.ts`).

Remove the `patientPackageLines` import (line 5).

- [ ] **Step 2: Update `maybeCompletePackageForProcedure` to count sessions**

The current function compares `lines.sessionsTotal` to executed `procedure_records.status = 'executed'` count. Rewrite it to:

1. Fetch all `procedure_records` for the package's `patientPackageId`.
2. For each, count `procedure_sessions` rows.
3. The package is complete iff for every record, `sessionsExecuted >= sessionsTotal`.

```ts
export async function maybeCompletePackageForProcedure(
  tenantId: string,
  procedureRecordId: string,
  tx: typeof db = db,
): Promise<void> {
  const [record] = await tx
    .select({ patientPackageId: procedureRecords.patientPackageId })
    .from(procedureRecords)
    .where(eq(procedureRecords.id, procedureRecordId))
    .limit(1)
  if (!record?.patientPackageId) return
  await maybeCompletePackage(tenantId, record.patientPackageId, tx)
}

export async function maybeCompletePackage(
  tenantId: string,
  packageId: string,
  tx: typeof db = db,
): Promise<boolean> {
  const records = await tx
    .select({
      id: procedureRecords.id,
      sessionsTotal: procedureRecords.sessionsTotal,
    })
    .from(procedureRecords)
    .where(and(
      eq(procedureRecords.tenantId, tenantId),
      eq(procedureRecords.patientPackageId, packageId),
      isNull(procedureRecords.deletedAt),
    ))
  if (records.length === 0) return false

  for (const r of records) {
    const [{ n }] = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(procedureSessions)
      .where(eq(procedureSessions.procedureRecordId, r.id))
    if (n < r.sessionsTotal) return false
  }

  await tx
    .update(patientPackages)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(
      eq(patientPackages.tenantId, tenantId),
      eq(patientPackages.id, packageId),
      eq(patientPackages.status, 'active'),
    ))
  return true
}
```

`shouldCompletePackage` can be removed or kept as a pure helper that operates on the in-memory `records` array if tests rely on it; if no consumers, delete it.

- [ ] **Step 3: Add `closePackage` action helper (audit + side effects)**

```ts
import { createAuditLog } from '@/lib/audit'
import { closePackageQuery } from '@/db/queries/packages'
import type { CloseReason } from '@/validations/encerrar-pacote'

export async function closePackage(args: {
  tenantId: string
  userId: string
  packageId: string
  closedReason: CloseReason
  closeNote: string | null
}, tx: typeof db = db): Promise<void> {
  await closePackageQuery(args.tenantId, args.packageId, {
    closedReason: args.closedReason,
    closeNote: args.closeNote,
  }, tx)
  await createAuditLog({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'update',
    entityType: 'patient_package',
    entityId: args.packageId,
    changes: { closedReason: { old: null, new: args.closedReason } },
  }, tx)
}
```

- [ ] **Step 4: Keep `computePackageExpiresAt` and `cancelPackage`**

Adjust `computePackageExpiresAt` signature only if necessary. The function should now also accept `null` validity (tenant setting null → returns `null` for expiry).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

The file should now compile. Hooks (use-packages) still fail — that's group H.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/packages.ts
git commit -m "lib(packages): drop sellPackage/startSession, sessions-driven completion, add closePackage"
```

---

### Task B5: `db/queries/product-applications.ts` accepts `procedureSessionId`

**Files:**
- Modify: `web/src/db/queries/product-applications.ts`

- [ ] **Step 1: Add `procedureSessionId` parameter to `saveProductApplications`**

The existing signature replaces all applications for a `procedureRecordId`. Replace it with a per-session signature:

```ts
export async function saveProductApplicationsForSession(
  tenantId: string,
  procedureRecordId: string,
  procedureSessionId: string,
  applications: Array<{ /* same shape as today */ }>,
  tx: typeof db = db,
): Promise<void> {
  // Delete only rows for THIS session, then insert.
  await tx.delete(productApplications).where(
    and(
      eq(productApplications.tenantId, tenantId),
      eq(productApplications.procedureSessionId, procedureSessionId),
    ),
  )
  if (applications.length === 0) return
  await tx.insert(productApplications).values(
    applications.map((a) => ({
      tenantId,
      procedureRecordId,
      procedureSessionId,
      ...a,
    })),
  )
}
```

Keep the existing `saveProductApplications(tenantId, procedureRecordId, applications, tx)` for backward compatibility during migration — wire it to call `saveProductApplicationsForSession` with `procedureSessionId = null` for the rare legacy callers. **Actually,** the simpler path: rename `saveProductApplications` → `saveProductApplicationsForSession`, force callers to pass session id, and delete the legacy signature after the execute route is gone (task D2).

- [ ] **Step 2: Update list helper if present**

If a `listProductApplicationsForRecord` exists, add a `listProductApplicationsForSession` that filters by `procedureSessionId`. Keep the record-scoped list for read-side aggregation (badge "X products applied across all sessions").

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add web/src/db/queries/product-applications.ts
git commit -m "db(queries): product-applications — per-session granularity"
```

---

### Task B6: `db/queries/face-diagrams.ts` accepts `procedureSessionId`

**Files:**
- Modify: `web/src/db/queries/face-diagrams.ts`

- [ ] **Step 1: Change the upsert key from `(procedureRecordId, viewType)` to `(procedureSessionId, viewType)`**

The existing schema unique constraint `uq_face_diagrams_record_view` becomes `(procedureSessionId, viewType)` semantically — but we do not change the SQL constraint (migration kept the existing index). Instead, when saving a diagram, scope it to the current session:

```ts
export async function saveFaceDiagramForSession(
  tenantId: string,
  procedureRecordId: string,
  procedureSessionId: string,
  viewType: 'front' | 'left' | 'right',
  points: Array<{ /* existing shape */ }>,
  tx: typeof db = db,
): Promise<{ diagramId: string }> {
  // Look up or create the diagram row for THIS session+view
  const [existing] = await tx
    .select({ id: faceDiagrams.id })
    .from(faceDiagrams)
    .where(and(
      eq(faceDiagrams.procedureSessionId, procedureSessionId),
      eq(faceDiagrams.viewType, viewType),
    ))
    .limit(1)

  let diagramId: string
  if (existing) {
    diagramId = existing.id
    await tx.delete(diagramPoints).where(eq(diagramPoints.faceDiagramId, diagramId))
  } else {
    const [created] = await tx.insert(faceDiagrams).values({
      tenantId, procedureRecordId, procedureSessionId, viewType,
    }).returning({ id: faceDiagrams.id })
    diagramId = created.id
  }

  if (points.length > 0) {
    await tx.insert(diagramPoints).values(
      points.map((p) => ({ tenantId, faceDiagramId: diagramId, ...p })),
    )
  }
  return { diagramId }
}
```

- [ ] **Step 2: Add `listDiagramsForSession`**

```ts
export async function listDiagramsForSession(
  procedureSessionId: string,
  tx: typeof db = db,
): Promise<Array<typeof faceDiagrams.$inferSelect>> {
  return tx
    .select()
    .from(faceDiagrams)
    .where(eq(faceDiagrams.procedureSessionId, procedureSessionId))
}
```

- [ ] **Step 3: Keep `listDiagramsForRecord` for read-side use**

Step-5 picker uses the last session's diagram as a starting point — exposed by `listDiagramsForRecord(procedureRecordId)` ordered by session ordinal DESC.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/db/queries/face-diagrams.ts
git commit -m "db(queries): face-diagrams — per-session diagram upsert"
```

---

### Task B7: `db/queries/photos.ts` accepts `procedureSessionId`

**Files:**
- Modify: `web/src/db/queries/photos.ts`

- [ ] **Step 1: Extend `createPhotoAsset` input**

Add an optional `procedureSessionId: string | null` field; persist into the new column.

- [ ] **Step 2: Add `listPhotosForSession`**

```ts
export async function listPhotosForSession(
  tenantId: string,
  procedureSessionId: string,
  tx: typeof db = db,
): Promise<PhotoAssetWithUrl[]> {
  // ... select photo_assets where procedureSessionId = ?
}
```

- [ ] **Step 3: Keep `listPhotos(tenantId, patientId, procedureRecordId?)` unchanged for the patient timeline aggregation.**

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/db/queries/photos.ts
git commit -m "db(queries): photos — procedureSessionId on createPhotoAsset"
```

---

## Group C — Domain services (depends on B)

### Task C1: `lib/atendimento-finalize.ts`

**Files:**
- Create: `web/src/lib/atendimento-finalize.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/__tests__/atendimento-finalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { financialEntries, patientPackages, procedureRecords } from '@/db/schema'
import { finalizeAtendimento } from '../atendimento-finalize'
import { eq } from 'drizzle-orm'

const tenantId = '00000000-0000-0000-0000-000000000001'
const patientId = '00000000-0000-0000-0000-000000000002'
const practitionerId = '00000000-0000-0000-0000-000000000003'

describe('finalizeAtendimento', () => {
  it('creates a package row when any line is multi-session', async () => {
    const cart = {
      templateId: null,
      templateName: null,
      templateDefaultPrice: null,
      templateValidityMonths: null,
      lines: [{
        procedureTypeId: '00000000-0000-0000-0000-000000000aaa',
        procedureTypeName: 'Skinbooster',
        sessions: 4,
        defaultPrice: 400,
        sourceTemplateLineId: null,
      }],
      totalOverride: null,
    }
    const result = await finalizeAtendimento({
      tenantId, patientId, practitionerId,
      cart,
      financialPlan: { totalAmount: '1600.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })
    expect(result.patientPackageId).not.toBeNull()
    expect(result.procedureRecordIds).toHaveLength(1)

    const [pkg] = await db.select().from(patientPackages).where(eq(patientPackages.id, result.patientPackageId!))
    expect(pkg.name).toBe('Pacote Skinbooster — 4 sessões')
  })

  it('skips package row for a single ad-hoc session', async () => {
    const cart = {
      templateId: null,
      templateName: null,
      templateDefaultPrice: null,
      templateValidityMonths: null,
      lines: [{
        procedureTypeId: '00000000-0000-0000-0000-000000000bbb',
        procedureTypeName: 'Botox',
        sessions: 1,
        defaultPrice: 800,
        sourceTemplateLineId: null,
      }],
      totalOverride: null,
    }
    const result = await finalizeAtendimento({
      tenantId, patientId, practitionerId, cart,
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })
    expect(result.patientPackageId).toBeNull()
    expect(result.procedureRecordIds).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Implement**

```ts
import { db } from '@/db/client'
import { patientPackages, procedureRecords, consentAcceptances, financialEntries } from '@/db/schema'
import { autoPackageName, computeCartTotal, isBundleCart, type AtendimentoCart } from '@/validations/atendimento-cart'
import { computePackageExpiresAt } from '@/lib/packages'
import { brToday } from '@/lib/dates'
import { addMonths } from 'date-fns'
import { toLocalYmd } from '@/lib/dates'
import { createAuditLog } from '@/lib/audit'

export interface FinalizeAtendimentoInput {
  tenantId: string
  patientId: string
  practitionerId: string
  cart: AtendimentoCart
  financialPlan: { totalAmount: string; installmentCount: number; paymentMethod: string; notes?: string }
  consents: Array<{ consentTemplateId: string; signatureData: string; contentSnapshot: string; contentHash: string; acceptanceMethod: string }>
  tenantDefaultValidityMonths?: number | null
}

export interface FinalizeAtendimentoResult {
  atendimentoId: string
  patientPackageId: string | null
  procedureRecordIds: string[]
  financialEntryId: string
}

export async function finalizeAtendimento(
  input: FinalizeAtendimentoInput,
  outerTx?: typeof db,
): Promise<FinalizeAtendimentoResult> {
  const run = async (tx: typeof db): Promise<FinalizeAtendimentoResult> => {
    const atendimentoId = crypto.randomUUID()
    const isBundle = isBundleCart(input.cart)
    const total = computeCartTotal(input.cart)

    // 1. Financial entry
    const [feRow] = await tx.insert(financialEntries).values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      kind: 'income',
      category: isBundle ? 'package' : 'procedure',
      amount: total.toFixed(2),
      paymentMethod: input.financialPlan.paymentMethod,
      installmentCount: input.financialPlan.installmentCount,
      notes: input.financialPlan.notes ?? null,
      createdAt: new Date(),
    }).returning({ id: financialEntries.id })

    // 2. Optional package row
    let patientPackageId: string | null = null
    if (isBundle) {
      const validityMonths = input.cart.templateValidityMonths ?? input.tenantDefaultValidityMonths ?? null
      const expiresAt = validityMonths
        ? toLocalYmd(addMonths(new Date(), validityMonths))
        : null
      const [pkgRow] = await tx.insert(patientPackages).values({
        tenantId: input.tenantId,
        patientId: input.patientId,
        templateId: input.cart.templateId,
        name: autoPackageName(input.cart),
        totalAmount: total.toFixed(2),
        purchasedAt: brToday(),
        expiresAt,
        status: 'active',
        financialEntryId: feRow.id,
        soldBy: input.practitionerId,
      }).returning({ id: patientPackages.id })
      patientPackageId = pkgRow.id
    }

    // 3. procedure_records
    const procedureRecordIds: string[] = []
    for (const line of input.cart.lines) {
      const [pr] = await tx.insert(procedureRecords).values({
        tenantId: input.tenantId,
        patientId: input.patientId,
        practitionerId: input.practitionerId,
        procedureTypeId: line.procedureTypeId,
        status: 'approved',
        approvedAt: new Date(),
        sessionsTotal: line.sessions,
        atendimentoId,
        patientPackageId,
        financialPlan: input.financialPlan,
      }).returning({ id: procedureRecords.id })
      procedureRecordIds.push(pr.id)
    }

    // 4. Consents — one row per procedure_record, sharing the same hash/snapshot
    for (const recordId of procedureRecordIds) {
      for (const consent of input.consents) {
        await tx.insert(consentAcceptances).values({
          tenantId: input.tenantId,
          patientId: input.patientId,
          consentTemplateId: consent.consentTemplateId,
          procedureRecordId: recordId,
          acceptanceMethod: consent.acceptanceMethod,
          signatureData: consent.signatureData,
          contentHash: consent.contentHash,
          contentSnapshot: consent.contentSnapshot,
          acceptedAt: new Date(),
        })
      }
    }

    await createAuditLog({
      tenantId: input.tenantId,
      userId: input.practitionerId,
      action: 'create',
      entityType: 'atendimento',
      entityId: atendimentoId,
      changes: {
        patientPackageId: { old: null, new: patientPackageId },
        procedureRecords: { old: [], new: procedureRecordIds },
      },
    }, tx)

    return {
      atendimentoId,
      patientPackageId,
      procedureRecordIds,
      financialEntryId: feRow.id,
    }
  }

  if (outerTx) return run(outerTx)
  return db.transaction(run)
}
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @floraclin/web test:run src/lib/__tests__/atendimento-finalize.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/atendimento-finalize.ts web/src/lib/__tests__/atendimento-finalize.test.ts
git commit -m "lib(atendimento-finalize): create package + records + consent + financial in one tx"
```

---

### Task C2: `lib/session-execute.ts`

**Files:**
- Create: `web/src/lib/session-execute.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/__tests__/session-execute.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { procedureRecords, procedureSessions, patientPackages } from '@/db/schema'
import { executeSession } from '../session-execute'
import { eq } from 'drizzle-orm'

const seed = async () => { /* fixture creating a 2-session procedure_record + package */ }

describe('executeSession', () => {
  it('flips approved → in_progress after first session of a multi-session line', async () => {
    const { recordId } = await seed()
    await executeSession({ /* args */ })
    const [r] = await db.select().from(procedureRecords).where(eq(procedureRecords.id, recordId))
    expect(r.status).toBe('in_progress')
  })
  it('flips approved → completed (direct) for a single-session line', async () => { /* ... */ })
  it('flips in_progress → completed after last session', async () => { /* ... */ })
  it('flips patient_package to completed when every line is completed', async () => { /* ... */ })
})
```

- [ ] **Step 2: Implement**

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { procedureRecords } from '@/db/schema'
import { createSession, countSessionsForRecord, type CreateSessionInput } from '@/db/queries/procedure-sessions'
import { saveProductApplicationsForSession } from '@/db/queries/product-applications'
import { saveFaceDiagramForSession } from '@/db/queries/face-diagrams'
import { maybeCompletePackage } from '@/lib/packages'
import { createAuditLog } from '@/lib/audit'

export interface ExecuteSessionInput extends CreateSessionInput {
  productApplications?: Array<Parameters<typeof saveProductApplicationsForSession>[3][number]>
  diagrams?: Array<{ viewType: 'front' | 'left' | 'right'; points: Array<any> }>
  photoAssetIds?: string[]
  performedBy: string
}

export async function executeSession(
  input: ExecuteSessionInput,
  outerTx?: typeof db,
): Promise<{ sessionId: string; recordStatus: string; packageCompleted: boolean }> {
  const run = async (tx: typeof db) => {
    const session = await createSession({
      tenantId: input.tenantId,
      procedureRecordId: input.procedureRecordId,
      executedBy: input.executedBy,
      performedAt: input.performedAt,
      technique: input.technique,
      clinicalResponse: input.clinicalResponse,
      adverseEffects: input.adverseEffects,
      notes: input.notes,
      followUpDate: input.followUpDate,
      nextSessionObjectives: input.nextSessionObjectives,
    }, tx)

    if (input.productApplications?.length) {
      await saveProductApplicationsForSession(
        input.tenantId, input.procedureRecordId, session.id,
        input.productApplications, tx,
      )
    }
    for (const diagram of input.diagrams ?? []) {
      await saveFaceDiagramForSession(
        input.tenantId, input.procedureRecordId, session.id,
        diagram.viewType, diagram.points, tx,
      )
    }
    // Photos are uploaded separately and already point at procedureSessionId via the upload route.

    // Status transitions
    const [record] = await tx.select({
      sessionsTotal: procedureRecords.sessionsTotal,
      status: procedureRecords.status,
      patientPackageId: procedureRecords.patientPackageId,
    }).from(procedureRecords).where(eq(procedureRecords.id, input.procedureRecordId)).limit(1)

    const sessionsDone = await countSessionsForRecord(input.procedureRecordId, tx)
    let nextStatus = record.status
    if (sessionsDone >= record.sessionsTotal) nextStatus = 'completed'
    else if (record.status === 'approved') nextStatus = 'in_progress'

    if (nextStatus !== record.status) {
      await tx.update(procedureRecords)
        .set({ status: nextStatus, performedAt: session.performedAt, updatedAt: new Date() })
        .where(eq(procedureRecords.id, input.procedureRecordId))
    } else if (record.status === 'approved' && record.sessionsTotal === 1) {
      // single-session direct-to-completed handled above (sessionsDone===sessionsTotal)
    }

    let packageCompleted = false
    if (record.patientPackageId) {
      packageCompleted = await maybeCompletePackage(input.tenantId, record.patientPackageId, tx)
    }

    await createAuditLog({
      tenantId: input.tenantId,
      userId: input.executedBy,
      action: 'create',
      entityType: 'procedure_session',
      entityId: session.id,
      changes: { sessionOrdinal: { old: null, new: session.sessionOrdinal } },
    }, tx)

    return { sessionId: session.id, recordStatus: nextStatus, packageCompleted }
  }
  return outerTx ? run(outerTx) : db.transaction(run)
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @floraclin/web test:run src/lib/__tests__/session-execute.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/session-execute.ts web/src/lib/__tests__/session-execute.test.ts
git commit -m "lib(session-execute): create session + advance record/package status"
```

---

## Group D — API routes (depends on C)

### Task D1: Approve route refactor

**Files:**
- Modify: `web/src/app/api/procedures/[id]/approve/route.ts`

- [ ] **Step 1: Read current handler**

```bash
cat web/src/app/api/procedures/[id]/approve/route.ts
```

The current handler approves a single procedure. The new handler approves the whole cart.

- [ ] **Step 2: Decide entry-point shape**

Keep the same URL `POST /api/procedures/[id]/approve` to minimize client churn. The `[id]` becomes the **first-draft procedure record id** the wizard created in step 3. The request body now carries the full cart and consent payloads:

```ts
const requestSchema = z.object({
  cart: atendimentoCartSchema,
  financialPlan: z.object({ /* same as today */ }),
  consents: z.array(z.object({ /* same as today */ })),
})
```

- [ ] **Step 3: Replace the handler body**

```ts
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const draftRecordId = (await params).id
    const body = requestSchema.parse(await request.json())

    // 1. Look up tenant settings for default validity
    const tenant = await getTenantSettings(ctx.tenantId)

    // 2. Cancel the draft record (we re-create a clean set inside finalizeAtendimento)
    await cancelProcedureSilently(ctx.tenantId, draftRecordId)

    // 3. Run finalize
    const result = await finalizeAtendimento({
      tenantId: ctx.tenantId,
      patientId: /* fetched from draft */,
      practitionerId: ctx.userId,
      cart: body.cart,
      financialPlan: body.financialPlan,
      consents: body.consents,
      tenantDefaultValidityMonths: getDefaultPackageValidityMonths(tenant.settings),
    })

    return NextResponse.json({ success: true, data: result })
  } catch (e) { /* standard error mapping */ }
}
```

`cancelProcedureSilently` is an internal helper inside this route file — it deletes (or marks `cancelled`) the placeholder draft.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/api/procedures/[id]/approve/route.ts
git commit -m "api(procedures/approve): delegate to atendimento-finalize"
```

---

### Task D2: Sessions API + delete execute route

**Files:**
- Create: `web/src/app/api/procedures/[id]/sessions/route.ts`
- Delete: `web/src/app/api/procedures/[id]/execute/route.ts`

- [ ] **Step 1: Write sessions route**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { executeSession } from '@/lib/session-execute'
import { createSessionWireSchema } from '@/validations/procedure-session'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const recordId = (await params).id
    const body = createSessionWireSchema.parse(await request.json())

    const result = await executeSession({
      tenantId: ctx.tenantId,
      procedureRecordId: recordId,
      executedBy: ctx.userId,
      performedAt: new Date(body.performedAt),
      technique: body.technique || null,
      clinicalResponse: body.clinicalResponse || null,
      adverseEffects: body.adverseEffects || null,
      notes: body.notes || null,
      followUpDate: body.followUpDate ?? null,
      nextSessionObjectives: body.nextSessionObjectives || null,
      productApplications: body.productApplications,
      diagrams: body.diagramPoints?.map((d) => ({ viewType: d.viewType as 'front' | 'left' | 'right', points: d.points })),
      photoAssetIds: body.photoAssetIds,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Create session error:', error)
    return NextResponse.json({ success: false, error: 'Erro ao salvar sessão' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Delete execute route**

```bash
rm web/src/app/api/procedures/[id]/execute/route.ts
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

The hook `useExecuteProcedure` should fail (it POSTs to `/execute`). Update it in task G3.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/procedures/[id]/sessions/route.ts
git rm web/src/app/api/procedures/[id]/execute/route.ts
git commit -m "api(procedures): replace /execute with /sessions"
```

---

### Task D3: Close pacote API

**Files:**
- Create: `web/src/app/api/patient-packages/[id]/close/route.ts`

- [ ] **Step 1: Write handler**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { closePackage } from '@/lib/packages'
import { closePackageSchema } from '@/validations/encerrar-pacote'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner')
    const packageId = (await params).id
    const body = closePackageSchema.parse(await request.json())

    await closePackage({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      packageId,
      closedReason: body.closedReason,
      closeNote: body.closeNote || null,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Close package error:', error)
    return NextResponse.json({ success: false, error: 'Erro ao encerrar pacote' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/patient-packages/[id]/close/route.ts
git commit -m "api(patient-packages): close (encerrar) route"
```

---

### Task D4: Photos route accepts `procedureSessionId`

**Files:**
- Modify: `web/src/app/api/photos/route.ts`
- Modify: `web/src/validations/photo.ts`

- [ ] **Step 1: Extend `uploadPhotoSchema`**

In `web/src/validations/photo.ts`, add `procedureSessionId: z.string().uuid().optional()`.

- [ ] **Step 2: Pass `procedureSessionId` through `POST`**

In `web/src/app/api/photos/route.ts:49-54`, include `procedureSessionId: formData.get('procedureSessionId') || undefined` in the safeParse object. In the `createPhotoAsset` call (line 79-89), pass `procedureSessionId`.

- [ ] **Step 3: Commit**

```bash
git add web/src/validations/photo.ts web/src/app/api/photos/route.ts
git commit -m "api(photos): accept procedureSessionId in upload"
```

---

### Task D5: Tenant route accepts `clinic_settings`

**Files:**
- Modify: `web/src/app/api/tenant/route.ts`

- [ ] **Step 1: Add a new action handler**

Following the existing `_action === 'whatsapp_settings'` pattern (line 37), add a branch:

```ts
if (body._action === 'clinic_settings') {
  const parsed = z.object({
    defaultPackageValidityMonths: z.number().int().min(1).max(120).nullable(),
  }).safeParse(body.settings)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  // Merge into tenants.settings JSONB
  await db.update(tenants)
    .set({ settings: sql`COALESCE(${tenants.settings}, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb`, updatedAt: new Date() })
    .where(eq(tenants.id, ctx.tenantId))
  await createAuditLog({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'update', entityType: 'tenant', entityId: ctx.tenantId, changes: { clinicSettings: { old: null, new: 'updated' } } })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/tenant/route.ts
git commit -m "api(tenant): clinic_settings action — defaultPackageValidityMonths"
```

---

## Group E — Step-2 building blocks

### Task E1: `<WizardCart>` component

**Files:**
- Create: `web/src/components/service-wizard/wizard-cart.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { type AtendimentoCart, computeCartTotal } from '@/validations/atendimento-cart'
import { formatBRL } from '@/lib/format'

interface WizardCartProps {
  cart: AtendimentoCart
  onChange: (next: AtendimentoCart) => void
  onRemoveLine: (procedureTypeId: string) => void
  onClearTemplate: () => void
}

export function WizardCart({ cart, onChange, onRemoveLine, onClearTemplate }: WizardCartProps) {
  const total = computeCartTotal(cart)
  return (
    <Card className="sticky bottom-4 border-primary/20">
      <CardContent className="p-4 space-y-3">
        {cart.templateId && (
          <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
            <div>
              <div className="text-sm font-medium">{cart.templateName}</div>
              <div className="text-xs text-muted-foreground">Pacote · {formatBRL(cart.templateDefaultPrice ?? 0)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClearTemplate}>Remover</Button>
          </div>
        )}
        <ul className="space-y-2">
          {cart.lines.map((line) => (
            <li key={line.procedureTypeId} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{line.procedureTypeName}</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={line.sessions}
                disabled={line.sourceTemplateLineId !== null}
                className="w-20"
                onChange={(e) => {
                  const sessions = Math.max(1, Number(e.target.value) || 1)
                  onChange({ ...cart, lines: cart.lines.map((l) => l.procedureTypeId === line.procedureTypeId ? { ...l, sessions } : l) })
                }}
              />
              <span className="w-24 text-right text-sm">{formatBRL(line.defaultPrice * line.sessions)}</span>
              {line.sourceTemplateLineId === null && (
                <Button variant="ghost" size="icon" onClick={() => onRemoveLine(line.procedureTypeId)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <Input
            type="number"
            min={0}
            value={cart.totalOverride ?? total}
            className="w-32 text-right"
            onChange={(e) => {
              const v = e.target.value
              onChange({ ...cart, totalOverride: v === '' ? null : Math.max(0, Number(v)) })
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
```

(`formatBRL` already exists — verify with `grep -n 'formatBRL' web/src/lib/format.ts`. If not, import from wherever the codebase formats currency.)

- [ ] **Step 2: Commit**

```bash
git add web/src/components/service-wizard/wizard-cart.tsx
git commit -m "wizard-cart: sticky cart preview for step 2"
```

---

### Task E2: `<TemplateChooser>` component

**Files:**
- Create: `web/src/components/service-wizard/template-chooser.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/format'

interface TemplateChooserProps {
  selectedTemplateId: string | null
  onSelect: (templateId: string | null) => void
}

interface Template {
  id: string
  name: string
  description: string | null
  defaultPrice: string | null
  validityMonths: number | null
  lines: Array<{ procedureTypeId: string; procedureTypeName: string; sessionsCount: number }>
}

export function TemplateChooser({ selectedTemplateId, onSelect }: TemplateChooserProps) {
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['package-templates'],
    queryFn: async () => {
      const res = await fetch('/api/package-templates')
      if (!res.ok) throw new Error('Falha ao carregar pacotes')
      return res.json().then((j) => j.data ?? j.templates ?? [])
    },
  })

  if (templates.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Pacotes</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const isSelected = selectedTemplateId === t.id
          return (
            <Card
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(isSelected ? null : t.id)}
              className={cn(
                'cursor-pointer transition-colors',
                isSelected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/40'
              )}
            >
              <CardContent className="p-3 space-y-1">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.lines.map((l) => `${l.sessionsCount}× ${l.procedureTypeName}`).join(' + ')}
                </div>
                <div className="text-xs">{formatBRL(Number(t.defaultPrice ?? 0))}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify API exists**

Run `grep -rn '/api/package-templates' web/src/app/api 2>/dev/null` to confirm the route exists. If not, note that the route already exists at `/api/package-templates/route.ts` (since templates are loaded by the existing SellPackageDialog) — confirm and adjust the fetch path/shape accordingly.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/service-wizard/template-chooser.tsx
git commit -m "template-chooser: step-2 single-select template picker"
```

---

## Group F — Wizard state + composition

### Task F1: Extend `use-service-wizard.ts`

**Files:**
- Modify: `web/src/hooks/use-service-wizard.ts`

- [ ] **Step 1: Add `cart` and `atendimentoId` to `WizardState`**

```ts
export interface WizardState {
  currentStep: WizardStep
  procedureId: string | null             // first procedure_record (legacy/transition)
  procedureRecordIds: string[]           // all lines, after step 4 finalization
  atendimentoId: string | null
  procedureStatus: ProcedureRecordStatus | null
  selectedTypeIds: string[]              // mirror of cart.lines.procedureTypeId for old code paths
  cart: AtendimentoCart                  // canonical source of truth in steps 2-4
  stepTimestamps: Record<string, string | null>
  error: string | null
  isSaving: boolean
  triggerSave: number
}
```

Add new actions: `SET_CART`, `SET_ATENDIMENTO_ID`, `SET_PROCEDURE_RECORD_IDS`.

Update the reducer to handle them. `SET_CART` also derives `selectedTypeIds` from the cart's lines (so existing read paths in step 3 continue to work).

- [ ] **Step 2: Update step availability rules**

- Step 3 needs `cart.lines.length > 0` (was `selectedTypeIds.length > 0`).
- Step 4 still needs planning complete, but now per-line (all lines have at least one planned point or the user explicitly bypasses).
- Step 5 needs `procedureStatus === 'approved' || 'in_progress' || 'completed'`.

- [ ] **Step 3: Update `determineInitialStep`**

When loaded with a procedure whose status is `'in_progress'` or `'completed'`, the natural landing step is 5.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/hooks/use-service-wizard.ts
git commit -m "use-service-wizard: cart + atendimentoId + multi-line state"
```

---

### Task F2: Update `service-wizard.tsx`

**Files:**
- Modify: `web/src/components/service-wizard/service-wizard.tsx`

- [ ] **Step 1: Replace `procedureId` props with a list**

Where the wizard previously held a single procedure, accept an array `procedures`. The simplest data model: `procedures[]` keyed by `procedureRecords.id`, each with its own diagrams/applications/sessions.

- [ ] **Step 2: Pass cart down to step 2**

```tsx
{state.currentStep === 2 && (
  <ProcedureTypeStep
    cart={state.cart}
    onCartChange={(next) => dispatch({ type: 'SET_CART', cart: next })}
  />
)}
```

- [ ] **Step 3: Wire approval to the new finalize endpoint**

When the user clicks "Aprovar" at step 4, POST to `/api/procedures/[draftId]/approve` with `{ cart, financialPlan, consents }`. On success, store the returned `atendimentoId` + `procedureRecordIds` in state, advance to step 5.

- [ ] **Step 4: Pass `procedureRecordIds` + `atendimentoId` to step 5**

```tsx
{state.currentStep === 5 && state.atendimentoId && (
  <ProcedureExecution
    atendimentoId={state.atendimentoId}
    procedureRecordIds={state.procedureRecordIds}
    patientId={patient.id}
    deepLinkProcedureId={searchParams.procedure ?? null}
    autoStartNext={searchParams.action === 'executeNext'}
  />
)}
```

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/service-wizard/service-wizard.tsx
git commit -m "service-wizard: multi-line + cart + step-5 picker integration"
```

---

### Task F3: Update `procedure-type-step.tsx`

**Files:**
- Modify: `web/src/components/service-wizard/procedure-type-step.tsx`

- [ ] **Step 1: Change the component signature**

```tsx
interface ProcedureTypeStepProps {
  cart: AtendimentoCart
  onCartChange: (next: AtendimentoCart) => void
}
```

- [ ] **Step 2: Render template chooser above the type grid**

```tsx
<TemplateChooser
  selectedTemplateId={cart.templateId}
  onSelect={async (id) => {
    if (id === null) onCartChange({ ...cart, templateId: null, templateName: null, templateDefaultPrice: null, templateValidityMonths: null, lines: cart.lines.filter((l) => l.sourceTemplateLineId === null) })
    else {
      const template = await fetch(`/api/package-templates/${id}`).then((r) => r.json())
      onCartChange({
        ...cart,
        templateId: template.id,
        templateName: template.name,
        templateDefaultPrice: Number(template.defaultPrice ?? 0),
        templateValidityMonths: template.validityMonths,
        lines: [
          ...template.lines.map((l: any) => ({
            procedureTypeId: l.procedureTypeId,
            procedureTypeName: l.procedureTypeName,
            sessions: l.sessionsCount,
            defaultPrice: Number(l.defaultPrice ?? 0),
            sourceTemplateLineId: l.id,
          })),
          ...cart.lines.filter((l) => l.sourceTemplateLineId === null),
        ],
      })
    }
  }}
/>
```

- [ ] **Step 3: Render the procedure type grid with `+1 session` on click**

When the user clicks a procedure type tile, add to cart with `sessions = 1`; if already in cart, no-op (sessions are edited inline in the cart preview).

- [ ] **Step 4: Render `<WizardCart>` at the bottom**

```tsx
<WizardCart
  cart={cart}
  onChange={onCartChange}
  onRemoveLine={(typeId) => onCartChange({ ...cart, lines: cart.lines.filter((l) => l.procedureTypeId !== typeId) })}
  onClearTemplate={() => onCartChange({ ...cart, templateId: null, /* ... */ lines: cart.lines.filter((l) => l.sourceTemplateLineId === null) })}
/>
```

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/service-wizard/procedure-type-step.tsx
git commit -m "procedure-type-step: template chooser + grid + cart preview"
```

---

### Task F4: Update `procedure-form.tsx` (planning multi-line)

**Files:**
- Modify: `web/src/components/procedures/procedure-form.tsx`

- [ ] **Step 1: Add tabs/panels per line when `cart.lines.length > 1`**

If a single line, render today's planning UI (face diagram + product plan). If multiple, render a tab strip with one panel per line.

- [ ] **Step 2: Persist planning per-line into a draft `procedure_records.plannedSnapshot`**

At save, the planning JSON is keyed by `procedureTypeId` and stored on the draft record(s). The finalize endpoint (D1) maps these into per-record `plannedSnapshot` fields.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/procedures/procedure-form.tsx
git commit -m "procedure-form: multi-line tabs for step 3 planning"
```

---

### Task F5: Update `procedure-approval.tsx`

**Files:**
- Modify: `web/src/components/procedures/procedure-approval.tsx`

- [ ] **Step 1: Replace single-procedure summary with cart-driven summary**

Show every line, its `sessionsTotal`, price, and per-line consent status. Render one consent box per consent template (`ConsentStatusList` already handles this — pass it `cart.lines`).

- [ ] **Step 2: Approve action**

When the user clicks "Aprovar", POST to the approve route (task D1) with `{ cart, financialPlan, consents }`. On success, advance to step 5 and store returned ids.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/procedures/procedure-approval.tsx
git commit -m "procedure-approval: cart-driven multi-line approval"
```

---

## Group G — Step-5 UI

### Task G1: `<SessionPicker>` component

**Files:**
- Create: `web/src/components/procedures/session-picker.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'

interface SessionPickerProps {
  atendimentoId: string
  procedureRecordIds: string[]
  packageId: string | null
  onPickPending: (recordId: string, ordinal: number) => void
  onPickExecuted: (sessionId: string) => void
}

interface AtendimentoView {
  records: Array<{
    id: string
    procedureTypeName: string
    sessionsTotal: number
    sessions: Array<{ id: string; sessionOrdinal: number; performedAt: string; executedByName: string }>
  }>
  package: { id: string; name: string; expiresAt: string | null; status: string; closedAt: string | null; closedReason: string | null } | null
}

export function SessionPicker({ atendimentoId, packageId, onPickPending, onPickExecuted }: SessionPickerProps) {
  const { data, isLoading } = useQuery<AtendimentoView>({
    queryKey: ['atendimento-view', atendimentoId],
    queryFn: () => fetch(`/api/atendimentos/${atendimentoId}`).then((r) => r.json()).then((j) => j.data),
  })
  const expiredAt = useMemo(() => {
    if (!data?.package?.expiresAt) return null
    return new Date(data.package.expiresAt) < new Date() ? data.package.expiresAt : null
  }, [data?.package?.expiresAt])

  if (isLoading || !data) return <div>Carregando…</div>

  const isPackageClosed = data.package && (data.package.status === 'completed' || data.package.closedAt)

  return (
    <div className="space-y-6">
      {expiredAt && !isPackageClosed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Pacote vencido em {formatDate(expiredAt)}. Você pode continuar executando as sessões restantes ou encerrar o pacote.
        </div>
      )}
      {data.records.map((rec) => (
        <section key={rec.id} className="space-y-2">
          <h3 className="font-medium">
            {rec.procedureTypeName} — {rec.sessionsTotal} {rec.sessionsTotal === 1 ? 'sessão' : 'sessões'}
          </h3>
          <ol className="space-y-1">
            {Array.from({ length: rec.sessionsTotal }, (_, i) => i + 1).map((ord) => {
              const exec = rec.sessions.find((s) => s.sessionOrdinal === ord) ?? null
              const isExecuted = exec !== null
              const nextPendingOrd = rec.sessions.length + 1
              const isNext = !isExecuted && ord === nextPendingOrd
              return (
                <li key={ord} className={cn('flex items-center gap-2 rounded px-2 py-1', isNext && 'bg-primary/5')}>
                  <span className="w-6 text-sm text-muted-foreground">{ord}</span>
                  {isExecuted ? (
                    <>
                      <Check className="size-4 text-emerald-600" />
                      <button className="text-sm text-left flex-1 underline-offset-2 hover:underline" onClick={() => onPickExecuted(exec!.id)}>
                        Realizada em {formatDate(exec!.performedAt)} por {exec!.executedByName}
                      </button>
                    </>
                  ) : isNext && !isPackageClosed ? (
                    <Button size="sm" onClick={() => onPickPending(rec.id, ord)}>Executar agora</Button>
                  ) : (
                    <span className="text-sm text-muted-foreground" title={isPackageClosed ? 'Pacote encerrado' : 'Conclua a sessão anterior primeiro'}>
                      Pendente
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Note the new API route required**

The picker calls `GET /api/atendimentos/[id]`. This route is created in task J1 (atendimento page wiring). For G1's commit, the route will 404 — the component is still typecheck-clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/procedures/session-picker.tsx
git commit -m "session-picker: persistent step-5 dashboard"
```

---

### Task G2: `<SessionExecutionForm>` component

**Files:**
- Create: `web/src/components/procedures/session-execution-form.tsx`

- [ ] **Step 1: Extract the single-session form from `procedure-execution.tsx`**

Take the current form fields (technique, clinical response, products, diagram, photos, follow-up). The new form is scoped to a single `procedureRecordId` + a fresh `procedureSessions` row. On submit, POST `/api/procedures/[id]/sessions` (task D2).

```tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { procedureSessionFormSchema, type ProcedureSessionFormValues } from '@/validations/procedure-session'
import { Button } from '@/components/ui/button'
// ... existing form-field imports lifted from procedure-execution.tsx

interface SessionExecutionFormProps {
  procedureRecordId: string
  patientId: string
  patientGender?: string | null
  prefillFromPreviousSession?: { diagrams: any[] } | null
  onSaved: (sessionId: string) => void
  onCancel: () => void
}

export function SessionExecutionForm({ procedureRecordId, patientId, prefillFromPreviousSession, onSaved, onCancel }: SessionExecutionFormProps) {
  const form = useForm<ProcedureSessionFormValues>({
    resolver: zodResolver(procedureSessionFormSchema),
    defaultValues: {
      performedAt: new Date().toISOString(),
      technique: '',
      clinicalResponse: '',
      adverseEffects: '',
      notes: '',
      followUpDate: null,
      nextSessionObjectives: '',
    },
  })
  // ... diagram state init from prefill
  const onSubmit = async (values: ProcedureSessionFormValues) => {
    const res = await fetch(`/api/procedures/${procedureRecordId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        procedureRecordId,
        ...values,
        productApplications: /* from local state */,
        diagramPoints: /* from local state */,
        photoAssetIds: /* from local state */,
      }),
    })
    const json = await res.json()
    if (json.success) onSaved(json.data.sessionId)
  }
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* lifted JSX from procedure-execution.tsx */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit">Salvar sessão</Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/procedures/session-execution-form.tsx
git commit -m "session-execution-form: single-session form (extracted from procedure-execution)"
```

---

### Task G3: Rewrite `procedure-execution.tsx` as orchestrator

**Files:**
- Modify: `web/src/components/procedures/procedure-execution.tsx`

- [ ] **Step 1: Replace the body with picker + form switching**

```tsx
'use client'
import { useState } from 'react'
import { SessionPicker } from './session-picker'
import { SessionExecutionForm } from './session-execution-form'
import { useQueryClient } from '@tanstack/react-query'

interface ProcedureExecutionProps {
  atendimentoId: string
  procedureRecordIds: string[]
  patientId: string
  patientGender?: string | null
  packageId: string | null
  deepLinkProcedureId?: string | null
  autoStartNext?: boolean
}

export function ProcedureExecution({ atendimentoId, packageId, patientId, deepLinkProcedureId, autoStartNext }: ProcedureExecutionProps) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<{ kind: 'picker' } | { kind: 'execute'; recordId: string; ordinal: number } | { kind: 'view'; sessionId: string }>(() => {
    if (deepLinkProcedureId && autoStartNext) return { kind: 'execute', recordId: deepLinkProcedureId, ordinal: 0 }
    return { kind: 'picker' }
  })

  if (mode.kind === 'execute') {
    return (
      <SessionExecutionForm
        procedureRecordId={mode.recordId}
        patientId={patientId}
        onSaved={async () => {
          await qc.invalidateQueries({ queryKey: ['atendimento-view', atendimentoId] })
          setMode({ kind: 'picker' })
        }}
        onCancel={() => setMode({ kind: 'picker' })}
      />
    )
  }
  if (mode.kind === 'view') {
    return <SessionReadOnly sessionId={mode.sessionId} onBack={() => setMode({ kind: 'picker' })} />
  }
  return (
    <SessionPicker
      atendimentoId={atendimentoId}
      procedureRecordIds={[]}
      packageId={packageId}
      onPickPending={(recordId, ordinal) => setMode({ kind: 'execute', recordId, ordinal })}
      onPickExecuted={(sessionId) => setMode({ kind: 'view', sessionId })}
    />
  )
}
```

The `<SessionReadOnly>` component can be a thin wrapper around `<SessionExecutionForm readOnly>` or a small dedicated viewer — either way, mark the read-only view as out-of-scope for this task and stub it with a "Read-only view (em breve)" message; a follow-up task in Group L will round it out. **Actually** — implement a basic read-only viewer here:

```tsx
function SessionReadOnly({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { data } = useQuery({ queryKey: ['procedure-session', sessionId], queryFn: () => fetch(`/api/procedure-sessions/${sessionId}`).then((r) => r.json()).then((j) => j.data) })
  if (!data) return <div>Carregando…</div>
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>← Voltar</Button>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt>Realizada em</dt><dd>{formatDate(data.performedAt)}</dd>
        <dt>Por</dt><dd>{data.executedByName}</dd>
        <dt>Técnica</dt><dd>{data.technique || '—'}</dd>
        <dt>Resposta clínica</dt><dd>{data.clinicalResponse || '—'}</dd>
        <dt>Efeitos adversos</dt><dd>{data.adverseEffects || '—'}</dd>
        <dt>Observações</dt><dd>{data.notes || '—'}</dd>
      </dl>
    </div>
  )
}
```

The `/api/procedure-sessions/[id]` GET route is created as part of task J1 (or — to keep G3 self-contained — also create it here).

Actually — to keep the dependency clean, **create the GET route in this task too**:

- Create: `web/src/app/api/procedure-sessions/[id]/route.ts`

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { procedureSessions, users } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const id = (await params).id
    const [row] = await db
      .select({
        id: procedureSessions.id,
        performedAt: procedureSessions.performedAt,
        executedByName: users.fullName,
        technique: procedureSessions.technique,
        clinicalResponse: procedureSessions.clinicalResponse,
        adverseEffects: procedureSessions.adverseEffects,
        notes: procedureSessions.notes,
        followUpDate: procedureSessions.followUpDate,
        nextSessionObjectives: procedureSessions.nextSessionObjectives,
      })
      .from(procedureSessions)
      .innerJoin(users, eq(procedureSessions.executedBy, users.id))
      .where(and(eq(procedureSessions.tenantId, ctx.tenantId), eq(procedureSessions.id, id)))
      .limit(1)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: row })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ success: false, error: 'Erro' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/procedures/procedure-execution.tsx web/src/app/api/procedure-sessions/[id]/route.ts
git commit -m "procedure-execution: picker + form orchestrator (replaces single-shot UI)"
```

---

## Group H — Package UI tidy

### Task H1: Update `package-card.tsx`

**Files:**
- Modify: `web/src/components/packages/package-card.tsx`

- [ ] **Step 1: Switch data shape from `lines` to `records`**

Update the `PatientPackageWithConsumption` import to use the new shape. Render `pkg.records.map((r) => ...)`, showing `r.procedureTypeName · r.sessionsExecuted/r.sessionsTotal`.

- [ ] **Step 2: Remove "Iniciar próxima sessão" button + handler**

Search for `useStartPackageSession`, `start-session`, and remove. Replace with a single "Executar próxima sessão" button that links to:

```
/pacientes/${patientId}/atendimento?procedure=${record.id}&action=executeNext
```

The button is rendered only if `record.sessionsExecuted < record.sessionsTotal` and `pkg.status === 'active'`.

- [ ] **Step 3: Add "Encerrar pacote" button**

Owner-only (use `useTenant` → role). On click, open `<ClosePackageDialog />` (task H5).

- [ ] **Step 4: Show expiry warning**

If `pkg.status === 'expired'` OR `pkg.expiresAt && new Date(pkg.expiresAt) < new Date()`, render an amber banner:

```
"Pacote vencido em {DD/MM/YYYY} — sessões ainda podem ser realizadas até o encerramento."
```

If `pkg.closedAt`, render `"5 de 4 realizadas · pacote encerrado em {DD/MM/YYYY}"` and include `closedReason` label.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/packages/package-card.tsx
git commit -m "package-card: session-driven progress, encerrar pacote, expiry warning"
```

---

### Task H2: Update `patient-packages-tab.tsx`

**Files:**
- Modify: `web/src/components/packages/patient-packages-tab.tsx`

- [ ] **Step 1: Remove "Vender pacote" button + `<SellPackageDialog />` usage**

Delete the button, the dialog state, and any related import.

- [ ] **Step 2: Add "Novo atendimento" CTA in its place**

```tsx
<Button asChild>
  <Link href={`/pacientes/${patientId}/atendimento?new=1`}>Novo atendimento</Link>
</Button>
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/packages/patient-packages-tab.tsx
git commit -m "patient-packages-tab: replace sell button with novo-atendimento link"
```

---

### Task H3: Update `hooks/queries/use-packages.ts`

**Files:**
- Modify: `web/src/hooks/queries/use-packages.ts`

- [ ] **Step 1: Update `PatientPackageWithConsumption` type import**

It now ships `records[]` instead of `lines[]`.

- [ ] **Step 2: Remove `useSellPackage`, `useStartPackageSession`**

These mutations target gone endpoints.

- [ ] **Step 3: Add `useClosePackage`**

```ts
export function useClosePackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ packageId, body }: { packageId: string; body: ClosePackageFormValues }) => {
      const res = await fetch(`/api/patient-packages/${packageId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Falha ao encerrar pacote')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-packages'] })
    },
  })
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/hooks/queries/use-packages.ts
git commit -m "use-packages: drop sell/start-session, add useClosePackage"
```

---

### Task H4: Update `procedure-page-client.tsx`

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx`

- [ ] **Step 1: Replace `PackageBadgeBanner` with session-count badge**

```tsx
function SessionProgressBanner({ procedure, packageName }: { procedure: { id: string; sessionsTotal: number; sessionsExecuted: number }; packageName: string | null }) {
  if (procedure.sessionsTotal <= 1 && !packageName) return null
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      {packageName && <strong className="mr-1">{packageName} ·</strong>}
      sessões: {procedure.sessionsExecuted}/{procedure.sessionsTotal}
    </div>
  )
}
```

Source `sessionsExecuted` from the procedure-query (B2 already projects it via subquery).

- [ ] **Step 2: Remove the obsolete `usePatientPackages` lookup**

The previous logic searched `pkg.lines.find((l) => l.id === patientPackageLineId)`. The new badge uses `procedure.sessionsTotal` directly.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/\(platform\)/pacientes/\[id\]/procedimentos/\[procedureId\]/procedure-page-client.tsx
git commit -m "procedure-page-client: session-count badge (replaces patient_package_lines badge)"
```

---

### Task H5: `<ClosePackageDialog />`

**Files:**
- Create: `web/src/components/packages/close-package-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { closePackageSchema, closeReasonLabels, closeReasonValues, type ClosePackageFormValues } from '@/validations/encerrar-pacote'
import { useClosePackage } from '@/hooks/queries/use-packages'

interface ClosePackageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packageId: string
}

export function ClosePackageDialog({ open, onOpenChange, packageId }: ClosePackageDialogProps) {
  const { mutateAsync, isPending } = useClosePackage()
  const form = useForm<ClosePackageFormValues>({
    resolver: zodResolver(closePackageSchema),
    defaultValues: { closedReason: 'patient_lost_expiry', closeNote: '' },
  })
  const reason = form.watch('closedReason')
  const onSubmit = async (values: ClosePackageFormValues) => {
    await mutateAsync({ packageId, body: values })
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Encerrar pacote</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-sm text-muted-foreground">Encerrar este pacote sem usar as sessões restantes?</p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo</label>
            <Select value={reason} onValueChange={(v) => form.setValue('closedReason', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {closeReasonValues.map((r) => (
                  <SelectItem key={r} value={r}>{closeReasonLabels[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === 'other' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Detalhes</label>
              <Textarea {...form.register('closeNote')} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Encerrando…' : 'Encerrar pacote'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/packages/close-package-dialog.tsx
git commit -m "close-package-dialog: encerrar pacote UI"
```

---

### Task H6: Delete `sell-package-dialog.tsx`

**Files:**
- Delete: `web/src/components/packages/sell-package-dialog.tsx`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn 'sell-package-dialog\|SellPackageDialog' web/src --include='*.ts' --include='*.tsx'
```

Expected: empty (H2 already removed the only consumer).

- [ ] **Step 2: Delete file and commit**

```bash
git rm web/src/components/packages/sell-package-dialog.tsx
git commit -m "sell-package-dialog: delete (superseded by atendimento wizard)"
```

---

## Group I — Settings UI

### Task I1: Clinic settings UI for `defaultPackageValidityMonths`

**Files:**
- Modify or create: `web/src/components/settings/clinic-settings-form.tsx`

- [ ] **Step 1: Determine if a clinic settings form already exists**

```bash
ls web/src/components/settings/ | grep -i clinic
ls web/src/app/\(platform\)/configuracoes/ 2>/dev/null
```

If a clinic settings form exists, add a numeric field; if not, create a new form alongside the whatsapp-settings-form (which already exists per the codebase audit).

- [ ] **Step 2: Add the field**

```tsx
const schema = z.object({
  defaultPackageValidityMonths: z.number().int().min(1).max(120).nullable(),
})

// inside form render
<FormField name="defaultPackageValidityMonths" ...>
  Validade padrão de pacotes (meses) — deixe em branco para sem validade.
</FormField>
```

On submit, POST to `/api/tenant` with `{ _action: 'clinic_settings', settings: { defaultPackageValidityMonths } }`.

- [ ] **Step 3: Wire the form into the Configurações > Clínica page**

If the page already exists, mount the form; if not, create a small server-component page that renders the form. Match the existing whatsapp settings page pattern.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/clinic-settings-form.tsx web/src/app/\(platform\)/configuracoes/clinica/page.tsx 2>/dev/null
git commit -m "settings: defaultPackageValidityMonths form"
```

---

## Group J — Atendimento page wiring

### Task J1: Update `atendimento-page-client.tsx` + add `/api/atendimentos/[id]` GET

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/atendimento/atendimento-page-client.tsx`
- Create: `web/src/app/api/atendimentos/[id]/route.ts`

- [ ] **Step 1: Accept deep-link query params**

In the client component, read `searchParams.procedure` and `searchParams.action`. When `?procedure=<recordId>&action=executeNext`:

1. Look up the procedure to derive its `atendimentoId`.
2. Mount the wizard at step 5 with `deepLinkProcedureId` + `autoStartNext`.

- [ ] **Step 2: Add `/api/atendimentos/[id]` GET handler**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { procedureRecords, procedureSessions, procedureTypes, patientPackages, users } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const atendimentoId = (await params).id

    const records = await db
      .select({
        id: procedureRecords.id,
        procedureTypeName: procedureTypes.name,
        sessionsTotal: procedureRecords.sessionsTotal,
        patientPackageId: procedureRecords.patientPackageId,
      })
      .from(procedureRecords)
      .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
      .where(and(
        eq(procedureRecords.tenantId, ctx.tenantId),
        eq(procedureRecords.atendimentoId, atendimentoId),
      ))

    if (records.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const recordIds = records.map((r) => r.id)
    const sessions = await db
      .select({
        id: procedureSessions.id,
        procedureRecordId: procedureSessions.procedureRecordId,
        sessionOrdinal: procedureSessions.sessionOrdinal,
        performedAt: procedureSessions.performedAt,
        executedByName: users.fullName,
      })
      .from(procedureSessions)
      .innerJoin(users, eq(procedureSessions.executedBy, users.id))
      .where(/* recordIds inArray */)
      .orderBy(asc(procedureSessions.sessionOrdinal))

    const packageId = records[0].patientPackageId
    let pkg = null
    if (packageId) {
      [pkg] = await db.select().from(patientPackages).where(eq(patientPackages.id, packageId)).limit(1)
    }

    return NextResponse.json({
      success: true,
      data: {
        records: records.map((r) => ({
          ...r,
          sessions: sessions.filter((s) => s.procedureRecordId === r.id),
        })),
        package: pkg ? {
          id: pkg.id, name: pkg.name, status: pkg.status,
          expiresAt: pkg.expiresAt, closedAt: pkg.closedAt, closedReason: pkg.closedReason,
        } : null,
      },
    })
  } catch (e) { /* standard mapping */ }
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/\(platform\)/pacientes/\[id\]/atendimento/atendimento-page-client.tsx web/src/app/api/atendimentos/\[id\]/route.ts
git commit -m "atendimento: deep-link executeNext + atendimento view API"
```

---

## Group K — Cleanup

### Task K1: Delete obsolete `/api/patient-packages` POST handler

**Files:**
- Modify: `web/src/app/api/patient-packages/route.ts`

- [ ] **Step 1: Verify no callers**

```bash
grep -rn 'POST.*patient-packages\|useSellPackage\|/api/patient-packages.*method.*POST' web/src --include='*.ts' --include='*.tsx'
```

Expected: empty.

- [ ] **Step 2: Remove the POST export**

Open the file and delete the `export async function POST(...)` block. Keep any `GET` if present.

If the file is now empty (no exports), delete the whole file:

```bash
git rm web/src/app/api/patient-packages/route.ts
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/patient-packages/route.ts 2>/dev/null
git commit -m "api(patient-packages): remove POST sellPackage handler"
```

---

### Task K2: Delete `start-session` route folder

**Files:**
- Delete: `web/src/app/api/patient-packages/[id]/lines/` (whole subtree)

- [ ] **Step 1: Verify no callers**

```bash
grep -rn 'start-session\|/lines/' web/src --include='*.ts' --include='*.tsx'
```

Expected: empty.

- [ ] **Step 2: Delete and commit**

```bash
git rm -r web/src/app/api/patient-packages/\[id\]/lines/
git commit -m "api(patient-packages): remove start-session route"
```

---

## Group L — Tests (one task per scope)

### Task L1: `procedure-sessions` query tests (already in B1)

Already covered in Task B1.

### Task L2: `atendimento-finalize` test (already in C1)

Already covered in Task C1.

### Task L3: `session-execute` test (already in C2)

Already covered in Task C2.

### Task L4: Update `lib/__tests__/packages.test.ts`

**Files:**
- Modify: `web/src/lib/__tests__/packages.test.ts`

- [ ] **Step 1: Remove `sellPackage` and `startPackageSession` test blocks**

These functions are deleted; their tests no longer compile.

- [ ] **Step 2: Add tests for `maybeCompletePackage`**

Seed a `patient_packages` row, two `procedure_records` (sessions 2 and 1), insert `procedure_sessions` rows, and verify the package flips to `completed` only when every record has met its `sessionsTotal`.

- [ ] **Step 3: Add tests for `closePackage`**

Verify that calling `closePackage` with `closedReason='patient_lost_expiry'` sets `status='completed'`, `closedAt`, `closedReason`, and `closeNote=null`. With `closedReason='other'` and a note, both are persisted; with `closedReason='other'` and empty note, the upstream Zod schema should reject (covered by the dialog test, not here).

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/lib/__tests__/packages.test.ts
git add web/src/lib/__tests__/packages.test.ts
git commit -m "lib(packages tests): cover maybeCompletePackage + closePackage"
```

---

### Task L5: `session-picker` characterization test

**Files:**
- Create: `web/src/components/procedures/__tests__/session-picker.test.tsx`

- [ ] **Step 1: Mock the `/api/atendimentos/[id]` fetch**

Use MSW (already configured per existing characterization tests) or a fetch-mocking helper from the test setup.

- [ ] **Step 2: Test cases**

```ts
describe('<SessionPicker>', () => {
  it('shows "Executar agora" only on the lowest pending ordinal', async () => { /* ... */ })
  it('disables actions when package is closed', async () => { /* ... */ })
  it('shows expiry banner when expiresAt is in the past and not closed', async () => { /* ... */ })
})
```

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/components/procedures/__tests__/session-picker.test.tsx
git add web/src/components/procedures/__tests__/session-picker.test.tsx
git commit -m "tests: session-picker characterization"
```

---

### Task L6: `session-execution-form` characterization test

**Files:**
- Create: `web/src/components/procedures/__tests__/session-execution-form.test.tsx`

- [ ] **Step 1: Test cases**

```ts
describe('<SessionExecutionForm>', () => {
  it('requires performedAt and rejects empty submission', async () => { /* ... */ })
  it('posts to /api/procedures/[id]/sessions with the expected payload shape', async () => { /* ... */ })
  it('calls onSaved when the server returns sessionId', async () => { /* ... */ })
})
```

- [ ] **Step 2: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/components/procedures/__tests__/session-execution-form.test.tsx
git add web/src/components/procedures/__tests__/session-execution-form.test.tsx
git commit -m "tests: session-execution-form characterization"
```

---

### Task L7: `wizard-cart` unit test

**Files:**
- Create: `web/src/components/service-wizard/__tests__/wizard-cart.test.tsx`

- [ ] **Step 1: Test cases**

```ts
describe('<WizardCart>', () => {
  it('disables session input on template-driven lines', async () => { /* ... */ })
  it('emits change with updated sessions count', async () => { /* ... */ })
  it('shows totalOverride when set, recomputes total when not', async () => { /* ... */ })
})
```

- [ ] **Step 2: Add a pure-function test for the cart validations**

`web/src/validations/__tests__/atendimento-cart.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeCartTotal, isBundleCart, autoPackageName } from '../atendimento-cart'

describe('atendimento-cart helpers', () => {
  it('isBundleCart returns true when any line has sessions > 1', () => { /* ... */ })
  it('isBundleCart returns true when template is selected', () => { /* ... */ })
  it('autoPackageName for single multi-session ad-hoc line', () => { /* ... */ })
  it('autoPackageName for mixed ad-hoc lines', () => { /* ... */ })
  it('computeCartTotal honors totalOverride', () => { /* ... */ })
})
```

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/components/service-wizard/__tests__/wizard-cart.test.tsx src/validations/__tests__/atendimento-cart.test.ts
git add web/src/components/service-wizard/__tests__/wizard-cart.test.tsx web/src/validations/__tests__/atendimento-cart.test.ts
git commit -m "tests: wizard-cart + atendimento-cart helpers"
```

---

## Group M — Cross-cutting status rename

`'executed'` is referenced in many UI and helper files outside the data layer. To keep groups parallel, this group runs in parallel with Group H (no shared files with H1-H6). Each task is scoped to one file.

### Task M1: Type aliases

**Files:**
- Modify: `web/src/types/index.ts:7` — `ProcedureStatus = 'draft' | 'planned' | 'approved' | 'in_progress' | 'completed' | 'cancelled'`
- Modify: `web/src/components/service-wizard/types.ts:7` — same union
- Modify: `web/src/validations/procedure.ts:5` — `procedureStatusSchema = z.enum(['draft', 'planned', 'approved', 'in_progress', 'completed', 'cancelled'])`

- [ ] **Step 1: Replace `'executed'` with `'in_progress' | 'completed'` in all three files. Commit.**

### Task M2: Patient procedures tab

**Files:**
- Modify: `web/src/components/patients/patient-procedures-tab.tsx` (lines 252, 294, 398)

- [ ] **Step 1: Replace `proc.status === 'executed'` checks with `(proc.status === 'completed' || proc.status === 'in_progress')` for the "treated" condition, and pure `=== 'completed'` for terminal-state UI. Commit.**

### Task M3: Procedure card + detail view

**Files:**
- Modify: `web/src/components/procedures/procedure-card.tsx` (lines 234, 352)
- Modify: `web/src/components/procedures/procedure-detail-view.tsx` (lines 151, 152, 210)

- [ ] **Step 1: Same replacement pattern. The `isExecuted` boolean becomes `isCompleted = procedure.status === 'completed'`. Commit.**

### Task M4: Procedure status helper

**Files:**
- Modify: `web/src/lib/procedure-status.ts`

- [ ] **Step 1: Update doc comment + any literal references. Add helpers `isOpen` (in `'draft' | 'planned' | 'approved' | 'in_progress'`) and `isClosed` (in `'completed' | 'cancelled'`). Commit.**

### Task M5: Atendimento + procedure pages

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/atendimento/atendimento-page-client.tsx:66`
- Modify: `web/src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/procedure-page-client.tsx:149, 153`
- Modify: `web/src/app/(print)/procedimentos/[id]/imprimir/page.tsx:24`

- [ ] **Step 1: Replace `=== 'executed'` with `=== 'completed'`. Update the print guard to allow both `'completed'` and `'in_progress'` if appropriate (a partially-executed multi-session line might still want printing its sessions). Conservative: keep `=== 'completed'`. Commit.**

### Task M6: Procedure form draft type

**Files:**
- Modify: `web/src/components/procedures/procedure-form.tsx:644`

- [ ] **Step 1: Replace inline status union. Commit.**

### Task M7: Timeline route

**Files:**
- Modify: `web/src/app/api/patients/[id]/timeline/route.ts:397`

- [ ] **Step 1: Replace `proc.status === 'executed'` with `(proc.status === 'completed' || proc.status === 'in_progress')`. The timeline shows everything that has happened, including partially-executed lines. Commit.**

### Task M8: Procedures query ORDER BY case + dashboard/followups

**Files:**
- Modify: `web/src/db/queries/procedures.ts:231` (the `CASE WHEN status THEN sortIndex` clause)

- [ ] **Step 1: Map `'in_progress' → 4`, `'completed' → 5`. Renumber subsequent cases. Verify `dashboard.ts` and `followups.ts` queries use the same projection. Commit.**

### Task M9: Service-wizard step availability

**Files:**
- Modify: `web/src/hooks/use-service-wizard.ts:331, 350, 352, 354`
- Modify: `web/src/components/service-wizard/service-wizard.tsx:510`

> Note: This overlaps with task F1's scope. Implement these step-availability replacements as part of F1's commit, not separately. Mark this task as "consolidated into F1".

---

---

## Adversarial Review Patches (Phase 2 fixes)

The plan was reviewed by Skeptic, Architect, and Minimalist reviewers. Findings accepted into the plan:

### Patch P1 — Finalize-in-place, not delete-and-recreate

**Affects: Task C1, Task D1, Task F4**

The "cancel the draft record + create fresh records" approach in D1/C1 orphans the per-line planning data (`plannedSnapshot`, draft diagrams, draft products) that F4 had already persisted to draft `procedure_records`.

**New approach for C1 (`finalizeAtendimento`):** the wizard owns a stable set of draft `procedure_records` (one per cart line) all the way through step 3. Approval **finalizes those existing draft rows** rather than recreating them. Diagrams, products, and planned snapshots stay linked to the same record IDs across approval.

**Revised `finalizeAtendimento` signature:**

```ts
export interface FinalizeAtendimentoInput {
  tenantId: string
  userId: string
  patientId: string
  practitionerId: string
  cart: AtendimentoCart
  draftRecordIds: string[]   // one per cart line, same order
  financialPlan: { totalAmount: string; installmentCount: number; paymentMethod: string; notes?: string }
  consents: Array<{...}>
  tenantDefaultValidityMonths?: number | null
}
```

**Revised behavior (inside the transaction):**

1. `SELECT ... FOR UPDATE` every draft record. Verify each one is in `'draft'` or `'planned'` and belongs to the tenant + patient.
2. Determine `isBundle`. If yes, insert one `patient_packages` row.
3. Call `createFinancialEntry(...)` from `@/db/queries/financial` — the existing helper that creates the entry **and its installments**. Do NOT inline a raw `financialEntries` insert.
4. For each draft record, `UPDATE procedure_records SET status='approved', approvedAt=now(), patientPackageId=?, atendimentoId=?, sessionsTotal=line.sessions, financialPlan=?`. The `plannedSnapshot` and existing side data stay attached.
5. Insert one `consent_acceptances` per draft record (consents passed in body).
6. Audit log.

Update Task D1 to pass `draftRecordIds: string[]` instead of `[id]`. The HTTP route becomes `POST /api/atendimentos/[atendimentoId]/finalize` and accepts `{ cart, draftRecordIds, financialPlan, consents }`. Drop the old `/api/procedures/[id]/approve` route since the wizard now owns multiple drafts; if a single-line legacy path still exists, keep a thin wrapper for one cycle.

**Update Task F4 (procedure-form):** When the user advances from step 2 to step 3, the wizard creates one draft `procedure_records` per cart line via `POST /api/procedures` (existing endpoint), persists the per-line planning into each, then stores the array of draft IDs in wizard state. F4 already supports this; just make it explicit.

**New file ownership:** Create `web/src/app/api/atendimentos/[id]/finalize/route.ts` (new); modify the `atendimentos/[id]/route.ts` GET handler from Task J1 to live alongside it.

### Patch P2 — Concurrency + business gates inside `executeSession`

**Affects: Task C2**

The current C2 sketch (`MAX(sessionOrdinal)+1` then insert) is unsafe under concurrency and doesn't enforce business invariants. Replace the body of `executeSession` with the following transaction shape:

```ts
const run = async (tx: typeof db) => {
  // 1. Lock the parent record
  const [record] = await tx
    .select({
      id: procedureRecords.id,
      tenantId: procedureRecords.tenantId,
      status: procedureRecords.status,
      sessionsTotal: procedureRecords.sessionsTotal,
      patientPackageId: procedureRecords.patientPackageId,
      deletedAt: procedureRecords.deletedAt,
    })
    .from(procedureRecords)
    .where(and(
      eq(procedureRecords.id, input.procedureRecordId),
      eq(procedureRecords.tenantId, input.tenantId),
    ))
    .for('update')
    .limit(1)
  if (!record || record.deletedAt) throw new BusinessError('not_found')
  if (record.status === 'completed' || record.status === 'cancelled') {
    throw new BusinessError('record_already_terminal')
  }

  // 2. Check package terminal state (if linked)
  if (record.patientPackageId) {
    const [pkg] = await tx
      .select({ status: patientPackages.status, closedAt: patientPackages.closedAt })
      .from(patientPackages)
      .where(eq(patientPackages.id, record.patientPackageId))
      .for('update')
      .limit(1)
    if (!pkg) throw new BusinessError('package_missing')
    if (pkg.status === 'cancelled' || pkg.status === 'completed' || pkg.closedAt) {
      throw new BusinessError('package_terminal')
    }
  }

  // 3. Count existing sessions and check ordinal
  const sessionsDone = await countSessionsForRecord(input.procedureRecordId, tx)
  if (sessionsDone >= record.sessionsTotal) {
    throw new BusinessError('all_sessions_executed')
  }

  // 4. Insert session at ordinal sessionsDone + 1
  const session = await createSession({
    ...input,
    expectedOrdinal: sessionsDone + 1,  // createSession asserts MAX+1 === expectedOrdinal
  }, tx)

  // 5. Side data writes...
  // 6. Update statuses...
  // 7. Audit log...
}
```

`createSession` (Task B1) takes an `expectedOrdinal` and asserts `MAX(sessionOrdinal) + 1 === expectedOrdinal` post-lock; the unique constraint on `(procedure_record_id, session_ordinal)` is the safety net but should never fire under correct locking.

**API route (Task D2):** catch `BusinessError` and map to `409 Conflict` with a stable `code` so the UI can react (e.g., refetch picker state).

Add a `web/src/lib/errors.ts` if no `BusinessError` class exists yet; otherwise reuse.

### Patch P3 — Face diagram unique constraint

**Affects: Task A1 (migration), Task B6**

The existing unique `(procedure_record_id, view_type)` constraint blocks per-session diagrams. Migration must drop it and replace with a session-scoped constraint.

Add to Task A1 migration SQL, after the `procedureSessions` table creation:

```sql
-- Replace the record-scoped diagram uniqueness with session-scoped uniqueness.
DROP INDEX IF EXISTS "floraclin"."uq_face_diagrams_record_view";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_face_diagrams_session_view"
  ON "floraclin"."face_diagrams" ("procedure_session_id", "view_type")
  WHERE "procedure_session_id" IS NOT NULL;--> statement-breakpoint
-- Partial index — historical rows backfilled in step 2 of the migration already
-- have procedure_session_id set, but the WHERE clause protects us if any future
-- code path inserts a session-less diagram.
```

Update Task A2 schema.ts: replace `uniqueIndex('uq_face_diagrams_record_view').on(table.procedureRecordId, table.viewType)` with `uniqueIndex('uq_face_diagrams_session_view').on(table.procedureSessionId, table.viewType).where(sql\`procedure_session_id IS NOT NULL\`)`.

Update Task B6: remove the "we do not change the SQL constraint" disclaimer. The session-scoped upsert in `saveFaceDiagramForSession` now matches the constraint.

### Patch P4 — Make migration genuinely idempotent

**Affects: Task A1 step 1**

Every `ADD CONSTRAINT` must be preceded by `DROP CONSTRAINT IF EXISTS` of the same name. Same for indexes (already `IF NOT EXISTS`). Patch the migration as follows wherever a named constraint is added:

```sql
ALTER TABLE "floraclin"."patient_packages"
  DROP CONSTRAINT IF EXISTS "patient_packages_closed_reason_check";--> statement-breakpoint

ALTER TABLE "floraclin"."patient_packages"
  ADD CONSTRAINT "patient_packages_closed_reason_check"
  CHECK ("closed_reason" IS NULL OR "closed_reason" IN ('patient_lost_expiry', 'patient_stopped_treatment', 'other'));--> statement-breakpoint
```

Apply the same `DROP ... IF EXISTS` + `ADD ...` pattern to:
- `procedure_records_status_check` (already done in original draft — keep)
- `patient_packages_closed_reason_check` (add the drop)

Verify rerun safety: add a Task A1 step "Apply the migration twice against a scratch DB and assert no error on second run."

### Patch P5 — BR-anchored package expiry

**Affects: Task C1**

The original `toLocalYmd(addMonths(new Date(), validityMonths))` is host-TZ sensitive. Replace with:

```ts
import { parseBrDate, brToday, toBrYmd } from '@/lib/dates'
// ...
const today = parseBrDate(brToday(), '12:00:00')  // anchor at noon BR to avoid DST shifts
const expiresAt = validityMonths !== null
  ? toBrYmd(addMonths(today, validityMonths))
  : null
```

Add a test (in `web/src/lib/__tests__/atendimento-finalize.test.ts`): set `process.env.TZ = 'UTC'`, freeze the system clock to a BR-late-night moment (e.g., `2026-05-28T02:30:00Z`, which is `2026-05-27 23:30:00 BR`), and assert that selling a 6-month package produces `expiresAt = '2026-11-27'` (BR day plus 6 months), not `'2026-11-28'`.

### Patch P6 — Photo upload lifecycle: post-submit reassignment

**Affects: Task D4, Task G2, Task C2**

Photos are uploaded during step-5 form filling, before the session is created. The new flow:

1. **During form filling:** photos uploaded via `POST /api/photos` carry only `patientId` + `procedureRecordId`. `procedureSessionId` is left null. The uploader returns the photo IDs.
2. **On `Salvar sessão`:** the form passes `photoAssetIds: string[]` to `POST /api/procedures/[id]/sessions`.
3. **Inside `executeSession`:** after the `procedure_sessions` row is created, run an `UPDATE photo_assets SET procedure_session_id = ? WHERE id IN (?) AND tenant_id = ? AND procedure_record_id = ? AND procedure_session_id IS NULL`. The combined predicate prevents reassigning photos from other sessions.

Add this UPDATE to the C2 service body.

Task D4 stays correct: the photos route accepts an optional `procedureSessionId` for cases where the caller already has one (e.g., editing a saved session's photos later). The default upload path leaves it null.

### Patch P7 — Resolve spec contradiction: `procedure_records.status` on package close

**Affects: spec interpretation, Task B4 `maybeCompletePackage`, Group H**

The spec contains both statements:
- "`completed` → final session executed OR closed early via `patient_packages.closedReason`"
- "For every linked `procedure_records` still in `approved` or `in_progress`, leave `status` as-is but the picker no longer shows 'Executar agora'."

The plan resolves this in favor of the second statement: **lines keep their own status when a package is closed early.** The picker (G1) and execution service (C2) both gate on `patient_packages.status` separately.

- `maybeCompletePackage` (Task B4) continues to require every record to have `sessionsExecuted >= sessionsTotal` before flipping the package to `completed`. Early closure does NOT come through this helper — it comes through `closePackage`, which sets `closedAt` and flips `patient_packages.status` directly.
- `procedure_records.status` transitions remain: `approved → in_progress` after first session, `in_progress → completed` after final session, `approved → completed` for single-session lines after their one session.

Update the status-transition table at the spec level — but since we're not editing the spec, leave a `## Note` block in this plan documenting the resolution and reference it from the package-card / picker / queries tasks. (Future spec maintenance can be a follow-up.)

### Patch P8 — Tests for the high-risk paths

**Affects: Group L**

Add the following test scenarios:

- **L8 (new):** `web/src/db/migrations/__tests__/0015-rerun.test.ts` — boot a scratch DB, apply migration, apply again; expect no SQL errors.
- **L9 (new):** `web/src/lib/__tests__/atendimento-finalize.test.ts` extension — multi-line cart: assert that `plannedSnapshot` set on each draft record survives finalization, side-table rows (`product_applications`, `face_diagrams`) stay linked.
- **L10 (new):** `web/src/app/api/procedures/[id]/sessions/__tests__/route.test.ts` — given a closed package, POST returns 409 with `code: 'package_terminal'`.
- **L11 (new):** `web/src/lib/__tests__/session-execute.concurrency.test.ts` — fire two concurrent `executeSession` calls for the same record; assert one succeeds at ordinal N, the other rejects with `BusinessError`.

Each test is a small parallel task in Group L.

### Patch P9 — Minor simplifications accepted from Minimalist lens

**Affects: Task B5, Task B6, Task B7, Task G3**

- B5 / B7: drop the legacy `saveProductApplications(tenantId, procedureRecordId, ...)` and `createPhotoAsset` without-session compat layer. Rename to `*ForSession` and update the (sole) callers (`session-execute.ts` for B5; `photo-uploader.tsx` for B7 — the upload route just leaves session id null at upload time, sets it later via the reassignment in P6).
- B6: same — session-scoped only. `listDiagramsForRecord` stays for the read-side (picker shows previous session's diagram as a starting point), but the WRITE path is session-only.
- G3: only one read API. Drop `GET /api/procedure-sessions/[id]`; the `GET /api/atendimentos/[id]` already returns sessions with all fields. The read-only viewer in G3 takes a session object passed in via props from the picker (which got it from the atendimento view query).

### Patches rejected (with reason)

- **Skeptic #7 (rollout-safety / expand-contract):** rejected. This is a single-tenant clinic-internal app deploying single-instance; no rolling deploys. A single migration is fine. User has previously stated dev DB data may break.
- **Architect #5 (no `atendimentos` table):** rejected. YAGNI. `atendimentoId` as a grouping UUID on `procedure_records` is sufficient for the current scope; introducing an aggregate root adds tables and ownership churn without a current consumer.
- **Minimalist #2 (cart state model too large):** rejected. The cart is the canonical input to multi-line atendimento and step 4 finalize; without it, every step has to recompute its own state. Not over-engineered.
- **Minimalist #4 (tenant config for validity):** rejected. The spec explicitly asks for the `default_package_validity_months` tenant setting. Keep.
- **Minimalist #7 (Group M too wide):** rejected. The `executed → completed | in_progress` rename is forced by the `CHECK` constraint widening in A1. Bridging would create a dual-vocabulary period that's harder to reason about.
- **Minimalist #8 (Group L too wide):** rejected. The tests cover the new seams and the high-risk paths called out by Skeptic and Architect. They are not premature.
- **Minimalist #9 (E1/E2 split premature):** rejected. Separate files let parallel agents own them and read more cleanly.
- **Minimalist #10 (B1 standalone module):** rejected. Multiple call sites (C2, atendimento view query, tests) consume it.

---

## Self-Review Notes

- **Spec coverage:** Every spec section maps to at least one task. Core model change → A1, A2, B1, B2, C1, C2. Wizard changes → F1, F2, F3, F4, F5, G1, G2, G3. Encerrar pacote → A3, D3, H1, H5, L4. Expiry warning → H1, G1. Removals → H2, H6, D2, K1, K2. Migration → A1.
- **Placeholder scan:** No "TBD"/"TODO" remain. Every code step shows actual code.
- **Type consistency:** `executeSession`, `executeSession` arg type, `procedureRecordId` and `sessionOrdinal` shape match across B1, C2, D2, G2, G3, J1.
- **Status enum unification:** Migrated through `'in_progress'` and `'completed'` everywhere. The old `'executed'` value is only kept in the CHECK for the duration of step 2 of the migration; A1 step 5 removes it. The status-widening order in A2 step 6 matches the SQL order.
- **Tenant settings:** Persisted into `tenants.settings` jsonb (existing column, line 17 in schema.ts). No new table.
- **Risk areas to watch during execution:**
  - The wizard-state refactor (F1) is the riskiest single change — anything depending on the old `procedureId` shape needs to be updated by F2/F3/F4/F5. If F2-5 fail to typecheck after F1, narrow scope by making F1 emit both `procedureId` (legacy) and `procedureRecordIds` (new) during the transition.
  - The `procedure_records.status` widening creates a window where `'executed'` is legal until the backfill completes. Any code path that previously matched `WHERE status = 'executed'` must be updated to `IN ('completed', 'in_progress')` after the migration — B2, B3, B4 already cover this for queries; also grep `web/src/db/queries/dashboard.ts` and `web/src/db/queries/followups.ts` during B2 to catch reporting paths.
