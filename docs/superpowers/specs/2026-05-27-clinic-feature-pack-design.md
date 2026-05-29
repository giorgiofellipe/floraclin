# Clinic feature pack — design

**Status:** Approved (brainstorm) · awaiting user review of written spec
**Date:** 2026-05-27
**Scope:** Six client-requested features delivered as a single coherent feature pack:

1. Birthday reminder
2. Photo cropping (non-destructive)
3. Procedure packages (multi-procedure, multi-session)
4. Professional signature + registry
5. Prescriptions & medical certificates (with templates, WhatsApp/print/PDF output)
6. Open planejamentos follow-up

Each topic below is self-contained; topics 4 and 5 share the signature block component, and topic 3 reuses the existing procedure execution flow. No other cross-dependencies.

---

## Conventions used throughout this spec

- DB schema lives in `web/src/db/schema.ts` under the `floraclin` schema (pgSchema).
- All new tables include `tenantId UUID NOT NULL REFERENCES tenants(id)` for multi-tenancy isolation.
- All date/time handling follows the project rules in `AGENTS.md` (`@/lib/dates` helpers; `timestamptz` for instants, `date` for BR calendar days).
- Existing components reused: `<SignaturePad>` (`web/src/components/consent/signature-pad.tsx`), the WhatsApp send pipeline, the procedure execution flow under `web/src/app/(platform)/pacientes/[id]/atendimento` and `procedimentos/[id]`, and the existing template renderer used by WhatsApp templates.
- All new server routes follow the existing `app/api/...` REST conventions and use the project's auth/tenant middleware.

---

## Topic 1 — Birthday reminder

### Goal
Surface patients whose birthday is approaching so staff can wish them happy birthday (typically via WhatsApp) and prevent duplicate greetings.

### Data model

New table `patient_greetings` — one row per (patient, occasion year)

| Column          | Type             | Notes                                        |
|-----------------|------------------|----------------------------------------------|
| `id`            | `uuid PK`        |                                              |
| `tenantId`      | `uuid NOT NULL`  | FK → `tenants.id`                            |
| `patientId`     | `uuid NOT NULL`  | FK → `patients.id`                           |
| `occasionYear`  | `integer NOT NULL` | The year of the birthday occasion         |
| `greetedAt`     | `timestamptz NOT NULL DEFAULT now()` |                          |
| `greetedBy`     | `uuid NOT NULL`  | FK → `users.id`                              |

- Unique index on `(patientId, occasionYear)` — natural reset each new year.
- Index on `(tenantId, occasionYear)`.

`patients` table — no schema change. Birthday queries use Postgres date extractions:

```sql
EXTRACT(MONTH FROM birth_date) = $month
AND EXTRACT(DAY FROM birth_date) BETWEEN $dayStart AND $dayEnd
```

Add an expression index for fast lookups:

```sql
CREATE INDEX idx_patients_birth_md
  ON floraclin.patients (tenant_id, EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))
  WHERE deleted_at IS NULL AND birth_date IS NOT NULL;
```

### UI

**Dashboard widget — `UpcomingBirthdaysCard`**
- Lives in the dashboard grid alongside `TodayAppointments` / `FinancialSummary`.
- Header: "Aniversariantes de hoje" + small badge "+N esta semana" linking to the full page.
- Rows: name, age turning, phone; per-row actions: WhatsApp button, "marcar como cumprimentado" toggle, click-through to profile.
- Empty state: "Ninguém faz aniversário hoje · N esta semana →".

**Full page — `/pacientes/aniversariantes`**
- Filters: month (default current), search by name.
- Table columns: patient, birth date, age turning, phone, last visit, greeting status (greeted by X · datetime).
- Same row actions as the widget.

**WhatsApp greeting template**
- Adds a new built-in template kind `birthday` editable in the existing WhatsApp template settings UI.
- Variables: existing `{{patient.firstName}}`, `{{tenant.name}}`, etc.
- Sending via the existing WhatsApp send flow auto-records a greeting (insert into `patient_greetings` with current year, `greetedBy = current user`).

