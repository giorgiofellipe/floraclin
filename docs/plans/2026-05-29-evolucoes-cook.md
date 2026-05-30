# Evoluções Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-29-evolucoes-design.md`

**Goal:** Add a new "Evoluções" patient tab — a clinical narrative timeline that merges executed `procedure_sessions` (read-only) with free-text loose notes (authored, edited, soft-deleted by clinical staff).

**Architecture:** New `patient_evolutions` table + `patient_evolution_revisions` audit trail. GET feed endpoint unions sessions and notes server-side. CRUD endpoints for notes with FOR-UPDATE locked edits that snapshot pre-edit state. UI is a single reverse-chronological feed with a left-rail timeline spine, a modal composer for create/edit, and a drawer for revision history.

**Tech Stack:** Next.js 15 (App Router), Drizzle (`floraclin` schema, Postgres), React Query, shadcn/ui (Dialog, Drawer), Vitest. Brazil-only — date helpers from `@/lib/dates`.

**Branch:** `worktree-feat+evolucoes` (current worktree).

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `web/src/db/migrations/0016_patient_evolutions.sql` | Schema migration: two tables + indexes. |
| `web/src/db/queries/patient-evolutions.ts` | Tenant-scoped CRUD + revisions queries. |
| `web/src/validations/patient-evolution.ts` | Zod schemas for create/edit/delete payloads. |
| `web/src/lib/patient-evolutions.ts` | Service: edit-with-revision-snapshot in one tx; soft-delete with audit. |
| `web/src/app/api/patients/[id]/evolutions/route.ts` | `GET` (feed) + `POST` (create note). |
| `web/src/app/api/patients/[id]/evolutions/[noteId]/route.ts` | `PATCH` (edit) + `DELETE` (soft-delete). |
| `web/src/app/api/patients/[id]/evolutions/[noteId]/revisions/route.ts` | `GET` revisions. |
| `web/src/hooks/queries/use-evolutions.ts` | `useEvolutions(patientId)` + `useEvolutionRevisions(patientId, noteId)`. |
| `web/src/hooks/mutations/use-evolution-mutations.ts` | `useCreateEvolution`, `useEditEvolution`, `useDeleteEvolution`. |
| `web/src/components/patients/evolution-entry-card.tsx` | One entry in the feed; switches on `kind`. |
| `web/src/components/patients/evolution-note-composer.tsx` | Create/edit modal. |
| `web/src/components/patients/evolution-revisions-drawer.tsx` | Edit-history drawer. |
| `web/src/components/patients/patient-evolutions-tab.tsx` | Tab page: feed render + composer trigger + empty state. |
| `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/page.tsx` | Print route (server component, fetches data). |
| `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/print-evolucoes-page-client.tsx` | Print client component (data-print-area). |
| `web/src/db/queries/__tests__/patient-evolutions.test.ts` | Query integration test (gated by `RUN_DB_TESTS`). |
| `web/src/lib/__tests__/patient-evolutions.test.ts` | Service-layer mocked tests (revision snapshot tx). |
| `web/src/components/patients/__tests__/patient-evolutions-tab.test.tsx` | Component characterization. |

### Modified files

| File | Change |
|---|---|
| `web/src/db/schema.ts` | Add `patientEvolutions` and `patientEvolutionRevisions` tables. |
| `web/src/db/migrations/meta/_journal.json` | Append `0016` entry. |
| `web/src/components/patients/patient-tabs.tsx` | Add `evolucoes` tab; introduce `requiredRoles?: Role[]` field; filter tab strip by role. |
| `web/src/components/patients/patient-detail-content.tsx` | Mount `<PatientEvolutionsTab>`; add `'evolucoes'` to `VALID_TABS`; accept `role: Role` prop and forward to `PatientTabs`. |
| `web/src/app/(platform)/pacientes/[id]/page.tsx` | Read `ctx.role` from `getAuthContext()`; pass `role` to `<PatientDetailPageClient>`. |
| `web/src/app/(platform)/pacientes/[id]/patient-detail-page-client.tsx` | Accept `role` prop; forward to `<PatientDetailContent>`. |

---

## Review-Driven Amendments (binding — override sections below where in conflict)

These amendments encode the accepted findings from Phase 2 adversarial review. Implementers MUST honor them; where a task body below contradicts an amendment, the amendment wins.

**RA-1. Cross-patient note enforcement.** Every note-scoped query and service function — `getNoteLockedForUpdate`, `listRevisions`, `editNote`, `softDeleteNote` — MUST accept `patientId` and scope on `tenant_id = ? AND patient_id = ? AND id = ?`. Routes `D2`, `D3` MUST pass `params.id` (the route patient ID) into the service layer. If the note doesn't belong to the route patient, return `404` (not 403/500).

**RA-2. Single feed source.** Extract `getPatientEvolutionFeed(tenantId, patientId): Promise<EvolutionFeedEntry[]>` in `web/src/db/queries/patient-evolutions.ts`. Both the `GET /api/patients/[id]/evolutions` route (`D1`) and the print page (`I1`) MUST call this function — no duplicated merge/sort logic.

**RA-3. Legacy session-id fallback.** In the session→feed mapping inside `getPatientEvolutionFeed`, when a session has zero rows in `product_applications` / `face_diagrams` filtered by `procedure_session_id`, fall back to record-scoped rows (`procedure_record_id = session.procedure_record_id AND procedure_session_id IS NULL`). Mirror the existing pattern in `web/src/db/queries/face-diagrams.ts` and `web/src/db/queries/product-applications.ts`.

**RA-4. Role source.** There is no client-side `useAuth()` hook (`useProfile()` does not carry `role`). Source `role` from the server page: `web/src/app/(platform)/pacientes/[id]/page.tsx` reads `ctx.role` via `getAuthContext()` and passes it through `<PatientDetailPageClient role={ctx.role} />` → `<PatientDetailContent role={role} />` → `<PatientTabs role={role} />`. Do not invent client hooks.

**RA-5. VALID_TABS and invalid-tab fallback.** `VALID_TABS` in `patient-detail-content.tsx` MUST include `'evolucoes'`. When initializing `tab` state, if `activeTab === 'evolucoes'` but `role ∉ {'owner','practitioner'}`, fall back to `'dados'` so we never render an invalid hidden tab.

**RA-6. Input validation maps to 400, not 500.** All POST/PATCH/DELETE routes (`D1`, `D2`) MUST use `schema.safeParse(...)`; on failure return `NextResponse.json({ error: 'Validation failed', issues: parsed.error.flatten() }, { status: 400 })`. Only generic exceptions hit the 500 path.

**RA-7. Response shape — no envelopes.** Follow existing convention (see `/api/profile`, `/api/patients/...`): `GET` returns the resource (`{ entries: [...] }` for feed) directly. `POST` returns the created note (`{ note: {...} }`). `PATCH` returns the updated note. `DELETE` returns `204`. Do NOT wrap with `{ success, data }`.

