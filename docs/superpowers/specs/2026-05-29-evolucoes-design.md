# Evoluções — clinical narrative tab design

**Status:** Approved (brainstorm) · awaiting user review of written spec
**Date:** 2026-05-29
**Scope:** Add a new patient tab dedicated to the clinical evolution narrative — a reverse-chronological feed that merges every executed `procedure_session` with free-form loose notes the professional authors over time.

---

## Goal

Give clinicians a single chart-style view that reads top-to-bottom like a medical record. Currently the patient profile has an **Atendimentos** tab (per-procedure cards) and a **Timeline** tab (system / admin audit log — patient created, plan approved, payment received, photo uploaded, document issued, etc.). Neither answers the question "what's the clinical narrative for this patient over time?"

Evoluções is that view. It unifies two data sources into one feed:

1. **Executed `procedure_sessions`** — already exist in the DB, already carry the clinical content (technique, clinical response, adverse effects, notes, follow-up date, next-session objectives, products applied, diagram points). The tab is read-only for sessions; they are authored through step 5 of the atendimento wizard.
2. **Loose `patient_evolutions`** notes — new entities the professional adds directly from this tab. A single free-text body for clinical observations that happen between sessions ("paciente ligou relatando febre, prescrito X").

The existing **Timeline** tab keeps its current admin/audit-log behavior; Evoluções is purely clinical narrative.

---

## Out of scope

- Admin / system events (patient created, plan approved, payment received, photo uploaded, document issued, appointment created, etc.) — those stay in **Timeline**.
- Anamnesis edits — they have their own tab and history.
- Per-atendimento sub-evolução views.
- Auto-creating evolução notes from external events (WhatsApp messages, missed appointments, etc.) — future feature.
- Rich text, markdown, image attachments in loose notes — plain text only in v1.
- Per-note privacy levels ("private to me").
- Author-only edit lock — any owner / practitioner can edit any note; the audit trail surfaces who did what.
- Filters / search in v1.
- Pagination in v1.
- Notifications when another practitioner edits your note.

---

## Data model

Two new tables. No changes to existing tables.

### `patient_evolutions` — loose notes

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `tenantId` | `uuid NOT NULL` | FK → `tenants.id`. Every query filters by this. |
| `patientId` | `uuid NOT NULL` | FK → `patients.id`. |
| `body` | `text NOT NULL` | The free-form note. Max 10 000 chars validated at the zod schema level. |
| `authorId` | `uuid NOT NULL` | FK → `users.id`. Original author — never reassigned when a different user edits later (edits land in the revisions table with their own `editedBy`). |
| `occurredAt` | `timestamptz NOT NULL DEFAULT now()` | The clinical event time. Defaults to now but the composer allows backdating (e.g. "paciente ligou ontem"). |
| `createdAt` | `timestamptz NOT NULL DEFAULT now()` | Insertion time. Immutable. |
| `updatedAt` | `timestamptz NOT NULL DEFAULT now()` | Bumps on edits. |
| `deletedAt` | `timestamptz` | Soft delete. Hidden from the feed but kept for audit. |
| `deletedBy` | `uuid` | Who soft-deleted. FK → `users.id`. |
| `deleteReason` | `text` | Optional rationale captured in the delete confirm dialog. |

Indexes:
- `(tenant_id, patient_id, occurred_at desc)` — primary feed read pattern.
- `(tenant_id, author_id)` — for future "my notes" reporting; cheap to add now.

### `patient_evolution_revisions` — edit audit trail

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `tenantId` | `uuid NOT NULL` | FK → `tenants.id`. |
| `evolutionId` | `uuid NOT NULL` | FK → `patient_evolutions.id` `ON DELETE CASCADE`. |
| `body` | `text NOT NULL` | Snapshot of the body BEFORE the edit. revisions[0] is the original, revisions[N-1] is the second-most-recent. |
| `occurredAt` | `timestamptz NOT NULL` | Snapshot of `occurredAt` before the edit (author can also change the date). |
| `editedBy` | `uuid NOT NULL` | FK → `users.id`. Who saved the new version. |
| `editedAt` | `timestamptz NOT NULL DEFAULT now()` | When the edit happened. |

Index: `(evolution_id, edited_at desc)`.

### Why a separate revisions table