### Server routes
- `GET /api/birthdays?from=YYYY-MM-DD&to=YYYY-MM-DD` — returns patients whose birthday falls in the BR-local range, joined with the current-year greeting row (if any).
- `POST /api/birthdays/:patientId/greeting` — body `{ year }` (defaults to current BR year). Inserts/upserts a greeting row.
- `DELETE /api/birthdays/:patientId/greeting` — body `{ year }`. Removes the greeting (untoggle).

### Edge cases
- Patients with `birthDate IS NULL` are excluded.
- Patients with `deletedAt IS NOT NULL` are excluded.
- Feb 29 birthdays surface on Feb 28 in non-leap years (explicit OR in the query).
- "Current year" is computed via `brToday()` so it's stable on UTC hosts.

---

## Topic 2 — Photo cropping (non-destructive)

### Goal
Allow staff to focus the framing of a photo without losing the original. Crops are reversible and re-editable, including from the side-by-side comparison view.

### Data model

`photo_assets` — additive columns only.

| Column           | Type      | Notes                                                              |
|------------------|-----------|--------------------------------------------------------------------|
| `cropBox`        | `jsonb`   | `{ x, y, width, height }` in normalized 0–1 coords; null = no crop |
| `cropAspect`     | `decimal(10,4)` | The source aspect ratio (width/height), stored for sanity checks |

Original file in storage is never modified.

### Rendering

- Helper `applyCrop(asset)` → returns CSS props (`aspectRatio`, `objectFit: 'cover'`, `objectPosition`, container box) so `<img>` tags don't need to know about cropping. Lives in `web/src/lib/photos.ts`.
- Helper `getCroppedBlob(asset)` — server-side canvas render to a baked image; used by downstream PDF/export paths only (the planned procedure record printable view).

### UI

Shared component `<ImageCropper image src onSave onCancel currentCrop?>`:
- Built on `react-image-crop` (new dependency).
- Crop rectangle locked to the source aspect (per the chosen aspect-locked behavior).
- Buttons: "Salvar recorte" and "Remover recorte" (the latter visible only when a crop exists).

Entry points:
1. **Photo uploader (`photo-uploader.tsx`)** — after a photo is queued, a "Recortar" icon on the preview opens the cropper inline; the resulting box is sent with the upload request.
2. **Patient photos tab / procedure photos (`patient-photos-tab.tsx`, `execution-photo-section.tsx`)** — "Recortar" action on each photo card; saves the new `cropBox` via PATCH.
3. **Photo comparison view (`photo-comparison.tsx`)** — "Recortar" button on either side; updates the crop in place so before/after framing can be aligned.

### Server routes
- `POST /api/photos` — accept optional `cropBox` and `cropAspect` in the upload payload.
- `PATCH /api/photos/[id]` — body `{ cropBox: { x, y, width, height } | null }`. Returns the updated asset. Permission: photo must belong to a patient in the caller's tenant.

### Edge cases
- The cropper rejects boxes that would render at <50px on either dimension (avoids accidental over-crop).
- Removing a crop (`cropBox: null`) is always allowed.
- `cropAspect` is stored as a sanity guard — if a future migration ever replaces the underlying file and the aspect changes, render falls back to "no crop" instead of producing a distorted thumbnail.

---

## Topic 3 — Procedure packages

### Goal
Sell a bundle of sessions (one or more procedure types, configurable counts per type), track consumption per session as a normal `procedure_record` so all existing tools (face diagram, batch-tracked product applications, photos, consent, signature) work without duplication. Optional expiration. Single sale at purchase time.

### Data model

**`package_templates`** — per-tenant catalog

| Column           | Type             | Notes                              |
|------------------|------------------|------------------------------------|
| `id`             | `uuid PK`        |                                    |
| `tenantId`       | `uuid NOT NULL`  | FK → `tenants.id`                  |
| `name`           | `varchar(255) NOT NULL` |                             |
| `description`    | `text`           |                                    |
| `defaultPrice`   | `decimal(10,2)`  |                                    |
| `validityMonths` | `integer`        | nullable; null = never expires     |
| `isActive`       | `boolean NOT NULL DEFAULT true` |                     |
| timestamps       |                  |                                    |