**RA-8. Stable feed ordering.** Sort by `occurredAt DESC, id DESC`. Do NOT use `createdAt` as tiebreaker (session entries don't carry a comparable `createdAt`). `id` is monotone-ish UUID and stable across refetches.

**RA-9. Revisions are the edit audit; do not double-log to `audit_logs`.** Service `editNote` writes a row to `patient_evolution_revisions` and NOTHING to `audit_logs`. `softDeleteNote` writes to `audit_logs` (because deletion has a stated reason; there's no revisions row for deletes).

**RA-10. CASCADE invariant — documented.** `patient_evolution_revisions.evolution_id` keeps `ON DELETE CASCADE`. We never hard-delete soft-deleted notes today; if a maintenance job is added later, revisions go with the parent. Add a one-line schema comment to that effect.

**RA-11. Integration test fixtures.** Task `J1` MUST seed a real tenant, user, and patient using existing test seed helpers (look at `web/src/db/queries/__tests__/*.test.ts` for the pattern), OR drop the integration test and rely on `J2` (service-layer mocked) + `J3` (component). Do not insert evolutions referencing dangling FK UUIDs.

---

## Parallelization Groups

```
Group A — Foundation (3 parallel)
  A1 migration 0016 + journal
  A2 schema.ts (2 tables)
  A3 validations/patient-evolution.ts

Group B — Data layer (depends on A; 1 task)
  B1 queries/patient-evolutions.ts

Group C — Service layer (depends on B; 1 task)
  C1 lib/patient-evolutions.ts

Group D — API routes (depends on C; 3 parallel)
  D1 evolutions/route.ts (GET+POST)
  D2 evolutions/[noteId]/route.ts (PATCH+DELETE)
  D3 evolutions/[noteId]/revisions/route.ts (GET)

Group E — Hooks (depends on D; 2 parallel)
  E1 hooks/queries/use-evolutions.ts
  E2 hooks/mutations/use-evolution-mutations.ts

Group F — UI components (depends on E; 3 parallel)
  F1 evolution-entry-card.tsx
  F2 evolution-note-composer.tsx
  F3 evolution-revisions-drawer.tsx

Group G — Tab page (depends on F; 1 task)
  G1 patient-evolutions-tab.tsx

Group H — Tab strip + page mount (depends on G; 2 parallel)
  H1 patient-tabs.tsx (add tab + role filtering)
  H2 patient-detail-content.tsx (mount the tab page)

Group I — Print page (parallel with G/H; 2 parallel)
  I1 print/page.tsx
  I2 print-evolucoes-page-client.tsx

Group J — Tests (depends on everything else; 3 parallel)
  J1 db queries test
  J2 lib service test
  J3 component test
```

---

# Tasks

## Group A — Foundation

### Task A1: Migration 0016

**Files:**
- Create: `web/src/db/migrations/0016_patient_evolutions.sql`
- Modify: `web/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0016: Patient evoluções — clinical narrative tab.
-- 1. patient_evolutions: loose notes (free-text, patient-level, soft-deletable)
-- 2. patient_evolution_revisions: edit history snapshots (cascade-deleted with parent)

CREATE TABLE IF NOT EXISTS "floraclin"."patient_evolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "patient_id" uuid NOT NULL REFERENCES "floraclin"."patients"("id"),
  "body" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "floraclin"."users"("id"),
  "delete_reason" text
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolutions_feed"
  ON "floraclin"."patient_evolutions" ("tenant_id", "patient_id", "occurred_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolutions_author"
  ON "floraclin"."patient_evolutions" ("tenant_id", "author_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "floraclin"."patient_evolution_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "evolution_id" uuid NOT NULL REFERENCES "floraclin"."patient_evolutions"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "edited_by" uuid NOT NULL REFERENCES "floraclin"."users"("id"),
  "edited_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_patient_evolution_revisions_evolution"
  ON "floraclin"."patient_evolution_revisions" ("evolution_id", "edited_at" DESC);--> statement-breakpoint
```

- [ ] **Step 2: Append journal entry**

In `web/src/db/migrations/meta/_journal.json`, append after the `0015` entry:

```json
    {
      "idx": 16,
      "version": "7",
      "when": 1780700000000,
      "tag": "0016_patient_evolutions",
      "breakpoints": true
    }
```

- [ ] **Step 3: Verify the SQL runs cleanly**

Do NOT apply to any database (user's `no migrations without explicit approval` rule still applies). Just lint-check the SQL syntax visually. The migration uses `IF NOT EXISTS` throughout, so it's safe to rerun if the user ever decides to apply.

- [ ] **Step 4: Commit**

```bash
git add web/src/db/migrations/0016_patient_evolutions.sql web/src/db/migrations/meta/_journal.json
git commit -m "db: migration 0016 — patient evoluções + revisions"
```

---

### Task A2: schema.ts updates

**Files:**
- Modify: `web/src/db/schema.ts`

- [ ] **Step 1: Add the two table definitions**

Insert in `web/src/db/schema.ts` after the `patientPackageLines` section (or after `patientPackages` if `patientPackageLines` no longer exists post-0015). Pick a location near other "patient-level" tables.

```ts
// ─── PATIENT EVOLUTIONS ─────────────────────────────────────────────

export const patientEvolutions = floraclinSchema.table('patient_evolutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  body: text('body').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deleteReason: text('delete_reason'),
}, (table) => [
  index('idx_patient_evolutions_feed').on(table.tenantId, table.patientId, table.occurredAt),
  index('idx_patient_evolutions_author').on(table.tenantId, table.authorId),
])

export const patientEvolutionRevisions = floraclinSchema.table('patient_evolution_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  evolutionId: uuid('evolution_id').notNull().references(() => patientEvolutions.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  editedBy: uuid('edited_by').notNull().references(() => users.id),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_patient_evolution_revisions_evolution').on(table.evolutionId, table.editedAt),
])
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Must compile clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/db/schema.ts
git commit -m "db(schema): patientEvolutions + patientEvolutionRevisions"
```

---

### Task A3: Validations

**Files:**
- Create: `web/src/validations/patient-evolution.ts`

- [ ] **Step 1: Write the zod schemas**

```ts
import { z } from 'zod'

// Body length cap matches the migration's expectation; if a user pastes a
// huge wall of text we want to reject at the API boundary, not surface a
// Postgres `value too long` error.
export const EVOLUTION_BODY_MAX = 10_000

export const createEvolutionSchema = z.object({
  body: z.string().min(1, 'Conteúdo obrigatório').max(EVOLUTION_BODY_MAX),
  occurredAt: z.string().datetime().optional(),
})

export const editEvolutionSchema = z
  .object({
    body: z.string().min(1).max(EVOLUTION_BODY_MAX).optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine((d) => d.body !== undefined || d.occurredAt !== undefined, {
    message: 'Informe pelo menos um campo para editar',
  })

export const deleteEvolutionSchema = z.object({
  reason: z.string().max(1000).optional(),
})

export type CreateEvolutionInput = z.infer<typeof createEvolutionSchema>
export type EditEvolutionInput = z.infer<typeof editEvolutionSchema>
export type DeleteEvolutionInput = z.infer<typeof deleteEvolutionSchema>
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/validations/patient-evolution.ts
git commit -m "validations: patient-evolution zod schemas"
```

---

## Group B — Data layer

### Task B1: Queries

**Files:**
- Create: `web/src/db/queries/patient-evolutions.ts`

- [ ] **Step 1: Write the query module**

```ts
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  patientEvolutions,
  patientEvolutionRevisions,
  procedureSessions,
  procedureRecords,
  procedureTypes,
  productApplications,
  faceDiagrams,
  diagramPoints,
  users,
} from '@/db/schema'

export interface EvolutionNoteRow {
  id: string
  tenantId: string
  patientId: string
  body: string
  authorId: string
  authorName: string
  occurredAt: Date
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  revisionCount: number
}

export interface EvolutionRevisionRow {
  id: string
  body: string
  occurredAt: Date
  editedBy: string
  editedByName: string
  editedAt: Date
}

export interface EvolutionSessionRow {
  id: string
  occurredAt: Date
  executedById: string
  executedByName: string
  procedureRecordId: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number
  recordStatus: string
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: Array<{
    productName: string
    totalQuantity: string
    quantityUnit: string
  }>
  diagramPointCount: number
}

// ─── Notes ──────────────────────────────────────────────────────────

export async function listNotes(
  tenantId: string,
  patientId: string,
  tx: typeof db = db,
): Promise<EvolutionNoteRow[]> {
  const revCount = sql<number>`(
    SELECT COUNT(*)::int FROM floraclin.patient_evolution_revisions r
    WHERE r.evolution_id = ${patientEvolutions.id}
  )`
  return tx
    .select({
      id: patientEvolutions.id,
      tenantId: patientEvolutions.tenantId,
      patientId: patientEvolutions.patientId,
      body: patientEvolutions.body,
      authorId: patientEvolutions.authorId,
      authorName: users.fullName,
      occurredAt: patientEvolutions.occurredAt,
      createdAt: patientEvolutions.createdAt,
      updatedAt: patientEvolutions.updatedAt,
      deletedAt: patientEvolutions.deletedAt,
      deletedBy: patientEvolutions.deletedBy,
      deleteReason: patientEvolutions.deleteReason,
      revisionCount: revCount,
    })
    .from(patientEvolutions)
    .innerJoin(users, eq(patientEvolutions.authorId, users.id))
    .where(
      and(
        eq(patientEvolutions.tenantId, tenantId),
        eq(patientEvolutions.patientId, patientId),
        isNull(patientEvolutions.deletedAt),
      ),
    )
    .orderBy(desc(patientEvolutions.occurredAt), desc(patientEvolutions.createdAt))
}

export async function getNoteLockedForUpdate(
  tenantId: string,
  noteId: string,
  tx: typeof db,
): Promise<EvolutionNoteRow | null> {
  const result = await tx.execute(sql`
    SELECT id, tenant_id, patient_id, body, author_id, occurred_at, created_at,
           updated_at, deleted_at, deleted_by, delete_reason
    FROM floraclin.patient_evolutions
    WHERE id = ${noteId} AND tenant_id = ${tenantId}
    FOR UPDATE
  `)
  const rows = (Array.isArray(result)
    ? result
    : (result as { rows?: Record<string, unknown>[] }).rows ?? result) as Record<string, unknown>[]
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    patientId: String(r.patient_id),
    body: String(r.body),
    authorId: String(r.author_id),
    authorName: '', // not selected in the locked read; caller resolves via listNotes if needed
    occurredAt: new Date(String(r.occurred_at)),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    deletedAt: r.deleted_at ? new Date(String(r.deleted_at)) : null,
    deletedBy: r.deleted_by ? String(r.deleted_by) : null,
    deleteReason: r.delete_reason ? String(r.delete_reason) : null,
    revisionCount: 0, // not needed by callers of the locked read
  }
}

export async function insertNote(
  args: {
    tenantId: string
    patientId: string
    body: string
    authorId: string
    occurredAt: Date | null
  },
  tx: typeof db = db,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(patientEvolutions)
    .values({
      tenantId: args.tenantId,
      patientId: args.patientId,
      body: args.body,
      authorId: args.authorId,
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
    })
    .returning({ id: patientEvolutions.id })
  return row
}

export async function updateNote(
  args: {
    tenantId: string
    noteId: string
    body?: string
    occurredAt?: Date
  },
  tx: typeof db,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (args.body !== undefined) set.body = args.body
  if (args.occurredAt !== undefined) set.occurredAt = args.occurredAt
  await tx
    .update(patientEvolutions)
    .set(set)
    .where(
      and(
        eq(patientEvolutions.tenantId, args.tenantId),
        eq(patientEvolutions.id, args.noteId),
      ),
    )
}

export async function softDeleteNote(
  args: {
    tenantId: string
    noteId: string
    deletedBy: string
    reason: string | null
  },
  tx: typeof db,
): Promise<void> {
  await tx
    .update(patientEvolutions)
    .set({
      deletedAt: new Date(),
      deletedBy: args.deletedBy,
      deleteReason: args.reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(patientEvolutions.tenantId, args.tenantId),
        eq(patientEvolutions.id, args.noteId),
      ),
    )
}

// ─── Revisions ──────────────────────────────────────────────────────

export async function insertRevision(
  args: {
    tenantId: string
    evolutionId: string
    body: string
    occurredAt: Date
    editedBy: string
  },
  tx: typeof db,
): Promise<void> {
  await tx.insert(patientEvolutionRevisions).values({
    tenantId: args.tenantId,
    evolutionId: args.evolutionId,
    body: args.body,
    occurredAt: args.occurredAt,
    editedBy: args.editedBy,
  })
}

export async function listRevisions(
  tenantId: string,
  evolutionId: string,
  tx: typeof db = db,
): Promise<EvolutionRevisionRow[]> {
  return tx
    .select({
      id: patientEvolutionRevisions.id,
      body: patientEvolutionRevisions.body,
      occurredAt: patientEvolutionRevisions.occurredAt,
      editedBy: patientEvolutionRevisions.editedBy,
      editedByName: users.fullName,
      editedAt: patientEvolutionRevisions.editedAt,
    })
    .from(patientEvolutionRevisions)
    .innerJoin(users, eq(patientEvolutionRevisions.editedBy, users.id))
    .where(
      and(
        eq(patientEvolutionRevisions.tenantId, tenantId),
        eq(patientEvolutionRevisions.evolutionId, evolutionId),
      ),
    )
    .orderBy(desc(patientEvolutionRevisions.editedAt))
}

// ─── Sessions (for the feed) ────────────────────────────────────────

export async function listSessionsForPatient(
  tenantId: string,
  patientId: string,
  tx: typeof db = db,
): Promise<EvolutionSessionRow[]> {
  const productAppsAgg = sql<EvolutionSessionRow['productApplications']>`(
    SELECT COALESCE(json_agg(
      json_build_object(
        'productName', pa.product_name,
        'totalQuantity', pa.total_quantity,
        'quantityUnit', pa.quantity_unit
      )
      ORDER BY pa.product_name
    ), '[]'::json)
    FROM floraclin.product_applications pa
    WHERE pa.procedure_session_id = ${procedureSessions.id}
  )`
  const diagramPointCount = sql<number>`(
    SELECT COALESCE(SUM((
      SELECT COUNT(*)::int FROM floraclin.diagram_points dp WHERE dp.face_diagram_id = fd.id
    )), 0)::int
    FROM floraclin.face_diagrams fd
    WHERE fd.procedure_session_id = ${procedureSessions.id}
  )`

  return tx
    .select({
      id: procedureSessions.id,
      occurredAt: procedureSessions.performedAt,
      executedById: procedureSessions.executedBy,
      executedByName: users.fullName,
      procedureRecordId: procedureRecords.id,
      procedureTypeName: procedureTypes.name,
      sessionOrdinal: procedureSessions.sessionOrdinal,
      sessionsTotal: procedureRecords.sessionsTotal,
      recordStatus: procedureRecords.status,
      technique: procedureSessions.technique,
      clinicalResponse: procedureSessions.clinicalResponse,
      adverseEffects: procedureSessions.adverseEffects,
      notes: procedureSessions.notes,
      followUpDate: procedureSessions.followUpDate,
      nextSessionObjectives: procedureSessions.nextSessionObjectives,
      productApplications: productAppsAgg,
      diagramPointCount,
    })
    .from(procedureSessions)
    .innerJoin(users, eq(procedureSessions.executedBy, users.id))
    .innerJoin(procedureRecords, eq(procedureSessions.procedureRecordId, procedureRecords.id))
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(procedureSessions.tenantId, tenantId),
        eq(procedureRecords.patientId, patientId),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .orderBy(desc(procedureSessions.performedAt))
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/db/queries/patient-evolutions.ts
git commit -m "db(queries): patient-evolutions — notes + revisions + sessions feed"
```

---

## Group C — Service layer

### Task C1: `lib/patient-evolutions.ts`

**Files:**
- Create: `web/src/lib/patient-evolutions.ts`

- [ ] **Step 1: Write the service**

```ts
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import {
  insertNote,
  insertRevision,
  getNoteLockedForUpdate,
  updateNote,
  softDeleteNote,
} from '@/db/queries/patient-evolutions'

// Helper to keep audit `changes` excerpts under 200 chars so we don't
// stuff the audit_logs table with full note bodies.
function truncate(s: string, n = 200): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}

export interface CreateNoteArgs {
  tenantId: string
  patientId: string
  authorId: string
  body: string
  occurredAt: Date | null
}

export async function createNote(args: CreateNoteArgs): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const { id } = await insertNote(args, tx)
    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.authorId,
        action: 'create',
        entityType: 'patient_evolution',
        entityId: id,
        changes: { body: { old: null, new: truncate(args.body) } },
      },
      tx,
    )
    return { id }
  })
}

export interface EditNoteArgs {
  tenantId: string
  noteId: string
  editorId: string
  body?: string
  occurredAt?: Date
}

export async function editNote(args: EditNoteArgs): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getNoteLockedForUpdate(args.tenantId, args.noteId, tx)
    if (!current) throw new BusinessError('not_found', 'Evolução não encontrada')
    if (current.deletedAt) throw new BusinessError('note_deleted', 'Evolução foi excluída')

    // Snapshot the PRE-edit body + occurredAt into revisions so history
    // is preserved even if the new body equals the old (no harm).
    await insertRevision(
      {
        tenantId: args.tenantId,
        evolutionId: args.noteId,
        body: current.body,
        occurredAt: current.occurredAt,
        editedBy: args.editorId,
      },
      tx,
    )

    await updateNote(
      {
        tenantId: args.tenantId,
        noteId: args.noteId,
        body: args.body,
        occurredAt: args.occurredAt,
      },
      tx,
    )

    const changes: Record<string, { old: unknown; new: unknown }> = {}
    if (args.body !== undefined) {
      changes.body = { old: truncate(current.body), new: truncate(args.body) }
    }
    if (args.occurredAt !== undefined) {
      changes.occurredAt = {
        old: current.occurredAt.toISOString(),
        new: args.occurredAt.toISOString(),
      }
    }
    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.editorId,
        action: 'update',
        entityType: 'patient_evolution',
        entityId: args.noteId,
        changes,
      },
      tx,
    )
  })
}

export interface DeleteNoteArgs {
  tenantId: string
  noteId: string
  actorId: string
  reason: string | null
}

export async function deleteNote(args: DeleteNoteArgs): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getNoteLockedForUpdate(args.tenantId, args.noteId, tx)
    if (!current) throw new BusinessError('not_found', 'Evolução não encontrada')
    if (current.deletedAt) throw new BusinessError('already_deleted', 'Evolução já estava excluída')

    await softDeleteNote(
      {
        tenantId: args.tenantId,
        noteId: args.noteId,
        deletedBy: args.actorId,
        reason: args.reason,
      },
      tx,
    )

    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.actorId,
        action: 'update',
        entityType: 'patient_evolution',
        entityId: args.noteId,
        changes: {
          deletedAt: { old: null, new: new Date().toISOString() },
          reason: { old: null, new: args.reason },
        },
      },
      tx,
    )
  })
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/lib/patient-evolutions.ts
git commit -m "lib(patient-evolutions): create/edit/delete with revision snapshot + audit"
```

---

## Group D — API routes

### Task D1: `/api/patients/[id]/evolutions/route.ts`

**Files:**
- Create: `web/src/app/api/patients/[id]/evolutions/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  listNotes,
  listSessionsForPatient,
} from '@/db/queries/patient-evolutions'
import { createNote } from '@/lib/patient-evolutions'
import { createEvolutionSchema } from '@/validations/patient-evolution'

interface SessionEntry {
  kind: 'session'
  id: string
  occurredAt: string
  executedByName: string
  procedureRecordId: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number
  recordStatus: string
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: Array<{ productName: string; totalQuantity: string; quantityUnit: string }>
  diagramPointCount: number
}

interface NoteEntry {
  kind: 'note'
  id: string
  occurredAt: string
  body: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt: string
  revisionCount: number
}

type FeedEntry = SessionEntry | NoteEntry

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { id: patientId } = await params

    const [sessions, notes] = await Promise.all([
      listSessionsForPatient(ctx.tenantId, patientId),
      listNotes(ctx.tenantId, patientId),
    ])

    const sessionEntries: SessionEntry[] = sessions.map((s) => ({
      kind: 'session',
      id: s.id,
      occurredAt: s.occurredAt.toISOString(),
      executedByName: s.executedByName,
      procedureRecordId: s.procedureRecordId,
      procedureTypeName: s.procedureTypeName,
      sessionOrdinal: s.sessionOrdinal,
      sessionsTotal: s.sessionsTotal,
      recordStatus: s.recordStatus,
      technique: s.technique,
      clinicalResponse: s.clinicalResponse,
      adverseEffects: s.adverseEffects,
      notes: s.notes,
      followUpDate: s.followUpDate,
      nextSessionObjectives: s.nextSessionObjectives,
      productApplications: s.productApplications ?? [],
      diagramPointCount: Number(s.diagramPointCount ?? 0),
    }))

    const noteEntries: NoteEntry[] = notes.map((n) => ({
      kind: 'note',
      id: n.id,
      occurredAt: n.occurredAt.toISOString(),
      body: n.body,
      authorId: n.authorId,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      revisionCount: Number(n.revisionCount ?? 0),
    }))

    const entries: FeedEntry[] = [...sessionEntries, ...noteEntries].sort((a, b) => {
      // Sort by occurredAt DESC; tiebreak on createdAt DESC (notes only).
      const ao = Date.parse(a.occurredAt)
      const bo = Date.parse(b.occurredAt)
      if (ao !== bo) return bo - ao
      const aCreated = a.kind === 'note' ? Date.parse(a.createdAt) : ao
      const bCreated = b.kind === 'note' ? Date.parse(b.createdAt) : bo
      return bCreated - aCreated
    })

    return NextResponse.json({ success: true, data: { entries } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Evolutions GET error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { id: patientId } = await params
    const body = createEvolutionSchema.parse(await request.json())

    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : null
    const result = await createNote({
      tenantId: ctx.tenantId,
      patientId,
      authorId: ctx.userId,
      body: body.body,
      occurredAt,
    })

    return NextResponse.json({ success: true, data: { id: result.id } }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Evolutions POST error:', error)
    return NextResponse.json({ success: false, error: 'Erro ao criar evolução' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/api/patients/\[id\]/evolutions/route.ts
git commit -m "api(evolutions): GET feed + POST create"
```

---

### Task D2: `/api/patients/[id]/evolutions/[noteId]/route.ts`

**Files:**
- Create: `web/src/app/api/patients/[id]/evolutions/[noteId]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { BusinessError } from '@/lib/errors'
import {
  editEvolutionSchema,
  deleteEvolutionSchema,
} from '@/validations/patient-evolution'
import { editNote, deleteNote } from '@/lib/patient-evolutions'

function mapError(error: unknown) {
  if (error instanceof BusinessError) {
    const status = error.code === 'not_found' ? 404 : 409
    return NextResponse.json(
      { success: false, code: error.code, error: error.message },
      { status },
    )
  }
  const msg = error instanceof Error ? error.message : ''
  if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  console.error('Evolution noteId route error:', error)
  return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { noteId } = await params
    const body = editEvolutionSchema.parse(await request.json())

    await editNote({
      tenantId: ctx.tenantId,
      noteId,
      editorId: ctx.userId,
      body: body.body,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return mapError(error)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { noteId } = await params
    const parsed = deleteEvolutionSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten() },
        { status: 400 },
      )
    }

    await deleteNote({
      tenantId: ctx.tenantId,
      noteId,
      actorId: ctx.userId,
      reason: parsed.data.reason ?? null,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return mapError(error)
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/api/patients/\[id\]/evolutions/\[noteId\]/route.ts
git commit -m "api(evolutions): PATCH edit + DELETE soft-delete"
```

---

### Task D3: `/api/patients/[id]/evolutions/[noteId]/revisions/route.ts`

**Files:**
- Create: `web/src/app/api/patients/[id]/evolutions/[noteId]/revisions/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listRevisions } from '@/db/queries/patient-evolutions'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { noteId } = await params
    const rows = await listRevisions(ctx.tenantId, noteId)
    const data = rows.map((r) => ({
      id: r.id,
      body: r.body,
      occurredAt: r.occurredAt.toISOString(),
      editedBy: r.editedBy,
      editedByName: r.editedByName,
      editedAt: r.editedAt.toISOString(),
    }))
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Revisions GET error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/api/patients/\[id\]/evolutions/\[noteId\]/revisions/route.ts
git commit -m "api(evolutions): GET revisions"
```

---

## Group E — Hooks

### Task E1: Read hook

**Files:**
- Create: `web/src/hooks/queries/use-evolutions.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useQuery } from '@tanstack/react-query'

export interface EvolutionSessionEntry {
  kind: 'session'
  id: string
  occurredAt: string
  executedByName: string
  procedureRecordId: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number
  recordStatus: string
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: Array<{ productName: string; totalQuantity: string; quantityUnit: string }>
  diagramPointCount: number
}

export interface EvolutionNoteEntry {
  kind: 'note'
  id: string
  occurredAt: string
  body: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt: string
  revisionCount: number
}

export type EvolutionEntry = EvolutionSessionEntry | EvolutionNoteEntry

export interface EvolutionRevision {
  id: string
  body: string
  occurredAt: string
  editedBy: string
  editedByName: string
  editedAt: string
}

export const evolutionsKeys = {
  list: (patientId: string) => ['patient-evolutions', patientId] as const,
  revisions: (patientId: string, noteId: string) =>
    ['patient-evolutions', patientId, noteId, 'revisions'] as const,
}

export function useEvolutions(patientId: string) {
  return useQuery({
    queryKey: evolutionsKeys.list(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/evolutions`)
      if (!res.ok) throw new Error('Falha ao carregar evoluções')
      const json = await res.json()
      const entries = (json?.data?.entries ?? []) as EvolutionEntry[]
      return entries
    },
  })
}