- Cheap to query "show me edits to this note" without parsing JSON.
- Soft-deletes on the parent cascade nothing — revisions stick around for forensic review.
- Plays nicely with existing audit-log helpers (`createAuditLog`) by keeping clinical revision history (immutable body snapshots) separate from cross-entity system audit logs.

### Sessions

`procedure_sessions` already has every field the timeline needs (`technique, clinicalResponse, adverseEffects, notes, followUpDate, nextSessionObjectives, executedBy, performedAt`). Product applications and face diagrams join through `product_applications.procedureSessionId` and `face_diagrams.procedureSessionId` (already in place from migration 0015). No schema change.

---

## API

Four routes. All gated by `requireRole('owner', 'practitioner')`. Receptionist / financial get 403. All queries filter by `tenantId`.

### `GET /api/patients/[id]/evolutions`

Returns the merged feed for one patient.

**Response shape:**

```ts
type EvolutionFeed = {
  entries: Array<EvolutionSessionEntry | EvolutionNoteEntry>
}

type EvolutionSessionEntry = {
  kind: 'session'
  id: string                 // procedure_session id
  occurredAt: string         // procedure_session.performed_at
  executedByName: string
  procedureRecordId: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number      // "Sessão 2 de 4"
  recordStatus: string       // procedure_records.status — used to muted-render cancelled lines
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: Array<{ productName: string; totalQuantity: string; quantityUnit: string }>
  diagramPointCount: number  // summary, not full points
}

type EvolutionNoteEntry = {
  kind: 'note'
  id: string
  occurredAt: string
  body: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt: string
  revisionCount: number      // "edited N×" badge
}
```

**Sort:** `ORDER BY occurredAt DESC, createdAt DESC` (stable tiebreak when two entries share `occurredAt`).

**Soft-deleted notes excluded** (`deletedAt IS NULL`).

**No pagination in v1.** Clinic-scale patients (single-digit-hundreds of entries at most) fit in one response. If volume grows past ~500 entries, add cursor pagination keyed on `(occurredAt, id)`.

### `POST /api/patients/[id]/evolutions`

Creates a new loose note.

**Body (zod-validated):**
```ts
{
  body: string (min 1, max 10000),
  occurredAt?: string (ISO datetime; defaults to now())
}
```

**Server actions:**
1. Insert into `patient_evolutions` with `authorId = ctx.userId`.
2. Write `createAuditLog({ action: 'create', entityType: 'patient_evolution', entityId, changes: { body: { old: null, new: '<truncated 200ch>' } } })`.

**Response:** the newly-created `EvolutionNoteEntry`.

### `PATCH /api/patients/[id]/evolutions/[noteId]`

Edits a loose note. Snapshots the old values into the revisions table first.

**Body:** same as POST but `body` and `occurredAt` are both optional. At least one must be present.

**Server actions (single tx):**
1. `SELECT … FOR UPDATE` to lock the row. Reject if `deletedAt IS NOT NULL`.
2. Insert the **pre-edit** `body` + `occurredAt` into `patient_evolution_revisions` with `editedBy = ctx.userId`.
3. Update the row with new values, bump `updatedAt`.
4. Audit log with old/new body excerpts.

**Response:** the updated `EvolutionNoteEntry` with `revisionCount + 1`.

### `DELETE /api/patients/[id]/evolutions/[noteId]`

Soft-delete.

**Body:** `{ reason?: string }` (optional but encouraged).

**Server actions (tx):**
1. `SELECT … FOR UPDATE`, reject if already deleted.
2. Set `deletedAt = now(), deletedBy = ctx.userId, deleteReason = body.reason`.
3. Audit log.

**Response:** `{ success: true }`.

### `GET /api/patients/[id]/evolutions/[noteId]/revisions`

Drill-in to see the edit history of a single note.

**Response:** `Array<{ body, occurredAt, editedBy, editedByName, editedAt }>` ordered by `editedAt DESC`.

Used by the "edited N×" badge — opens a popover or drawer listing each revision.

### Client mutations / cache invalidation

React Query keys:
- List: `['patient-evolutions', patientId]`
- Revisions: `['patient-evolutions', patientId, noteId, 'revisions']`

POST / PATCH / DELETE invalidate the list. PATCH also invalidates the revisions key for that note.

---

## UI

### Tab placement

Insert **Evoluções** between **Anamnese** and **Atendimentos** in `web/src/components/patients/patient-tabs.tsx`:

```
Dados · Anamnese · Evoluções · Atendimentos · Pacotes · Documentos · Fotos · Termos · Financeiro · Timeline
```