**`package_template_lines`** — line items in a template

| Column            | Type             | Notes                              |
|-------------------|------------------|------------------------------------|
| `id`              | `uuid PK`        |                                    |
| `templateId`      | `uuid NOT NULL`  | FK → `package_templates.id` (cascade) |
| `procedureTypeId` | `uuid NOT NULL`  | FK → `procedure_types.id`          |
| `sessionsCount`   | `integer NOT NULL CHECK (sessions_count > 0)` |        |
| `sortOrder`       | `integer NOT NULL DEFAULT 0` |                          |

**`patient_packages`** — sold instance

| Column            | Type             | Notes                                            |
|-------------------|------------------|--------------------------------------------------|
| `id`              | `uuid PK`        |                                                  |
| `tenantId`        | `uuid NOT NULL`  |                                                  |
| `patientId`       | `uuid NOT NULL`  | FK → `patients.id`                               |
| `templateId`      | `uuid`           | nullable (ad-hoc); FK → `package_templates.id`   |
| `name`            | `varchar(255) NOT NULL` | snapshot of template name at sale         |
| `totalAmount`     | `decimal(10,2) NOT NULL` |                                         |
| `purchasedAt`     | `date NOT NULL`  | BR calendar day                                  |
| `expiresAt`       | `date`           | nullable; computed from `validityMonths`         |
| `status`          | `varchar(20) NOT NULL DEFAULT 'active'` | CHECK: `active`/`completed`/`cancelled`/`expired` |
| `cancelledAt`     | `timestamptz`    |                                                  |
| `cancelReason`    | `text`           |                                                  |
| `financialEntryId`| `uuid NOT NULL`  | FK → `financial_entries.id`                      |
| `soldBy`          | `uuid NOT NULL`  | FK → `users.id`                                  |
| timestamps        |                  |                                                  |

**`patient_package_lines`** — per-line tracking

| Column                  | Type             | Notes                                        |
|-------------------------|------------------|----------------------------------------------|
| `id`                    | `uuid PK`        |                                              |
| `patientPackageId`      | `uuid NOT NULL`  | FK → `patient_packages.id` (cascade)         |
| `procedureTypeId`       | `uuid NOT NULL`  | FK → `procedure_types.id`                    |
| `procedureTypeName`     | `varchar(255) NOT NULL` | snapshot at sale time                 |
| `sessionsTotal`         | `integer NOT NULL CHECK (sessions_total > 0)` |               |
| `sortOrder`             | `integer NOT NULL DEFAULT 0` |                                  |

Sessions consumed is **derived**, not stored, to avoid drift:
```sql
SELECT count(*) FROM procedure_records
WHERE patient_package_line_id = $1 AND status = 'executed'
```

**`procedure_records`** — two new nullable FKs

| Column                  | Type   | Notes                                    |
|-------------------------|--------|------------------------------------------|
| `patientPackageId`      | `uuid` | FK → `patient_packages.id`               |
| `patientPackageLineId`  | `uuid` | FK → `patient_package_lines.id`          |

Indexes: `(patient_package_id)`, `(patient_package_line_id)`.

### Status transitions on `patient_packages`
- Created as `active`.
- Becomes `completed` when all lines are fully consumed (server-side check after each session executes).
- Becomes `cancelled` via explicit user action (with reason).
- Becomes `expired` when `expiresAt < brToday()` and not already terminal, via a daily background job. (No cron jobs exist today; the writing-plans phase will pick the trigger — either a new cron with `{ timezone: 'America/Sao_Paulo' }` or computed lazily on read with a `WHERE` clause. Both are acceptable.)

### UI

**Templates management — `/configuracoes/pacotes`**
- List of templates (name, lines summary, default price, active toggle).
- Create/edit form: name, description, validity (months, optional), default price, repeater of lines (procedure type + sessions count).
- Archive (soft) instead of delete.

