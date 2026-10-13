# Editable anamnesis templates

## Goal

Each clinic edits its own anamnesis questions. Patients answer them through the public link or staff fill them in during the visit. Old answers stay readable and print correctly after the clinic changes its questions.

## Decisions

- Full template: the clinic can edit, remove, reorder and add any question. No question is locked. "Restaurar padrão" brings back the default.
- Repeatable lists (medications, allergies, ...) become a new `list` question type with clinic-defined columns.
- Existing anamneses are converted to the new format and the old columns are dropped. One code path everywhere.
- A saved anamnesis shows the template version it was answered with, until someone re-answers it with the current template.
- The evaluation template engine becomes a shared form engine used by evaluations and the anamnesis.

## Data model

### `anamnesis_templates` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk tenants | unique, one template per clinic |
| sections | jsonb | `FormSection[]` |
| version | integer | starts at 1, +1 on every save |
| created_at, updated_at | timestamptz | |

RLS enabled, no policies (same as other floraclin tables created by hand).

A clinic with no row uses `DEFAULT_ANAMNESIS_TEMPLATE` (code constant) as version 0. The first save creates the row with version 1. "Restaurar padrão" saves the default sections as a new version. No seeding at signup and no backfill: every clinic sees the default until it edits.

### `anamneses` (reworked, still one row per patient)

Kept: `id`, `tenant_id`, `patient_id` (unique), `updated_by`, `created_at`, `updated_at` (optimistic lock).

Added:

| Column | Type |
|---|---|
| template_version | integer |
| template_snapshot | jsonb (`FormSection[]` the patient answered) |
| responses | jsonb (`Record<questionId, FormResponseValue>`) |

Dropped (in a later migration, see Rollout): `main_complaint`, `patient_goals`, `medical_history`, `medications`, `allergies`, `previous_surgeries`, `chronic_conditions`, `is_pregnant`, `is_breastfeeding`, `lifestyle`, `skin_type`, `skin_conditions`, `skincare_routine`, `previous_aesthetic_treatments`, `contraindications`, `facial_evaluation_notes`. Of these, `skin_type`, `skin_conditions`, `contraindications` and `facial_evaluation_notes` are never written or shown today.

## Version rules

1. Staff view and staff edit use the record's own `template_snapshot`. Autosave keeps that snapshot, so an edit never drops answers silently.
2. When the clinic's current template version differs from the record's `template_version`, the form shows a banner: `O modelo de anamnese mudou. Usar o modelo atual?` Accepting it carries answers over by question id, drops answers whose question id no longer exists, and sets the snapshot and version to the current template.
3. The public link always uses the current template, starts blank and overwrites the record (same as today). The page does not prefill, because that would show past health data to whoever holds the link. On submit the server validates against the current template; if the template changed while the patient was filling it, answers are matched by question id and unknown ids are dropped, with no error shown to the patient.
4. A patient with no anamnesis row uses the current template.

## Shared form engine

Generic pieces move from `components/evaluation/` and `lib/validations/build-evaluation-schema.ts` to `lib/forms/` (types, zod) and `components/forms/` (renderers, section editor, question editor dialog, editor core). New names: `FormQuestion`, `FormSection`, `FormResponses`, `FormResponseValue`, `buildFormResponseSchema`, `formSectionsSchema`. All evaluation imports are updated. No aliases are kept.

Evaluation-only pieces stay in `components/evaluation/`: `face_diagram` and its diagram props, "Copiar de outro procedimento", procedure-type props, and the per-`templateId` keyed evaluation response schema (built on `buildFormResponseSchema`).

The editor takes an `allowedTypes` prop. The anamnesis editor excludes `face_diagram`.

### Question type changes

- `text` gains `multiline?: boolean`. When true it renders a textarea.
- New `list` type:
  - `columns: { id: string; label: string; kind: 'text' | 'select'; options?: string[]; required?: boolean }[]`
  - Response: `Record<columnId, string>[]`. Rows with every cell blank are dropped on save.
  - Validation: a required column must be filled in every kept row; a `select` value must be one of its options.
  - Editor: add, remove and reorder columns; set kind, options and required.
  - Available to evaluations too.

### Server validation of templates

`formSectionsSchema` validates every template save (anamnesis and evaluation): non-empty labels, unique section and question ids across the template, at least 2 options for choice questions, at least 1 column for `list`, unique column ids within a list, at least 2 options for a `select` column. Evaluation template saves accept any JSON today; they get this check too.

## Default anamnesis template

Same questions as today, with stable readable ids so converted records match it exactly.