Rationale: the order roughly mirrors clinical workflow — history (anamnese) → ongoing narrative (evoluções) → treatments (atendimentos) → administrative tabs.

Icon: `BookOpen` from lucide-react (medical-chart connotation).

The tab is **hidden** in `patient-tabs.tsx` for receptionist/financial roles — the `TABS` definition gains an optional `requiredRoles?: Role[]` field and the strip filters before rendering. Server still enforces 403 on direct URL hits.

### Layout

One vertical feed in a single `max-w-3xl` column, reading like a chart top-to-bottom. Each entry sits in a card with a left-rail dot + connecting hairline (same timeline-spine pattern used on the Atendimentos tab).

```
┌─────────────────────────────────────────────────────────────┐
│  Evoluções                            [+ Nova evolução]     │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ●  28 mai 2026 · 14:32                                     │
│  │  Dra. Ana Oliveira                            [···]      │
│  │                                                          │
│  │  Paciente ligou relatando febre de 38°C desde ontem.    │
│  │  Prescrito paracetamol 750mg 8/8h por 3 dias.           │
│  │  Orientado retornar caso febre persista após 48h.        │
│  │                                                          │
│  │  Editado 1× · ver histórico                              │
│  │                                                          │
│  ●  25 mai 2026 · 10:15                                     │
│  │  SESSÃO 2 DE 4 · Skinbooster · Dra. Ana Oliveira         │
│  │                                                          │
│  │  TÉCNICA                                                 │
│  │  Aplicação em pontos da malar e infraorbital ...        │
│  │                                                          │
│  │  RESPOSTA CLÍNICA                                        │
│  │  Boa tolerância, eritema leve transitório.              │
│  │                                                          │
│  │  EFEITOS ADVERSOS                                        │
│  │  Nenhum.                                                 │
│  │                                                          │
│  │  OBSERVAÇÕES                                             │
│  │  Próxima sessão em 3 semanas.                            │
│  │                                                          │
│  │  PRODUTOS APLICADOS                                      │
│  │  · Hialurônico Reticulado · 2,0 mL                      │
│  │                                                          │
│  │  4 pontos de aplicação · ver detalhes →                  │
│  │                                                          │
│  │  Próximos objetivos · Avaliar hidratação                 │
│  │  Retorno · 15 jun 2026                                   │
│  │                                                          │
│  ●  10 abr 2026 · 09:00                                     │
│  │  SESSÃO 1 DE 4 · Skinbooster · ...                       │
│  │                                                          │
└─────────────────────────────────────────────────────────────┘
```

Visual rhythm:
- Left rail: a status-tinted dot (`bg-forest` for sessions, `bg-sage` for notes) + a hairline `bg-sage/15` connecting consecutive entries. Same pattern used on the Atendimentos tab.
- Date header in `font-heading`; executor/author in mid-tone underneath.
- For sessions: eyebrow `SESSÃO N DE M · PROCEDURE · EXECUTOR`, then each filled field as a labeled block (label uppercase tracked `text-mid`, body in `text-charcoal` with `whitespace-pre-wrap`).
- For loose notes: just the body — no field labels — single text area content.
- Diagram points show as a count + a link to the procedure detail page where the full diagram is rendered.
- Products applied list inline (just name + quantity + unit).
- Empty fields are skipped (not rendered as "—").
- Cancelled-line sessions render with a muted eyebrow `(linha cancelada)` and `opacity-70` on the card, but the clinical content stays visible — the event happened.

### "Nova evolução" composer

Click "+ Nova evolução" → opens a centered modal.

```
┌────────────────────────────────────────────────────────┐
│  Nova evolução                                    [X]  │
│  ────────────────────────────────────────────────────  │
│  Data e hora                                           │
│  [ 28/05/2026  14:32 ]   ← datetime-local, default now │
│                                                        │
│  Descrição                                             │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Descreva o que aconteceu...                     │ │
│  │                                                 │ │
│  │                                                 │ │
│  │                                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                       0 / 10000        │
│                                                        │
│                          [Cancelar]  [Salvar evolução] │
└────────────────────────────────────────────────────────┘
```

Same modal in edit mode — opens prefilled when the user clicks `[···]` → "Editar" on an existing note. Title flips to "Editar evolução"; submit button to "Salvar alterações".