**Patient profile — new "Pacotes" tab**
- One card per active package: name, purchased date, expires date (badge red when <30 days), total spent.
- Per-line row: procedure type, "X / N realizadas", **[Iniciar próxima sessão]** button.
- Card footer: link to executed session history; overflow menu with "Cancelar pacote".
- Completed packages collapsed under "Histórico".

**Sales flow — "Vender pacote" button**
- Wizard:
  1. Pick template OR "Pacote personalizado".
  2. Review/edit lines and price.
  3. Configure payment (installments) — reuses existing financial-entry form.
  4. Confirm → atomic create of `patient_packages` + `patient_package_lines` + `financial_entries` + `installments`.

### Session execution

"Iniciar próxima sessão" handler:
1. Creates a `procedure_record` with `status = 'draft'`, `procedureTypeId = line.procedureTypeId`, `patientPackageId`, `patientPackageLineId`.
2. Redirects to the existing execution flow (`/pacientes/[id]/procedimentos/[procedureId]`).
3. Existing flow handles face diagram, product applications with batch numbers, photos, consent, signature — nothing new.
4. On status flip to `executed`, server checks if all lines are fully consumed → if so, sets `patient_packages.status = 'completed'`.

Inside the execution screen, a small "Pacote: {name} · sessão Y/N" badge gives the practitioner context.

### Guards
- "Iniciar próxima sessão" disabled when line is fully consumed or package is `cancelled`/`expired`.
- Override allowed for `expired` packages via confirm dialog ("Pacote vencido em DD/MM/YYYY. Iniciar mesmo assim?").
- Cancelling a package shows a tooltip pointing to the linked `financial_entry` for manual refund adjustment.

### Server routes
- `GET /api/package-templates`, `POST`, `PATCH`, `DELETE` (soft).
- `POST /api/patient-packages` — sale (creates package + lines + financial entry atomically).
- `GET /api/patients/:id/packages` — active + completed.
- `POST /api/patient-packages/:id/cancel` — body `{ reason }`.
- `POST /api/patient-packages/:id/lines/:lineId/start-session` — creates the draft procedure record, returns its id.

### Out of scope
- Cross-package revenue analytics (deferred to a future financial report).
- Auto-refund calculation on cancel (manual via existing financial entry edit).

---

## Topic 4 — Professional signature + registry

### Goal
Let each practitioner save their signature and professional registration once, and stamp it automatically into any document that needs it. This is a shared building block consumed by Topic 5 (prescriptions/atestados), printable procedure records, and consent flows.

### Data model

`users` table — additive columns.

| Column                | Type             | Notes                                                  |
|-----------------------|------------------|--------------------------------------------------------|
| `signatureData`       | `text`           | base64 PNG dataURL (same format `SignaturePad` produces) |
| `signatureUpdatedAt`  | `timestamptz`    |                                                        |
| `professionalTitle`   | `varchar(100)`   | e.g., "Dra. Joana Silva"; defaults to `fullName` on render |
| `registryType`        | `varchar(10)`    | enum: `CRM | CRO | CRBM | CRF | CREFITO | COREN | OTHER` |
| `registryNumber`      | `varchar(20)`    |                                                        |
| `registryState`       | `char(2)`        | Brazilian state UF (SP, RJ, MG, …)                     |

Stored on `users` (not `tenant_users`): the registration belongs to the person and travels with them across tenant relationships.

### UI

**Profile section — "Assinatura e registro"** in `/configuracoes/perfil`
- Live preview of how the signature block will render on a document:
  ```
  ______________________________
  Dra. Joana Silva
  CRM-SP 123.456
  ```
- Signature input: existing `SignaturePad` for drawing + "Carregar imagem" upload (PNG/JPG, max 500KB, validated).
- Fields: `professionalTitle`, `registryType`, `registryNumber`, `registryState`.
- "Limpar assinatura" button clears the saved data.

### Reusable component