| Section | Question id | Type | Notes |
|---|---|---|---|
| Queixa principal e objetivos | `anam-main-complaint` | text, multiline | Queixa principal |
| | `anam-patient-goals` | text, multiline | Objetivos do paciente |
| Histórico médico | `anam-medical-history` | checkbox_with_other | options: today's 11 conditions, values = today's keys (`diabetes`, `hipertensao`, ...) |
| Medicamentos em uso | `anam-medications` | list | columns `name` (required), `dosage`, `frequency`, `reason` |
| Alergias | `anam-allergies` | list | columns `substance` (required), `reaction`, `severity` select leve/moderada/grave |
| Cirurgias anteriores | `anam-previous-surgeries` | list | columns `procedure` (required), `year`, `notes` |
| Condições crônicas | `anam-chronic-conditions` | list | column `condicao` (required) |
| Gestação / Amamentação | `anam-pregnant` | radio | sim / nao |
| | `anam-breastfeeding` | radio | sim / nao |
| Estilo de vida | `anam-smoking`, `anam-alcohol`, `anam-exercise`, `anam-sleep`, `anam-diet`, `anam-sun-exposure` | radio | today's option values |
| Rotina de cuidados com a pele | `anam-skincare-routine` | list | columns `product` (required), `frequency`, `notes` |
| Tratamentos estéticos anteriores | `anam-previous-treatments` | list | columns `procedure` (required), `date`, `professional`, `notes`, `satisfaction` select (today's 5 levels) |

All questions are optional, as today.

## Surfaces

- `AnamnesisForm` is rewritten on the shared renderer and replaces the hand-written 1,082-line form. It keeps autosave (1 second debounce), the 409 stale-data handling, wizard read-only mode after approval, `triggerSave`, and public submit. It adds the version banner.
- Patient anamnesis tab, atendimento and service wizard step 1 use it. The DB-to-form mapping code (`atendimento-page-client.tsx`, `patient-anamnesis-tab.tsx`) is deleted.
- Public page (`/a/[token]`): `GET /api/anamnesis/token/[token]` returns the current template; the page renders it blank.
- Prontuário PDF: generic rendering. Per section, answered questions as `label: answer`; lists as small tables; checkbox answers as a comma list (plus "other"); scales as `n / max`. Unanswered questions are skipped. The PDF now shows every answered question (today it shows only complaint, history, pregnancy, medications and allergies).
- Prontuário report summary: the "Queixa principal" line is removed. No field is guaranteed to exist any more.
- Settings: `/configuracoes/anamnese`, owner only, listed next to "Avaliações", with "Restaurar padrão".
- API:
  - `GET /api/anamnesis/template`: any clinic member. Returns the current template (row or default as version 0).
  - `POST /api/anamnesis/template`: `requireWrite('owner')`, actions `update` and `reset`, body validated with `formSectionsSchema`. Writes an audit log entry (`anamnesis_template`, old and new version).
  - `PUT /api/anamnesis/[patientId]` and the public token PUT take `{ templateVersion, responses }` (plus `applyCurrentTemplate: true` for the banner action) and validate with `buildFormResponseSchema` against the snapshot that will be saved.
- Unchanged: timeline entry, recent activity, audit for anamnesis saves, and the WhatsApp stale-anamnesis auto-send (they only read `updated_at`).
- Demo seed writes `responses` with the default ids. Unused `anamnesis.*` i18n keys are deleted.

## Conversion

A TS script in `db/migrations/manual/` that converts rows with `responses is null`, or rows whose `updated_at` is inside a given window. Idempotent. It sets `template_version = 0`, `template_snapshot = DEFAULT_ANAMNESIS_TEMPLATE.sections` and builds `responses` with a pure mapper:

- `main_complaint`, `patient_goals` → text answers.
- `medical_history` → `{ selected: [keys whose value is true], other: outros }`, omitted when empty.
- `medications`, `allergies`, `previous_surgeries`, `skincare_routine`, `previous_aesthetic_treatments` → list rows copied as-is (column ids reuse today's keys).
- `chronic_conditions` `["x"]` → `[{ condicao: "x" }]`.
- `is_pregnant`, `is_breastfeeding`: `true` → `"sim"`; `false` → unanswered. The old column defaults to false, so false never proved the patient said no.
- `lifestyle` keys → one radio answer each.
- Empty values are omitted.

## Rollout

Low traffic window (night).

1. Apply migration 0033 by hand: add `template_version`, `template_snapshot`, `responses` (nullable) to `anamneses`, create `anamnesis_templates` with RLS. Old code keeps working.
2. Run the conversion for all rows. Note T1.
3. Merge and deploy. Note T2 when production is live.
4. Re-run the conversion for rows with `updated_at` between T1 and T2 (edits saved by old code during the deploy).
5. Later PR, after a day of checks: migration 0034 drops the 16 old columns and sets the new columns NOT NULL.

## Testing

Each test names the regression it catches.

- `formSectionsSchema`: duplicate ids, a choice question with fewer than 2 options, a list with no columns, a select column with fewer than 2 options are rejected.
- `list` responses: blank rows dropped; a missing required column fails; a select value outside its options fails.
- Version rules: staff save keeps the record's snapshot; the banner action carries answers by id and drops removed ones; public submit uses the current template and drops unknown ids.
- Conversion mapper (table-driven): each old field maps to the right answer; `is_pregnant = false` stays unanswered; empty values are omitted.
- Template API: non-owner gets 403; invalid sections get 400; reset increments the version; the route is covered in `write-access-coverage`.
- PDF: answered questions render, lists render as tables, unanswered questions are skipped.
- Evaluations: existing editor, page and schema tests pass after the move, which shows the refactor changed no behavior. Evaluation template POST rejects invalid sections.