Form validation:
- Body: required, 1–10 000 chars (zod schema mirrors server).
- Date: required, must be parseable as ISO datetime.

### Per-note actions (`[···]` menu)

Only on `kind === 'note'` entries. Practitioner/owner only.

- **Editar** → opens composer prefilled.
- **Histórico de edições** → only shown when `revisionCount > 0`. Opens a side drawer listing each revision: timestamp + editor + the pre-edit body verbatim. No diff rendering in v1; full snapshots are clear enough.
- **Excluir** → confirm dialog (`Esta ação é reversível pelo administrador. Você pode opcionalmente registrar o motivo.`). Captures optional `reason`. Soft-deletes via DELETE.

Session entries don't get this menu — they're authored through the atendimento wizard's step 5 and editing belongs in that flow, not here. Sessions show a small `Ver atendimento →` link instead, opening the procedure detail page.

### Empty state

When the patient has no executed sessions AND no loose notes:

```
[ BookOpen icon, large, muted ]
Nenhuma evolução registrada
Adicione uma evolução manual ou registre uma sessão pelo atendimento.
                                                [+ Nova evolução]
```

### Filters (deferred)

No filter chips in v1. A patient's evolução list is short enough to scan. v2 candidates: by author, by date range, by type (session vs note).

### Print

A "Imprimir evoluções" link in the top right (next to "Nova evolução") opens `/pacientes/[id]/evolucoes/imprimir` — a printer-friendly chart-style document with the same content. Uses the existing `data-print-area` + `data-print-hide` pattern from procedure prints.

---

## Roles + permissions

| Role | Tab visible | List | Create note | Edit note | Delete note | View revisions |
|---|---|---|---|---|---|---|
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `practitioner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `receptionist` | — | — | — | — | — | — |
| `financial` | — | — | — | — | — | — |

Owners and practitioners have equal rights — no author-only edit lock. The audit trail surfaces who did what. (If clinics later want a stricter author-only mode, it's a single role-check flip; not in v1.)

Tab hidden client-side; server enforces 403 on every endpoint independently.

---

## Audit

Every mutation writes to the existing `audit_logs` infrastructure (`createAuditLog` helper):

| Action | `entityType` | `changes` |
|---|---|---|
| Create note | `patient_evolution` | `{ body: { old: null, new: '<truncated 200ch>' } }` |
| Edit note | `patient_evolution` | `{ body: { old: '<old 200ch>', new: '<new 200ch>' } }` plus `occurredAt` delta when changed |
| Delete note | `patient_evolution` | `{ deletedAt: { old: null, new: '<iso>' }, reason: '<string or null>' }` |

The `patient_evolution_revisions` table is the **clinical** audit trail (immutable body snapshots, queryable by `evolutionId`). `audit_logs` is the **system** audit trail (cross-entity, indexed by user + entity type). Both fire; they answer different questions.

---

## Edge cases

1. **Backdated `occurredAt` puts a note between two old sessions.** Expected — the feed sorts by `occurredAt`, so the note slots into its chronological position regardless of when it was authored. `createdAt` and `updatedAt` stay as the actual entry time and surface in the "edited N×" badge if applicable.

2. **Two professionals edit the same note nearly simultaneously.** `PATCH` does `SELECT … FOR UPDATE` inside the tx, so the second edit serializes after the first. Both revisions land in the history table. Last writer wins on the current body.

3. **Note authored against a deleted patient.** Insert blocked at the FK level (we don't soft-delete patients in this app today; if that changes, add a `WHERE patients.deletedAt IS NULL` guard on the create path).

4. **A session belongs to a cancelled procedure (`procedure_records.status = 'cancelled'`).** The session row in `procedure_sessions` still exists — the clinical event happened. Render the entry with a muted `(linha cancelada)` eyebrow and `opacity-70`, but keep all the content visible.

5. **Patient with hundreds of sessions / years of notes.** v1 returns everything in one response. Client renders them all. Revisit with cursor pagination keyed on `(occurredAt, id)` if a single-clinic patient ever crosses ~500 entries.

6. **A note's `body` is plain text only.** Preserves newlines (`whitespace-pre-wrap` on render). No rich text, no markdown, no images in v1.

7. **Print-friendly route reuses the same data fetch + a print-only layout.** Standard `data-print-area` markup + the existing chrome-hiding rules.

8. **A practitioner leaves the clinic.** The user row stays; `authorName` resolves via the join. We never delete `users` rows for that reason.

9. **A note's `occurredAt` is set far in the future (e.g. typo).** Allowed by the schema (no upper bound check). The note simply sits at the top of the feed. Author can edit to correct. If users start abusing this we add a sanity check (`<= now() + 30 days`) but not in v1.

10. **The Imprimir route is hit by a user who has no notes.** Print page renders the empty state inside the print frame ("Nenhuma evolução registrada para este paciente") — clean output, no error.

---

## Migration

A single migration file adds the two tables and their indexes.

`web/src/db/migrations/0016_patient_evolutions.sql` (number bumps from last applied migration):

```sql
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