`<ProfessionalSignatureBlock user={...} />` in `web/src/components/professional/professional-signature-block.tsx`
- Renders signature image + display name + registry line.
- Same component used in screen and print stylesheets.
- Consumed by:
  - Topic 5 prescriptions and certificates.
  - Procedure record printable view — adds an "Imprimir" action on executed records.
  - Existing service-contract section in consent flow (`service-contract-section.tsx`) — uses the saved signature when present, falls back to live signing.

### Server helper

`getSignatureBlock(userId)` in `web/src/lib/professional.ts` — returns `{ image, displayName, registryLine }`. Single source of truth for all PDF / print paths.

### Permissions
- Signature/registry fields are only editable by the user themselves (no admin override).
- Admins can _clear_ another user's signature (e.g., compromised account) but not replace it.

### Validation
- Documents requiring a signature block (Topic 5) check that `signatureData IS NOT NULL` AND all registry fields are populated. If missing, the UI shows a CTA pointing to the profile.

### Out of scope
- ICP-Brasil / e-CPF digital signing. This is image-stamp ("carimbo digital") only.

---

## Topic 5 — Prescriptions & medical certificates

### Goal
Generate receitas (prescriptions) and atestados (medical certificates) for a patient, auto-signed with the saved professional signature block from Topic 4, delivered via WhatsApp, browser print, or PDF download. Per-tenant templates with placeholders speed up writing. All issued documents are stored with a content snapshot for audit / re-issue.

### Document types
- `receita`
- `atestado`

Unified schema with a `kind` field — same templates UI, same form, same PDF pipeline.

### Data model

**`clinical_document_templates`** — per-tenant reusable bodies

| Column        | Type             | Notes                                       |
|---------------|------------------|---------------------------------------------|
| `id`          | `uuid PK`        |                                             |
| `tenantId`    | `uuid NOT NULL`  |                                             |
| `kind`        | `varchar(20) NOT NULL` | CHECK: `receita` / `atestado`         |
| `name`        | `varchar(255) NOT NULL` |                                      |
| `body`        | `text NOT NULL`  | with `{{placeholders}}`                     |
| `isActive`    | `boolean NOT NULL DEFAULT true` |                              |
| `createdBy`   | `uuid NOT NULL`  | FK → `users.id`                             |
| timestamps    |                  |                                             |

**`clinical_documents`** — issued documents

| Column                  | Type             | Notes                                                    |
|-------------------------|------------------|----------------------------------------------------------|
| `id`                    | `uuid PK`        |                                                          |
| `tenantId`              | `uuid NOT NULL`  |                                                          |
| `patientId`             | `uuid NOT NULL`  | FK → `patients.id`                                       |
| `practitionerId`        | `uuid NOT NULL`  | FK → `users.id`                                          |
| `kind`                  | `varchar(20) NOT NULL` | CHECK: `receita` / `atestado`                      |
| `title`                 | `varchar(255) NOT NULL` |                                                   |
| `body`                  | `text NOT NULL`  | rendered final text — snapshot                           |
| `templateId`            | `uuid`           | nullable; FK → `clinical_document_templates.id`          |
| `professionalSnapshot`  | `jsonb NOT NULL` | `{ name, registryType, registryNumber, registryState, signatureDataUrl }` frozen at issuance |
| `issuedAt`              | `timestamptz NOT NULL DEFAULT now()` |                                      |
| `deliveredVia`          | `varchar(20) NOT NULL` | CHECK: `whatsapp` / `print` / `download` / `multiple` |
| `whatsappMessageId`     | `text`           | nullable; set when sent via WhatsApp                     |
| `storagePath`           | `text`           | nullable; if we choose to archive the rendered PDF       |
| timestamps              |                  |                                                          |

Indexes: `(tenant_id, patient_id, issued_at DESC)`.

### Placeholder system
Reuse the existing template renderer used by WhatsApp templates (extract into `web/src/lib/templates/` if not already shared). Supported placeholders include at minimum:
- `{{patient.name}}`, `{{patient.cpf}}`, `{{patient.birthDate}}`
- `{{date}}` (DD/MM/YYYY), `{{date.long}}` ("São Paulo, 27 de maio de 2026")
- `{{practitioner.name}}`, `{{practitioner.registry}}`
- `{{tenant.name}}`