export function useEvolutionRevisions(patientId: string, noteId: string | null) {
  return useQuery({
    queryKey: noteId ? evolutionsKeys.revisions(patientId, noteId) : ['patient-evolutions', patientId, 'revisions-disabled'],
    enabled: !!patientId && !!noteId,
    queryFn: async () => {
      if (!noteId) return []
      const res = await fetch(`/api/patients/${patientId}/evolutions/${noteId}/revisions`)
      if (!res.ok) throw new Error('Falha ao carregar histórico')
      const json = await res.json()
      return (json?.data ?? []) as EvolutionRevision[]
    },
  })
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/hooks/queries/use-evolutions.ts
git commit -m "hooks: useEvolutions + useEvolutionRevisions"
```

---

### Task E2: Mutation hooks

**Files:**
- Create: `web/src/hooks/mutations/use-evolution-mutations.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { evolutionsKeys } from '@/hooks/queries/use-evolutions'
import type {
  CreateEvolutionInput,
  EditEvolutionInput,
  DeleteEvolutionInput,
} from '@/validations/patient-evolution'

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `HTTP ${res.status}`)
  }
  return json as T
}

export function useCreateEvolution(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEvolutionInput) =>
      jsonFetch<{ success: true; data: { id: string } }>(
        `/api/patients/${patientId}/evolutions`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evolutionsKeys.list(patientId) })
    },
  })
}