Idempotent via `IF NOT EXISTS`. Safe to rerun. Append the matching entry to `web/src/db/migrations/meta/_journal.json`.

---

## Files touched (planning-level inventory)

### New files

| File | Responsibility |
|---|---|
| `web/src/db/migrations/0016_patient_evolutions.sql` | Schema + indexes. |
| `web/src/db/queries/patient-evolutions.ts` | CRUD + revisions read; tenant-scoped. |
| `web/src/validations/patient-evolution.ts` | Zod schemas for create/edit/delete. |
| `web/src/lib/patient-evolutions.ts` | Service layer: edit-with-revision-snapshot transaction. |
| `web/src/app/api/patients/[id]/evolutions/route.ts` | GET (feed) + POST (create). |
| `web/src/app/api/patients/[id]/evolutions/[noteId]/route.ts` | PATCH + DELETE. |
| `web/src/app/api/patients/[id]/evolutions/[noteId]/revisions/route.ts` | GET revisions. |
| `web/src/components/patients/patient-evolutions-tab.tsx` | The tab page — list rendering, composer, empty state. |
| `web/src/components/patients/evolution-note-composer.tsx` | The shared create / edit modal. |
| `web/src/components/patients/evolution-revisions-drawer.tsx` | Edit-history drawer. |
| `web/src/components/patients/evolution-entry-card.tsx` | One card in the feed; switches on `kind`. |
| `web/src/hooks/queries/use-evolutions.ts` | React Query hooks. |
| `web/src/hooks/mutations/use-evolution-mutations.ts` | Create / edit / delete mutations. |
| `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/page.tsx` | Print-friendly chart. |
| `web/src/app/(print)/pacientes/[id]/evolucoes/imprimir/print-evolucoes-page-client.tsx` | Print client. |
| `web/src/db/queries/__tests__/patient-evolutions.test.ts` | Query coverage (integration-gated). |
| `web/src/lib/__tests__/patient-evolutions.test.ts` | Service-layer revision-snapshot tx coverage. |
| `web/src/components/patients/__tests__/patient-evolutions-tab.test.tsx` | Feed render + composer happy path. |

### Modified files

| File | Change |
|---|---|
| `web/src/db/schema.ts` | Add `patientEvolutions` and `patientEvolutionRevisions` table definitions. |
| `web/src/components/patients/patient-tabs.tsx` | Add `evolucoes` tab entry between Anamnese and Atendimentos; introduce optional `requiredRoles?: Role[]` field; filter the tab strip by role. |
| `web/src/components/patients/patient-detail-content.tsx` | Mount `<PatientEvolutionsTab>` when `tab === 'evolucoes'`. |

---

## Notes for the implementation plan

- The PATCH/DELETE route needs the same lock-and-assert pattern used by `closePackageQuery` and `executeSession` (`SELECT … FOR UPDATE`, throw `BusinessError` on terminal state, then mutate inside the same tx). Reuse `BusinessError` from `@/lib/errors`.
- The composer's date input must use `parseLocalDate` / `toLocalYmd` from `@/lib/dates` for the date-only path, and `new Date(<datetime-local>).toISOString()` for the full datetime; server validates as ISO. Don't reach for bare `new Date('YYYY-MM-DD')` per `AGENTS.md` rules.
- Tab strip role filtering: add a `requiredRoles?: Role[]` field to the `TABS` const. Compute `visibleTabs = TABS.filter(t => !t.requiredRoles || t.requiredRoles.includes(role))` in `patient-tabs.tsx`. Use `useAuth()` or similar to read the current role.
- Tests should follow the existing pattern: integration tests guarded by `RUN_DB_TESTS` (like `procedure-sessions.test.ts`); component tests mock fetch and use the shared QueryClientProvider helper.