The set is the same union as WhatsApp templates — easy mental model for tenants.

### UI

**Templates management — `/configuracoes/documentos`**
- Tabs: Receitas | Atestados.
- List + create/edit/archive. Body is a textarea; right sidebar lists available placeholders, click to insert.
- Mirrors the existing WhatsApp template management screen.

**Issue flow** — entry point on patient detail page ("Documentos" action; also available from an executed procedure record page)
1. Pick kind (Receita / Atestado).
2. Optional: pick a template → body field pre-filled with placeholders resolved against current patient + date + practitioner.
3. Edit body freely. Optional title field (defaults: "Receita" or "Atestado Médico").
4. Right-side live preview: clinic header → patient line → body → date → `<ProfessionalSignatureBlock>`.
5. Guard: if practitioner has no signature/registry set, block with CTA → profile.
6. "Finalizar" → server creates `clinical_documents` row with body + `professionalSnapshot`; returns document id and presents the three actions below.

### Output / delivery

Single "Finalizar" step exposes three actions; user can pick any combination:
- **Imprimir** → opens `/c/[tenant]/documentos/[id]/imprimir` (clean print stylesheet) → user hits browser print.
- **Baixar PDF** → `GET /api/clinical-documents/[id]/pdf` renders the same HTML via headless Chromium and streams the PDF back.
- **Enviar pelo WhatsApp** → server renders PDF (same path), uploads to storage, sends as document message via the existing WhatsApp send pipeline; sets `whatsappMessageId`.

`deliveredVia` is updated each time; set to `multiple` if more than one channel is used.

**PDF tech**
- HTML → PDF via headless Chromium: `@sparticuz/chromium-min` + `puppeteer-core` (runs on Vercel Fluid Compute Node functions, which this app already uses). No client-side PDF deps.
- The print page (`/c/[tenant]/documentos/[id]/imprimir`) is the same React render used by the headless renderer — single source of truth for layout.

### History — new "Documentos" tab on patient detail
- List of issued documents (kind, title, date, delivered via, practitioner).
- Per-row actions: Visualizar (opens print page), Reenviar WhatsApp, Reimprimir, Baixar PDF.
- "Novo documento" CTA at the top.

### Reusable shared pieces
- `<ProfessionalSignatureBlock>` from Topic 4.
- `<ClinicHeader>` — logo, clinic name, address, phone, drawn from `tenants` row. Reused by procedure record printable view in Topic 4.
- `renderPlaceholders(body, ctx)` — shared with the WhatsApp template renderer.

### Server routes
- `GET /api/document-templates?kind=…`, `POST`, `PATCH`, `DELETE` (soft).
- `POST /api/clinical-documents` — creates the issued document (snapshot at this point).
- `GET /api/clinical-documents/:id/pdf` — streams the rendered PDF.
- `POST /api/clinical-documents/:id/send-whatsapp` — body `{ message? }`. Sends the rendered PDF as a WhatsApp document message.
- `GET /api/patients/:id/documents` — list with filters by kind.

### Out of scope
- ICP-Brasil signing / Memed integration (paper-equivalent PDF with image signature is sufficient for current clinic use; Memed-style controlled-substance e-prescription can later slot in as another `deliveredVia` channel).

---

## Topic 6 — Open planejamentos follow-up

### Goal
Surface procedure records that have been planned or approved but not yet executed, with structured contact-attempt tracking and a snooze mechanism so staff can follow up without re-contacting the same patient daily.

### Definition
"Open" = `procedure_records.status IN ('planned', 'approved') AND deletedAt IS NULL AND (followupSnoozedUntil IS NULL OR followupSnoozedUntil <= brToday())`.

### Data model

**`procedure_followups`** — append-only contact log