export function useEditEvolution(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: EditEvolutionInput }) =>
      jsonFetch<{ success: true }>(
        `/api/patients/${patientId}/evolutions/${noteId}`,
        { method: 'PATCH', body: JSON.stringify(input) },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: evolutionsKeys.list(patientId) })
      qc.invalidateQueries({ queryKey: evolutionsKeys.revisions(patientId, vars.noteId) })
    },
  })
}

export function useDeleteEvolution(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: DeleteEvolutionInput }) =>
      jsonFetch<{ success: true }>(
        `/api/patients/${patientId}/evolutions/${noteId}`,
        { method: 'DELETE', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evolutionsKeys.list(patientId) })
    },
  })
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/hooks/mutations/use-evolution-mutations.ts
git commit -m "hooks: create/edit/delete evolution mutations"
```

---

## Group F — UI components

### Task F1: `evolution-entry-card.tsx`

**Files:**
- Create: `web/src/components/patients/evolution-entry-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatDate } from '@/lib/utils'
import type { EvolutionEntry } from '@/hooks/queries/use-evolutions'

interface EvolutionEntryCardProps {
  patientId: string
  entry: EvolutionEntry
  onEdit?: (entry: Extract<EvolutionEntry, { kind: 'note' }>) => void
  onDelete?: (entry: Extract<EvolutionEntry, { kind: 'note' }>) => void
  onViewRevisions?: (entry: Extract<EvolutionEntry, { kind: 'note' }>) => void
}