| Column              | Type             | Notes                                                  |
|---------------------|------------------|--------------------------------------------------------|
| `id`                | `uuid PK`        |                                                        |
| `tenantId`          | `uuid NOT NULL`  |                                                        |
| `procedureRecordId` | `uuid NOT NULL`  | FK → `procedure_records.id` (cascade)                  |
| `contactedBy`       | `uuid NOT NULL`  | FK → `users.id`                                        |
| `contactedAt`       | `timestamptz NOT NULL DEFAULT now()` |                                  |
| `channel`           | `varchar(20) NOT NULL` | CHECK: `whatsapp` / `call` / `in_person` / `other` |
| `outcome`           | `varchar(30) NOT NULL` | CHECK: `agendou` / `pediu_para_aguardar` / `sem_resposta` / `desistiu` / `outro` |
| `notes`             | `text`           |                                                        |
| timestamps          |                  |                                                        |

Index on `(procedure_record_id, contacted_at DESC)`.

**`procedure_records`** — additive columns.

| Column                  | Type           | Notes                                                    |
|-------------------------|----------------|----------------------------------------------------------|
| `followupSnoozedUntil`  | `date`         | nullable; hidden from the open list until that date      |
| `lastContactedAt`       | `timestamptz`  | nullable; denormalized from latest followup row for sort |

### UI

**Dashboard widget — `OpenPlanejamentosCard`**
- Header: "Planejamentos em aberto" + count badge.
- Top 5 stalest (excluding snoozed). Rows: patient, procedure type, "há N dias", value, quick WhatsApp button.
- Empty state: "Nenhum planejamento em aberto 🎉".
- Footer link → full page.

**Full page — `/crm/planejamentos`**
- Co-located with CRM since planejamentos are the post-consultation continuation of the prospect funnel.
- Filters: practitioner, procedure type, value range, "incluir adiados" toggle (default off).
- Default sort: stalest first — `COALESCE(last_contacted_at, created_at) ASC`.
- Columns: patient, procedure type, planned date, value, criado em, último contato, status badge (Planejado / Aprovado / Adiado até X).
- Row click → opens the procedure record page (existing route).

### Per-row actions (and inside the procedure detail page)
- **"Registrar contato"** → modal: channel, outcome, notes. Inserts a `procedure_followups` row; updates `procedure_records.lastContactedAt`. If outcome is `desistiu`, prompts "deseja cancelar o planejamento?" → if yes, sets `status = 'cancelled'` and `cancellationReason = 'patient_declined'`.
- **"Enviar WhatsApp"** → opens the WhatsApp conversation for that patient; on send, optionally auto-records a followup with `channel = 'whatsapp'`.
- **"Adiar até..."** → date picker; sets `followupSnoozedUntil`. Optionally inserts a followup row noting "adiado para X".

Inside the procedure record page: new "Acompanhamento" section showing the full followup timeline with the same actions.

### Server routes
- `GET /api/planejamentos?status=…&practitionerId=…&includeSnoozed=…&sort=…`
- `POST /api/procedures/:id/followups` — body `{ channel, outcome, notes? }`. Also updates `lastContactedAt`.
- `PATCH /api/procedures/:id/snooze` — body `{ until: 'YYYY-MM-DD' | null }`.

### Edge cases
- Soft-deleted procedures excluded.
- Snooze date stored as a BR calendar `date` (not an instant) so "adiar até 15/06" reads correctly on UTC hosts (per `AGENTS.md` rules).
- Cancelling via `desistiu` follows existing cancellation conventions (sets `cancelledAt`).

### Out of scope
- Automated follow-up reminders / WhatsApp drip campaigns. The captured data (channel/outcome/snooze) sets that up cleanly for a future iteration; not building it now.

---

## Implementation note

This spec covers six features that are largely independent. The natural ordering when planning implementation is:

1. **Topic 4 (signature/registry)** — prerequisite for Topic 5; can ship first.
2. **Topic 5 (documents)** — depends on Topic 4.
3. **Topics 1, 2, 3, 6** — fully independent of each other and of 4/5; can be parallelized.

The writing-plans phase will produce a detailed implementation plan; ordering above is a hint, not a constraint.