const FIELD_LABELS: Record<string, string> = {
  technique: 'Técnica',
  clinicalResponse: 'Resposta clínica',
  adverseEffects: 'Efeitos adversos',
  notes: 'Observações',
  nextSessionObjectives: 'Próximos objetivos',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  // Single-line: "28 mai 2026 · 14:32" — kept local since this string is
  // surfaced multiple times in the file; calling formatDate(d) only gives the date.
  const date = formatDate(d)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export function EvolutionEntryCard({
  patientId,
  entry,
  onEdit,
  onDelete,
  onViewRevisions,
}: EvolutionEntryCardProps) {
  if (entry.kind === 'session') {
    return <SessionCard patientId={patientId} entry={entry} />
  }
  return (
    <NoteCard
      entry={entry}
      onEdit={onEdit}
      onDelete={onDelete}
      onViewRevisions={onViewRevisions}
    />
  )
}

// ── Session card ───────────────────────────────────────────────────

function SessionCard({
  patientId,
  entry,
}: {
  patientId: string
  entry: Extract<EvolutionEntry, { kind: 'session' }>
}) {
  const isCancelledLine = entry.recordStatus === 'cancelled'
  const fields = (
    [
      ['technique', entry.technique],
      ['clinicalResponse', entry.clinicalResponse],
      ['adverseEffects', entry.adverseEffects],
      ['notes', entry.notes],
      ['nextSessionObjectives', entry.nextSessionObjectives],
    ] as const
  ).filter(([, v]) => !!v && v.trim().length > 0)

  return (
    <article
      className={cn(
        'rounded-[3px] border border-sage/15 bg-white px-5 py-4',
        isCancelledLine && 'opacity-70',
      )}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[14px] text-charcoal tabular-nums">
            {formatDateTime(entry.occurredAt)}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-forest">
          Sessão {entry.sessionOrdinal} de {entry.sessionsTotal}
        </span>
      </header>

      <p className="text-[11px] uppercase tracking-wider text-mid mb-3">
        {entry.procedureTypeName}
        <span className="mx-1.5 text-mid/40">·</span>
        {entry.executedByName}
        {isCancelledLine && <span className="ml-1.5 text-mid/60">· linha cancelada</span>}
      </p>

      <dl className="space-y-3">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-mid mb-1">
              {FIELD_LABELS[key]}
            </dt>
            <dd className="text-[13px] text-charcoal whitespace-pre-wrap">{value}</dd>
          </div>
        ))}

        {entry.productApplications.length > 0 && (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-mid mb-1">
              Produtos aplicados
            </dt>
            <dd className="text-[13px] text-charcoal">
              <ul className="space-y-0.5">
                {entry.productApplications.map((p, i) => (
                  <li key={i}>
                    · {p.productName} <span className="text-mid">{p.totalQuantity} {p.quantityUnit}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {entry.diagramPointCount > 0 && (
          <div>
            <dd className="text-[12px] text-mid">
              {entry.diagramPointCount} ponto(s) de aplicação ·{' '}
              <Link
                href={`/pacientes/${patientId}/procedimentos/${entry.procedureRecordId}`}
                className="text-forest underline-offset-2 hover:underline"
              >
                ver detalhes →
              </Link>
            </dd>
          </div>
        )}

        {entry.followUpDate && (
          <div>
            <dd className="text-[12px] text-mid">
              <span className="uppercase tracking-wider">Retorno</span> ·{' '}
              <span className="tabular-nums text-charcoal">{formatDate(entry.followUpDate)}</span>
            </dd>
          </div>
        )}
      </dl>
    </article>
  )
}

// ── Note card ──────────────────────────────────────────────────────

function NoteCard({
  entry,
  onEdit,
  onDelete,
  onViewRevisions,
}: {
  entry: Extract<EvolutionEntry, { kind: 'note' }>
  onEdit?: (e: Extract<EvolutionEntry, { kind: 'note' }>) => void
  onDelete?: (e: Extract<EvolutionEntry, { kind: 'note' }>) => void
  onViewRevisions?: (e: Extract<EvolutionEntry, { kind: 'note' }>) => void
}) {
  return (
    <article className="rounded-[3px] border border-sage/15 bg-white px-5 py-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[14px] text-charcoal tabular-nums">
            {formatDateTime(entry.occurredAt)}
          </span>
          <span className="text-[11px] text-mid">{entry.authorName}</span>
        </div>
        {(onEdit || onDelete || onViewRevisions) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Ações da evolução">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && <DropdownMenuItem onClick={() => onEdit(entry)}>Editar</DropdownMenuItem>}
              {onViewRevisions && entry.revisionCount > 0 && (
                <DropdownMenuItem onClick={() => onViewRevisions(entry)}>
                  Histórico de edições
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(entry)}
                  className="text-red-600 focus:text-red-700"
                >
                  Excluir
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <p className="text-[13px] text-charcoal whitespace-pre-wrap">{entry.body}</p>

      {entry.revisionCount > 0 && (
        <button
          type="button"
          onClick={() => onViewRevisions?.(entry)}
          className="mt-3 text-[11px] text-mid hover:text-charcoal underline-offset-2 hover:underline"
        >
          Editado {entry.revisionCount}× · ver histórico
        </button>
      )}
    </article>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/patients/evolution-entry-card.tsx
git commit -m "evolution-entry-card: chart-style session + note renderer"
```

---

### Task F2: `evolution-note-composer.tsx`

**Files:**
- Create: `web/src/components/patients/evolution-note-composer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  useCreateEvolution,
  useEditEvolution,
} from '@/hooks/mutations/use-evolution-mutations'
import { EVOLUTION_BODY_MAX } from '@/validations/patient-evolution'
import type { EvolutionNoteEntry } from '@/hooks/queries/use-evolutions'

interface EvolutionNoteComposerProps {
  patientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When present, opens in edit mode prefilled with this note. */
  noteToEdit?: EvolutionNoteEntry | null
}

// Converts an ISO datetime → the value format expected by <input type="datetime-local"> ("YYYY-MM-DDTHH:mm" in local time).
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nowLocal(): string {
  return isoToDatetimeLocal(new Date().toISOString())
}

export function EvolutionNoteComposer({
  patientId,
  open,
  onOpenChange,
  noteToEdit = null,
}: EvolutionNoteComposerProps) {
  const isEdit = !!noteToEdit
  const [body, setBody] = useState('')
  const [occurredAtLocal, setOccurredAtLocal] = useState(nowLocal())

  const create = useCreateEvolution(patientId)
  const edit = useEditEvolution(patientId)
  const submitting = create.isPending || edit.isPending

  // Reset state when the dialog opens or the target note changes.
  useEffect(() => {
    if (!open) return
    setBody(noteToEdit?.body ?? '')
    setOccurredAtLocal(noteToEdit ? isoToDatetimeLocal(noteToEdit.occurredAt) : nowLocal())
  }, [open, noteToEdit])

  const handleSubmit = async () => {
    if (body.trim().length === 0) {
      toast.error('Descreva o que aconteceu antes de salvar.')
      return
    }
    // datetime-local → ISO. We rely on the browser's interpretation of local time.
    const occurredAt = new Date(occurredAtLocal).toISOString()
    try {
      if (isEdit && noteToEdit) {
        await edit.mutateAsync({ noteId: noteToEdit.id, input: { body, occurredAt } })
        toast.success('Evolução atualizada')
      } else {
        await create.mutateAsync({ body, occurredAt })
        toast.success('Evolução registrada')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar evolução')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar evolução' : 'Nova evolução'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="evolution-occurred-at">Data e hora</Label>
            <Input
              id="evolution-occurred-at"
              type="datetime-local"
              value={occurredAtLocal}
              onChange={(e) => setOccurredAtLocal(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evolution-body">Descrição</Label>
            <Textarea
              id="evolution-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Descreva o que aconteceu..."
              maxLength={EVOLUTION_BODY_MAX}
              rows={8}
              disabled={submitting}
              className="resize-y"
            />
            <div className="flex justify-end text-[11px] text-mid tabular-nums">
              {body.length} / {EVOLUTION_BODY_MAX}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Salvar evolução'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/patients/evolution-note-composer.tsx
git commit -m "evolution-note-composer: create/edit modal"
```

---

### Task F3: `evolution-revisions-drawer.tsx`

**Files:**
- Create: `web/src/components/patients/evolution-revisions-drawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useEvolutionRevisions } from '@/hooks/queries/use-evolutions'
import { formatDate } from '@/lib/utils'

interface EvolutionRevisionsDrawerProps {
  patientId: string
  noteId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${formatDate(d)} · ${time}`
}

export function EvolutionRevisionsDrawer({
  patientId,
  noteId,
  open,
  onOpenChange,
}: EvolutionRevisionsDrawerProps) {
  const { data: revisions = [], isLoading } = useEvolutionRevisions(patientId, noteId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Histórico de edições</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {isLoading && <p className="text-[12px] text-mid">Carregando…</p>}
          {!isLoading && revisions.length === 0 && (
            <p className="text-[12px] text-mid">Nenhuma edição registrada.</p>
          )}
          {revisions.map((rev) => (
            <article key={rev.id} className="border-l-2 border-sage/30 pl-3">
              <p className="text-[11px] uppercase tracking-wider text-mid">
                Editado por {rev.editedByName} · {formatDateTime(rev.editedAt)}
              </p>
              <p className="mt-1 text-[10px] text-mid/70">
                Data registrada na evolução: {formatDateTime(rev.occurredAt)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-charcoal">{rev.body}</p>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verify Sheet component exists**

```bash
ls web/src/components/ui/sheet.tsx
```

If missing, add it via the shadcn pattern (`pnpm dlx shadcn@latest add sheet`) — but report the gap; do not silently install.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/patients/evolution-revisions-drawer.tsx
git commit -m "evolution-revisions-drawer: edit-history sheet"
```

---

## Group G — Tab page

### Task G1: `patient-evolutions-tab.tsx`

**Files:**
- Create: `web/src/components/patients/patient-evolutions-tab.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, Plus, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useEvolutions } from '@/hooks/queries/use-evolutions'
import { useDeleteEvolution } from '@/hooks/mutations/use-evolution-mutations'
import type { EvolutionNoteEntry } from '@/hooks/queries/use-evolutions'
import { EvolutionEntryCard } from './evolution-entry-card'
import { EvolutionNoteComposer } from './evolution-note-composer'
import { EvolutionRevisionsDrawer } from './evolution-revisions-drawer'

interface PatientEvolutionsTabProps {
  patientId: string
}

export function PatientEvolutionsTab({ patientId }: PatientEvolutionsTabProps) {
  const { data: entries = [], isLoading } = useEvolutions(patientId)
  const remove = useDeleteEvolution(patientId)

  const [composerOpen, setComposerOpen] = useState(false)
  const [noteToEdit, setNoteToEdit] = useState<EvolutionNoteEntry | null>(null)

  const [revisionsNoteId, setRevisionsNoteId] = useState<string | null>(null)

  const [pendingDelete, setPendingDelete] = useState<EvolutionNoteEntry | null>(null)
  const [deleteReason, setDeleteReason] = useState('')

  const openCreate = () => {
    setNoteToEdit(null)
    setComposerOpen(true)
  }
  const openEdit = (note: EvolutionNoteEntry) => {
    setNoteToEdit(note)
    setComposerOpen(true)
  }
  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await remove.mutateAsync({
        noteId: pendingDelete.id,
        input: { reason: deleteReason.trim() || undefined },
      })
      toast.success('Evolução excluída')
      setPendingDelete(null)
      setDeleteReason('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir evolução')
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] uppercase tracking-[0.15em] font-medium text-mid">
            Evoluções
          </span>
          <span className="text-[12px] text-mid/50">
            {entries.length} {entries.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/pacientes/${patientId}/evolucoes/imprimir`}
            target="_blank"
            className="text-[11px] uppercase tracking-wider text-mid hover:text-charcoal inline-flex items-center gap-1"
          >
            <Printer className="size-3" /> Imprimir
          </Link>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            Nova evolução
          </Button>
        </div>
      </header>

      {isLoading ? (
        <p className="text-[12px] text-mid">Carregando…</p>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#F4F6F8]">
            <BookOpen className="size-6 text-mid/40" />
          </div>
          <p className="text-[14px] font-medium text-charcoal">Nenhuma evolução registrada</p>
          <p className="mt-1 text-[12px] text-mid">
            Adicione uma evolução manual ou registre uma sessão pelo atendimento.
          </p>
          <Button size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="size-3.5" />
            Nova evolução
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EvolutionEntryCard
              key={`${entry.kind}-${entry.id}`}
              patientId={patientId}
              entry={entry}
              onEdit={entry.kind === 'note' ? openEdit : undefined}
              onDelete={entry.kind === 'note' ? setPendingDelete : undefined}
              onViewRevisions={
                entry.kind === 'note' ? (n) => setRevisionsNoteId(n.id) : undefined
              }
            />
          ))}
        </div>
      )}

      <EvolutionNoteComposer
        patientId={patientId}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        noteToEdit={noteToEdit}
      />

      <EvolutionRevisionsDrawer
        patientId={patientId}
        noteId={revisionsNoteId}
        open={!!revisionsNoteId}
        onOpenChange={(open) => !open && setRevisionsNoteId(null)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
            setDeleteReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir evolução</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é reversível pelo administrador. Você pode opcionalmente registrar o motivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="evolution-delete-reason">Motivo (opcional)</Label>
            <Textarea
              id="evolution-delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ex.: nota duplicada"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/patients/patient-evolutions-tab.tsx
git commit -m "patient-evolutions-tab: feed page with composer/drawer/delete"
```

---

## Group H — Tab strip + page mount

### Task H1: `patient-tabs.tsx`

**Files:**
- Modify: `web/src/components/patients/patient-tabs.tsx`

- [ ] **Step 1: Update the TABS config to support role gating + add Evoluções**

Update the file as follows:

```ts
'use client'

import { cn } from '@/lib/utils'
import {
  User,
  ClipboardList,
  Syringe,
  Camera,
  FileCheck,
  Banknote,
  Clock,
  Package,
  FileText,
  BookOpen,
} from 'lucide-react'
import type { Role } from '@/types'

interface TabConfig {
  key: string
  label: string
  icon: typeof User
  requiredRoles?: Role[]
}

const TABS: readonly TabConfig[] = [
  { key: 'dados', label: 'Dados', icon: User },
  { key: 'anamnese', label: 'Anamnese', icon: ClipboardList },
  { key: 'evolucoes', label: 'Evoluções', icon: BookOpen, requiredRoles: ['owner', 'practitioner'] },
  { key: 'procedimentos', label: 'Atendimentos', icon: Syringe },
  { key: 'pacotes', label: 'Pacotes', icon: Package },
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'fotos', label: 'Fotos', icon: Camera },
  { key: 'termos', label: 'Termos', icon: FileCheck },
  { key: 'financeiro', label: 'Financeiro', icon: Banknote },
  { key: 'timeline', label: 'Timeline', icon: Clock },
] as const

export type PatientTabKey = (typeof TABS)[number]['key']

interface PatientTabsProps {
  activeTab: PatientTabKey
  onTabChange: (tab: PatientTabKey) => void
  /** Caller-supplied role used to filter visible tabs. */
  role?: Role
}

export function PatientTabs({ activeTab, onTabChange, role }: PatientTabsProps) {
  const visibleTabs = TABS.filter(
    (t) => !t.requiredRoles || (role !== undefined && t.requiredRoles.includes(role)),
  )

  return (
    <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <nav className="flex overflow-x-auto" aria-label="Abas do paciente">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              data-testid={`patient-tab-${tab.key}`}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 whitespace-nowrap px-5 py-3.5 text-[13px] font-medium transition-all duration-200',
                isActive ? 'text-forest' : 'text-mid hover:text-charcoal',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                className={cn(
                  'size-3.5 transition-colors duration-200',
                  isActive ? 'text-sage' : 'text-mid/50 group-hover:text-mid',
                )}
              />
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] bg-forest rounded-full" />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Errors in `patient-detail-content.tsx` are expected if the caller doesn't yet pass `role`. H2 fixes that.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/patients/patient-tabs.tsx
git commit -m "patient-tabs: add Evoluções tab with role gating"
```

---

### Task H2: `patient-detail-content.tsx`

**Files:**
- Modify: `web/src/components/patients/patient-detail-content.tsx`

- [ ] **Step 1: Add the evolucoes case + pass role to PatientTabs**

Find the existing tab-switch block (`{tab === 'procedimentos' && (…)}` etc.) and add a new branch for `evolucoes`:

```tsx
{tab === 'evolucoes' && (
  <PatientEvolutionsTab patientId={patient.id} />
)}
```

Find the `<PatientTabs ... />` invocation and add `role={role}` — `role` should already be in scope from the auth/tenant context the page client already uses. If not, derive it from whatever auth hook the file uses today (`useAuth` / `useTenant`); a 5-line lookup, not a refactor.

Add the import at the top:

```ts
import { PatientEvolutionsTab } from './patient-evolutions-tab'
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/components/patients/patient-detail-content.tsx
git commit -m "patient-detail-content: mount Evoluções tab + pass role"
```

---

## Group I — Print page

### Task I1: Print route

**Files:**
- Create: `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/page.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { listNotes, listSessionsForPatient } from '@/db/queries/patient-evolutions'
import { getPatient } from '@/db/queries/patients'
import { PrintEvolucoesPageClient } from './print-evolucoes-page-client'

interface Params {
  id: string
}

export default async function PrintEvolucoesPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { id: patientId } = await params
  const ctx = await requireRole('owner', 'practitioner')

  const patient = await getPatient(ctx.tenantId, patientId)
  if (!patient) notFound()

  const [sessions, notes] = await Promise.all([
    listSessionsForPatient(ctx.tenantId, patientId),
    listNotes(ctx.tenantId, patientId),
  ])

  return (
    <PrintEvolucoesPageClient
      patient={{ id: patient.id, fullName: patient.fullName }}
      sessions={sessions.map((s) => ({
        id: s.id,
        occurredAt: s.occurredAt.toISOString(),
        executedByName: s.executedByName,
        procedureTypeName: s.procedureTypeName,
        sessionOrdinal: s.sessionOrdinal,
        sessionsTotal: s.sessionsTotal,
        technique: s.technique,
        clinicalResponse: s.clinicalResponse,
        adverseEffects: s.adverseEffects,
        notes: s.notes,
        followUpDate: s.followUpDate,
        nextSessionObjectives: s.nextSessionObjectives,
        productApplications: s.productApplications ?? [],
        diagramPointCount: Number(s.diagramPointCount ?? 0),
      }))}
      notes={notes.map((n) => ({
        id: n.id,
        occurredAt: n.occurredAt.toISOString(),
        body: n.body,
        authorName: n.authorName,
      }))}
    />
  )
}
```

- [ ] **Step 2: Verify `getPatient` query function exists**

```bash
grep -n 'export async function getPatient\b' web/src/db/queries/patients.ts
```

If it doesn't exist, look for the equivalent (e.g., `getPatientById`) and adjust.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/\(print\)/pacientes/\[id\]/evolucoes/imprimir/page.tsx
git commit -m "print(evolucoes): page route"
```

---

### Task I2: Print client

**Files:**
- Create: `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/print-evolucoes-page-client.tsx`

- [ ] **Step 1: Write the client**

```tsx
'use client'

import { formatDate } from '@/lib/utils'

interface SessionItem {
  id: string
  occurredAt: string
  executedByName: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: Array<{ productName: string; totalQuantity: string; quantityUnit: string }>
  diagramPointCount: number
}

interface NoteItem {
  id: string
  occurredAt: string
  body: string
  authorName: string
}

interface Props {
  patient: { id: string; fullName: string }
  sessions: SessionItem[]
  notes: NoteItem[]
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${formatDate(d)} · ${time}`
}

type FeedItem =
  | ({ kind: 'session' } & SessionItem)
  | ({ kind: 'note' } & NoteItem)

export function PrintEvolucoesPageClient({ patient, sessions, notes }: Props) {
  const items: FeedItem[] = [
    ...sessions.map((s) => ({ kind: 'session' as const, ...s })),
    ...notes.map((n) => ({ kind: 'note' as const, ...n })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))

  return (
    <div data-print-area className="mx-auto max-w-3xl px-8 py-10 text-black">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-2xl font-medium">Evoluções clínicas</h1>
        <p className="mt-1 text-sm">Paciente: {patient.fullName}</p>
        <p className="text-xs text-neutral-500">Emitido em {formatDateTime(new Date().toISOString())}</p>
      </header>

      {items.length === 0 ? (
        <p className="text-sm">Nenhuma evolução registrada para este paciente.</p>
      ) : (
        <div className="space-y-6">
          {items.map((item) => (
            <article key={`${item.kind}-${item.id}`} className="break-inside-avoid border-b pb-4">
              <header className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-medium">{formatDateTime(item.occurredAt)}</span>
                <span className="text-xs uppercase tracking-wider text-neutral-500">
                  {item.kind === 'session'
                    ? `Sessão ${item.sessionOrdinal}/${item.sessionsTotal} · ${item.procedureTypeName}`
                    : 'Nota livre'}
                </span>
              </header>
              <p className="text-xs text-neutral-600 mb-3">
                {item.kind === 'session' ? `Executor: ${item.executedByName}` : `Autor: ${item.authorName}`}
              </p>

              {item.kind === 'note' ? (
                <p className="whitespace-pre-wrap text-sm">{item.body}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {item.technique && <Field label="Técnica" value={item.technique} />}
                  {item.clinicalResponse && <Field label="Resposta clínica" value={item.clinicalResponse} />}
                  {item.adverseEffects && <Field label="Efeitos adversos" value={item.adverseEffects} />}
                  {item.notes && <Field label="Observações" value={item.notes} />}
                  {item.productApplications.length > 0 && (
                    <Field
                      label="Produtos aplicados"
                      value={item.productApplications
                        .map((p) => `${p.productName} · ${p.totalQuantity} ${p.quantityUnit}`)
                        .join('\n')}
                    />
                  )}
                  {item.diagramPointCount > 0 && (
                    <p className="text-xs text-neutral-500">{item.diagramPointCount} pontos de aplicação</p>
                  )}
                  {item.nextSessionObjectives && (
                    <Field label="Próximos objetivos" value={item.nextSessionObjectives} />
                  )}
                  {item.followUpDate && (
                    <p className="text-xs">
                      <span className="uppercase tracking-wider text-neutral-500">Retorno:</span>{' '}
                      {formatDate(item.followUpDate)}
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/app/\(print\)/pacientes/\[id\]/evolucoes/imprimir/print-evolucoes-page-client.tsx
git commit -m "print(evolucoes): client component"
```

---

## Group J — Tests

### Task J1: Query integration test

**Files:**
- Create: `web/src/db/queries/__tests__/patient-evolutions.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { patientEvolutions } from '@/db/schema'
import {
  insertNote,
  insertRevision,
  listNotes,
  listRevisions,
  softDeleteNote,
  updateNote,
} from '../patient-evolutions'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

describeIntegration('patient-evolutions queries (integration)', () => {
  it('insertNote then listNotes returns the row excluding deleted', async () => {
    await db.delete(patientEvolutions)
    const tenantId = '00000000-0000-0000-0000-000000000001'
    const patientId = '00000000-0000-0000-0000-000000000002'
    const authorId = '00000000-0000-0000-0000-000000000003'
    const { id } = await insertNote({ tenantId, patientId, authorId, body: 'first', occurredAt: null })
    const notes = await listNotes(tenantId, patientId)
    expect(notes).toHaveLength(1)
    expect(notes[0].id).toBe(id)
    expect(notes[0].body).toBe('first')

    await db.transaction(async (tx) => {
      await softDeleteNote({ tenantId, noteId: id, deletedBy: authorId, reason: null }, tx)
    })
    const after = await listNotes(tenantId, patientId)
    expect(after).toHaveLength(0)
  })

  it('updateNote + insertRevision feed listRevisions', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000001'
    const patientId = '00000000-0000-0000-0000-000000000002'
    const authorId = '00000000-0000-0000-0000-000000000003'
    const { id } = await insertNote({ tenantId, patientId, authorId, body: 'v1', occurredAt: null })
    await db.transaction(async (tx) => {
      await insertRevision(
        { tenantId, evolutionId: id, body: 'v1', occurredAt: new Date(), editedBy: authorId },
        tx,
      )
      await updateNote({ tenantId, noteId: id, body: 'v2' }, tx)
    })
    const revs = await listRevisions(tenantId, id)
    expect(revs).toHaveLength(1)
    expect(revs[0].body).toBe('v1')
  })
})
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @floraclin/web typecheck
git add web/src/db/queries/__tests__/patient-evolutions.test.ts
git commit -m "test(patient-evolutions queries): integration coverage"
```

---

### Task J2: Service-layer test

**Files:**
- Create: `web/src/lib/__tests__/patient-evolutions.test.ts`

- [ ] **Step 1: Write the test**

The service uses `db.transaction(...)`. Mock the db client + queries the same way `session-execute.test.ts` does:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const txOps: Array<{ op: string; args: unknown }> = []

vi.mock('@/db/client', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  },
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async (args: unknown) => {
    txOps.push({ op: 'audit', args })
  }),
}))

const noteRows = new Map<string, { body: string; occurredAt: Date; deletedAt: Date | null }>()

vi.mock('@/db/queries/patient-evolutions', () => ({
  insertNote: vi.fn(async ({ body }: { body: string }) => {
    const id = `note-${noteRows.size + 1}`
    noteRows.set(id, { body, occurredAt: new Date(), deletedAt: null })
    txOps.push({ op: 'insertNote', args: { body } })
    return { id }
  }),
  insertRevision: vi.fn(async (args: unknown) => {
    txOps.push({ op: 'insertRevision', args })
  }),
  getNoteLockedForUpdate: vi.fn(async (_t: string, noteId: string) => {
    const row = noteRows.get(noteId)
    if (!row) return null
    return {
      id: noteId,
      tenantId: 't',
      patientId: 'p',
      body: row.body,
      authorId: 'a',
      authorName: '',
      occurredAt: row.occurredAt,
      createdAt: row.occurredAt,
      updatedAt: row.occurredAt,
      deletedAt: row.deletedAt,
      deletedBy: null,
      deleteReason: null,
      revisionCount: 0,
    }
  }),
  updateNote: vi.fn(async ({ noteId, body, occurredAt }: { noteId: string; body?: string; occurredAt?: Date }) => {
    const row = noteRows.get(noteId)
    if (!row) return
    if (body !== undefined) row.body = body
    if (occurredAt !== undefined) row.occurredAt = occurredAt
    txOps.push({ op: 'updateNote', args: { noteId, body, occurredAt } })
  }),
  softDeleteNote: vi.fn(async ({ noteId }: { noteId: string }) => {
    const row = noteRows.get(noteId)
    if (row) row.deletedAt = new Date()
    txOps.push({ op: 'softDeleteNote', args: { noteId } })
  }),
}))

import { createNote, editNote, deleteNote } from '../patient-evolutions'

beforeEach(() => {
  noteRows.clear()
  txOps.length = 0
})

describe('patient-evolutions service', () => {
  it('createNote inserts + audits', async () => {
    const { id } = await createNote({
      tenantId: 't',
      patientId: 'p',
      authorId: 'a',
      body: 'hello',
      occurredAt: null,
    })
    expect(id).toMatch(/^note-/)
    const ops = txOps.map((o) => o.op)
    expect(ops).toEqual(['insertNote', 'audit'])
  })

  it('editNote snapshots pre-edit body before update', async () => {
    const { id } = await createNote({
      tenantId: 't', patientId: 'p', authorId: 'a', body: 'v1', occurredAt: null,
    })
    txOps.length = 0
    await editNote({ tenantId: 't', noteId: id, editorId: 'b', body: 'v2' })
    const ops = txOps.map((o) => o.op)
    expect(ops).toEqual(['insertRevision', 'updateNote', 'audit'])
    expect(noteRows.get(id)!.body).toBe('v2')
  })

  it('editNote rejects deleted note', async () => {
    const { id } = await createNote({
      tenantId: 't', patientId: 'p', authorId: 'a', body: 'v1', occurredAt: null,
    })
    await deleteNote({ tenantId: 't', noteId: id, actorId: 'a', reason: null })
    await expect(
      editNote({ tenantId: 't', noteId: id, editorId: 'b', body: 'v2' }),
    ).rejects.toThrow(/excluída/)
  })

  it('deleteNote refuses double-delete', async () => {
    const { id } = await createNote({
      tenantId: 't', patientId: 'p', authorId: 'a', body: 'v1', occurredAt: null,
    })
    await deleteNote({ tenantId: 't', noteId: id, actorId: 'a', reason: null })
    await expect(
      deleteNote({ tenantId: 't', noteId: id, actorId: 'a', reason: null }),
    ).rejects.toThrow(/já estava/)
  })
})
```

- [ ] **Step 2: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/lib/__tests__/patient-evolutions.test.ts
git add web/src/lib/__tests__/patient-evolutions.test.ts
git commit -m "test(patient-evolutions service): revision snapshot tx + delete guards"
```

---

### Task J3: Component test

**Files:**
- Create: `web/src/components/patients/__tests__/patient-evolutions-tab.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PatientEvolutionsTab } from '../patient-evolutions-tab'

const PATIENT_ID = 'patient-1'

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch
})

const mockFeed = (entries: unknown[]) => {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { entries } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const renderTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PatientEvolutionsTab patientId={PATIENT_ID} />
    </QueryClientProvider>,
  )
}

describe('<PatientEvolutionsTab>', () => {
  it('renders the empty state when there are no entries', async () => {
    mockFeed([])
    renderTab()
    await waitFor(() => expect(screen.getByText(/Nenhuma evolução/)).toBeInTheDocument())
  })

  it('renders sessions and notes in the feed', async () => {
    mockFeed([
      {
        kind: 'session',
        id: 's1',
        occurredAt: '2026-05-20T12:00:00.000Z',
        executedByName: 'Dra. Ana',
        procedureRecordId: 'r1',
        procedureTypeName: 'Botox',
        sessionOrdinal: 1,
        sessionsTotal: 1,
        recordStatus: 'completed',
        technique: 'Aplicação em pontos',
        clinicalResponse: null,
        adverseEffects: null,
        notes: null,
        followUpDate: null,
        nextSessionObjectives: null,
        productApplications: [],
        diagramPointCount: 0,
      },
      {
        kind: 'note',
        id: 'n1',
        occurredAt: '2026-05-25T14:00:00.000Z',
        body: 'paciente ligou relatando febre',
        authorId: 'u1',
        authorName: 'Dra. Ana',
        createdAt: '2026-05-25T14:00:00.000Z',
        updatedAt: '2026-05-25T14:00:00.000Z',
        revisionCount: 0,
      },
    ])
    renderTab()
    await waitFor(() => {
      expect(screen.getByText(/paciente ligou relatando febre/)).toBeInTheDocument()
      expect(screen.getByText(/Aplicação em pontos/)).toBeInTheDocument()
    })
    // Counter reflects entry count
    expect(screen.getByText(/2 registros/)).toBeInTheDocument()
  })

  it('shows "edited N×" link when a note has revisions', async () => {
    mockFeed([
      {
        kind: 'note',
        id: 'n1',
        occurredAt: '2026-05-25T14:00:00.000Z',
        body: 'body',
        authorId: 'u1',
        authorName: 'Dra. Ana',
        createdAt: '2026-05-25T14:00:00.000Z',
        updatedAt: '2026-05-25T15:00:00.000Z',
        revisionCount: 2,
      },
    ])
    renderTab()
    await waitFor(() => expect(screen.getByText(/Editado 2× · ver histórico/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run and commit**

```bash
pnpm --filter @floraclin/web test:run src/components/patients/__tests__/patient-evolutions-tab.test.tsx
git add web/src/components/patients/__tests__/patient-evolutions-tab.test.tsx
git commit -m "test(patient-evolutions tab): empty state + feed + revisions link"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task — schema (A1+A2), validations (A3), queries (B1), service (C1), routes (D1/D2/D3), hooks (E1/E2), components (F1/F2/F3), tab (G1), integration (H1/H2), print (I1/I2), tests (J1/J2/J3).
- **Placeholder scan:** no "TBD"/"TODO" remain.
- **Type consistency:** `EvolutionEntry`, `EvolutionNoteEntry`, `EvolutionSessionEntry` are defined once (in `use-evolutions.ts`) and re-exported / re-imported by composer and tab page. Backend `EvolutionNoteRow` / `EvolutionSessionRow` shapes intentionally use `Date` (server side) while the client-facing types use ISO `string` (after the route's `.toISOString()` mapping).
- **Risk areas:** the `<Sheet>` component may not exist in the shadcn library copy; Task F3 step 2 explicitly verifies. The integration test in J1 assumes a Docker test DB is running; gated behind `RUN_DB_TESTS` (matching the existing project convention from `procedure-sessions.test.ts`).
- **Role gating:** `patient-tabs.tsx` accepts a `role?: Role` prop; `patient-detail-content.tsx` reads `role` from its existing auth/tenant context. The server enforces 403 on every endpoint independently — defense in depth.
