# Editable anamnesis templates: cook plan

**Goal:** Each clinic edits its own anamnesis questions. Staff and patients answer the clinic's template, every saved anamnesis keeps the template snapshot it was answered with, and the PDF renders any template generically.

**Architecture:** The evaluation template engine becomes a shared form engine (`lib/forms/*` for types and zod, `components/forms/*` for renderers and the editor core). Evaluation keeps thin wrappers for face diagram, "Copiar de outro procedimento" and its lenient response schema. Anamnesis gets a per-tenant `anamnesis_templates` row (default constant as version 0 when absent), and `anamneses` stores `template_version`, `template_snapshot` and `responses`. A pure `prepareAnamnesisSave` applies the version rules for the staff and public routes, and every save names the template version it is written with. A trigger plus a manual script convert legacy rows.

**Tech Stack:** Next.js 16.2 (App Router, route handlers with `params: Promise<...>`), React 19, TanStack Query v5, Drizzle 0.45 (postgres-js), zod 4, vitest 4 + Testing Library, base-ui `Select`, sonner, lucide-react, `fast-deep-equal` (new).

**Spec:** `docs/superpowers/specs/2026-10-12-editable-anamnesis-design.md`

---

## Global Constraints

- No em dashes and no en dashes anywhere: code, comments, UI copy, tests, docs. Use a comma, colon, parentheses, or two sentences.
- Comments only where a competent reader would otherwise get it wrong (external constraint, deliberate choice that looks like a bug, magic value). No restating code, no narrating.
- No backward-compat aliases or re-exports. When a symbol moves or is renamed, update every import. Delete dead code.
- UI copy is pt-BR.
- BR date rules from `AGENTS.md`: never `new Date('YYYY-MM-DD')` bare, never `.toISOString().split('T')[0]`. This feature handles instants only (`updated_at`), which stay raw `Date`.
- Never run `git push --no-verify`. Do not commit unless the human asks. Do not run `git stash`, `git checkout`, or `git restore`.
- Tests never hit Supabase or any real database. Mock `@/db/client` like `web/src/db/queries/__tests__/anamnesis-tenant-scope.test.ts`, or use `web/src/tests/mocks/drizzle-chain.ts`.
- Before writing or changing any test, load the `test-audit` skill and pass its authoring gate. Each new test's `it(...)` name or a one-line comment states the regression it catches. No snapshot tests, no grep-the-source tests, no test-only exports.
- Migrations are applied by hand (SQL in `web/src/db/migrations/NNNN_*.sql`, no `_journal.json` entry, no drizzle-kit generate). Manual scripts live in `web/src/db/migrations/manual/`.
- Read the relevant guide in `web/node_modules/next/dist/docs/` before touching route handlers or pages (AGENTS.md).
- Keep the existing evaluation tests green with import updates only. If one needs a behavior change, stop and report.

## Decisions taken while planning

1. **Option values stay the pt-BR labels, and membership is validated.** The engine stores the option text as the answer, same as evaluations. The spec's "values = today's keys" is not used: the default template uses labels (`Hipertensão`, `Sim, ocasional`, `Leve`, `Sim` / `Não`) and the conversion mapper translates legacy keys to labels. The strict response schema rejects a radio, checkbox, `*_with_other` selection or list select cell that is not one of the question's current options.
2. **The spec's `text.multiline` is dropped.** Text answers render as a textarea everywhere, as evaluations do today. No field, no switch.
3. **Settings tabs are in-page** (`?tab=` plus `effectiveTab` inside `settings-page-client.tsx`), so the owner-only "Anamnese" tab (group "Clínico", after "Procedimentos") renders the template editor directly. There is no `/configuracoes/anamnese` route. The spec's "next to Avaliações" has no target: evaluation templates are reached from the Procedimentos list.
4. **Required answers.** Staff saves (autosave, wizard, banner) never enforce required questions or required list columns: otherwise an owner marking a question required makes every autosave fail with 400. The public submit enforces them unless the patient rendered an older version (`body.templateVersion < current.version`); a higher version still enforces them. When the template changed while the patient was filling it in, the server carries answers onto the current template and checks shape only, so the patient never gets a 400 for a question they did not see.
5. **Shared engine boundary.** `lib/forms` has one strict response builder, `buildFormResponseSchema(sections, { enforceRequired })`. The lenient evaluation behavior (optional questions accept any value) stays inside `lib/validations/build-evaluation-schema.ts`. `face_diagram` is evaluation-only: `BASE_QUESTION_TYPES` (used by the anamnesis editor) excludes it, the evaluation editor passes `[...BASE_QUESTION_TYPES, 'face_diagram']`, and the anamnesis template route rejects it.
6. **One carry rule (self-review decision B).** `carryResponses` keeps an answer only when its question id exists in the target template, and keeps its valid parts: checkbox and `checkbox_with_other` keep the selected values that are still options (and `other`); radio drops a selection that is not an option, `radio_with_other` clears it and keeps `other`; a list keeps its rows, drops cells of unknown columns or with a select value outside the options, and drops rows left empty; a scale value out of range is dropped. Anything else that fails the target shape is dropped whole. Required is not enforced during carry. A reworded question label keeps its answer, because carry is by id. Renaming a select option ("Grave") drops only that cell, not every allergy row.
7. **Every save names its template version.** The server answers 409 `{ code: 'template_changed' }` when the body's `templateVersion` is not the version the save would be written with, in every staff mode (existing row, new patient, apply-current). No silent carry on staff saves. The 200 response returns `{ id, updatedAt, updatedBy, templateVersion, templateSnapshot }` and the client adopts them. On any 409 (`stale` or `template_changed`) the client refetches the record and the current template and reloads its state (Task D1).
8. **New patient race.** A client that had no row sends `expectNoRow: true`; the server answers 409 `stale` if a row exists (for example, the patient submitted the public link meanwhile). The public submit merges over an existing record (Decision 30).
9. **The banner compares content, not numbers.** The banner shows when the record's `template_snapshot` is not deep-equal to the current sections. `template_version` is still stored and is the sync token of Decision 7. A template save that is deep-equal to the stored sections (or to the default when no row exists, which covers "Restaurar padrão" on the default) changes nothing and bumps nothing. Deep equality uses `fast-deep-equal`: jsonb reorders object keys, so string comparison is wrong.
10. **Legacy edits during the deploy are caught by a trigger, not a time window.** Migration 0033 adds a `BEFORE UPDATE` trigger on `anamneses`: when a legacy column changes and `responses` does not, it nulls `responses`, `template_snapshot` and `template_version`. New code never writes legacy columns. Old code inserts leave `responses` null. The conversion script converts only `responses IS NULL` rows, so re-running it after the deploy catches every old-code write. Rollback is forward-fix only: after step 3 of the rollout, new rows exist only in the new columns.
11. **Drizzle columns.** Group A adds the three new `anamneses` columns as nullable (they are nullable in the DB until 0034). Group E removes the 16 legacy columns from `schema.ts`. `getAnamnesis` coalesces a null snapshot or null responses to the default template (version 0) and `{}`. Such rows exist only between the deploy and rollout step 4 (minutes); staff opening one in that window sees the default empty form. `upsertAnamnesis` updates only rows with `responses IS NOT NULL`, so a save on an unconverted row answers 409 stale instead of replacing the legacy answers. Rollout step 4 runs right after the deploy for this reason.
12. **Request bodies are zod-validated.** Both anamnesis PUT routes parse `{ templateVersion: int >= 0, responses: record, expectedUpdatedAt?: ISO datetime, expectNoRow?: boolean, applyCurrentTemplate?: boolean }` (the public route uses the first two). A pre-deploy browser bundle that still sends `{ formData }` gets 400, never a blank overwrite.
13. **Template save is a transaction** that locks the tenant's row (`FOR UPDATE`), skips when deep-equal (Decision 9), otherwise writes `version + 1` (insert with `ON CONFLICT (tenant_id) DO UPDATE` when no row). The audit log stores `changes: { sections: { old, new }, version: { old, new } }`, which is the template history. Action `create` when the old version is 0.
14. **Public page loads the template server-side** in `app/a/[token]/page.tsx`. `GET /api/anamnesis/token/[token]` is unchanged (the spec's `template` field there is dropped).
15. **The conversion script never moves `updated_at`** and guards each update with `updated_at = <value read>`, so it never overwrites a save that landed after the read. It prints how many rows are still unconverted and exits 1 if any remain.
16. **Dead code deleted:** `lib/evaluation-utils.ts` (`validateEvaluationResponses` has no caller), `validations/anamnesis.ts` and its test, `components/anamnesis/anamnesis-section.tsx`, and the top-level `anamnesis` object in `pt-BR.json` (nothing reads it). `patients.tabs.anamnesis` stays.
17. **Existing bug fixed by the rewrite:** `useUpsertAnamnesis` resolves to `{ success, data: { updatedAt } }` but the current form reads `result.updatedAt`, so the lock token never advances and the second autosave of an existing record returns 409. The new form reads `result.data.updatedAt`; a form test covers it.
18. **Behavior change to call out in the PR:** the wizard's `triggerSave` on step 1 now reports a failed save (`success: false, errorType: 'server'`) instead of today's unconditional success.
19. **Editing a question replaces it** (keeps `id` and `order`) instead of merging, so switching a question's type drops stale `options` / `columns`. The dialog validates with the same `formQuestionSchema` the server uses.
20. **Prontuário summary:** `anamnesis` becomes `{ updatedAt: Date } | null`, and the card reads "Preenchida em dd/MM/yyyy".
21. **`FormTemplateEditor` is controlled** (`sections`, `onSectionsChange`, `savedSections`) and takes `headerActions?: ReactNode`. The evaluation `TemplateEditor` wrapper keeps its props and tests and passes the copy button as `headerActions`. That button is no longer disabled during a save (the wrapper does not see save state); copy only replaces local sections, so this is harmless. Without `onBack`, the editor renders embedded (no sticky full-bleed bar, no back button) for the settings tab.
22. **One shared read-only list table.** The prontuário PDF is HTML rendered with `renderToStaticMarkup` (`lib/pdf.ts`), not react-pdf, so `components/forms/list-answer-table.tsx` (no `'use client'`, takes `className`) serves both the procedure detail view and the PDF. `formatAnswerText` lives in the PDF module and has no `face_diagram` case.
23. **`AnamnesisForm` takes `readOnly`:** no banner, no saves; `triggerSave` reports success without a request. The wizard passes it after approval instead of the `pointer-events-none` wrapper.
24. **`anamnesis_templates` is not in `PROTECTED_TABLES`** (`lib/compliance.ts`): it is configuration; the answered snapshot lives in `anamneses`, which is protected.
25. **`GET /api/anamnesis/template`** uses `getAuthContext()` (any member). `GET /api/anamnesis/[patientId]` keeps its owner/practitioner check.
26. **No `hooks/use-service-wizard.ts` exists**; the wizard's anamnesis wiring is all in `components/service-wizard/service-wizard.tsx`.
27. **`anamnesis_templates.sections` and `.version` have no defaults**: every insert provides both.
28. **Pre-merge data check.** Evaluation template saves now go through `formSectionsSchema`. A read-only script reports stored evaluation templates that would fail it, so data is fixed before merge (otherwise those clinics cannot save their ficha).
29. **Typecheck is red between Group C and Group D** by design: Group C changes `getAnamnesis` / `upsertAnamnesis` and the anamnesis hooks, and Group D rewrites their consumers. Groups A, B, D and E end green.
30. **Public submit merges (self-review decision A).** With an existing record, the server starts from the record's answers carried onto the current template (`carryResponses`) and overwrites only the questions the patient answered (`isQuestionAnswered`). With no record, the patient's answers are saved as before. Snapshot and version are the current template. The write uses the record's `updated_at` as lock; on `StaleDataError` the route re-reads and merges once more, and a second stale answers 409. The route writes an audit entry (actor: the token's `createdBy`, `changes: { submittedVia: { old: null, new: 'public_link' } }`, no answers).
31. **Size limits (self-review decision C)** live in `FORM_LIMITS` (`lib/forms/constants.ts`) and are enforced by `formSectionsSchema` and `buildFormResponseSchema`: labels, titles, option texts and column labels at most 500 characters; text answers, `other`, list text cells, `helpText` and `warningText` at most 5000; at most 50 sections, 100 questions per section, 50 options per question and per select column, 20 list columns, 200 list rows per answer; scale bounds are integers with `max - min <= 20` (unset bounds count as 1 and 5, as the renderer draws them); no duplicate options. Ids `__proto__`, `constructor` and `prototype` are rejected.
32. **Staff saves always carry a lock.** The staff body must include `expectedUpdatedAt` or `expectNoRow: true` (400 otherwise). The public route parses `anamnesisPublicSaveBodySchema`, which has no such rule.

## Existing code facts

- `TemplateEditor` (`components/evaluation/template-editor.tsx`) holds `sections` in state, compares with `initialSections` for "Alterações não salvas", and shows "Copiar de outro procedimento" and (when `hasDefaultTemplate`) "Restaurar padrão" as desktop buttons plus a mobile "Mais ações" dropdown. Tests find exactly one button named "Copiar de outro procedimento".
- `TemplateRenderer` (`components/evaluation/template-renderer.tsx`) renders an Accordion with per-section completion and gives the real face diagram only to the first `face_diagram` question.
- `buildEvaluationResponseSchema(templates)` is used only by `components/procedures/procedure-form.tsx` (client final validation).
- Evaluation template POST (`app/api/evaluation/templates/route.ts`) accepts any `sections` JSON today.
- `requireWrite(...roles)` returns `{ ctx, blocked }`; `createAuditLog` takes `{ tenantId, userId, action, entityType, entityId?, changes? }`.
- `write-access-coverage.test.ts` scans `app/api/**/route.ts`: any new mutating route must call `requireWrite(`; `anamnesis/token/[token]/route.ts` must keep calling `isSubscriptionActive(`.
- Row locking precedent: `.for('update')` in `web/src/db/queries/packages.ts`.
- `db.execute(sql\`...\`)` returns either an array or `{ rows }`; timestamps come back as strings.
- `queryKeys.anamnesis(patientId)` is a function in `hooks/queries/query-keys.ts`.
- Route tests mock `@/lib/write-access`, `@/lib/audit`, `@/lib/auth`, and the query module (see `app/api/calendar/blocks/__tests__/route.test.ts`).

## Existing tests touching these modules

| Test file | Owner task | Change |
|---|---|---|
| `web/src/components/evaluation/__tests__/template-editor.test.tsx` | B1 | type import only |
| `web/src/components/evaluation/__tests__/copy-template-dialog.test.tsx` | B1 | type import only |
| `web/src/app/(platform)/configuracoes/avaliacao/[procedureTypeId]/__tests__/evaluation-template-page-client.test.tsx` | B1 | none expected, must stay green |
| `web/src/lib/validations/__tests__/build-evaluation-schema.test.ts` | B2 | type import only |
| `web/src/components/procedures/__tests__/procedure-form.characterization.test.tsx` | B2 | none expected, must stay green |
| `web/src/hooks/mutations/__tests__/use-evaluation-mutations.test.ts` | B2 | none expected, must stay green |
| `web/src/db/queries/__tests__/anamnesis-tenant-scope.test.ts` | C1 | new `AnamnesisWrite` payload |
| `web/src/app/api/anamnesis/token/[token]/__tests__/route.test.ts` | C1 | new PUT body, mock template query; GET cases unchanged |
| `web/src/db/queries/__tests__/anamnesis-tokens-tenant-scope.test.ts` | none | unchanged |
| `web/src/app/api/patients/[id]/anamnesis-link/__tests__/route.test.ts` | none | unchanged |
| `web/src/app/api/__tests__/write-access-coverage.test.ts` | none | unchanged; covers the new template route automatically |
| `web/src/lib/demo-seed/__tests__/clinical.test.ts` | C4 | unchanged (`buildAnamnesis` keeps its shape) |
| `web/src/app/(platform)/configuracoes/__tests__/settings-page-client.test.tsx` | D2 | add a stub mock for the new tab component |
| `web/src/components/reports/__tests__/prontuario-pdf.test.tsx` | D3 | rewrite the anamnese case |
| `web/src/db/queries/reports/__tests__/prontuario.test.ts` | D3 | summary expectation |
| `web/src/app/(platform)/relatorios/prontuario/__tests__/page.test.tsx` | D3 | summary fixture and copy |
| `web/src/app/api/reports/prontuario/__tests__/route.test.ts` | D3 | none expected (`anamnesis: null`) |
| `web/src/validations/__tests__/anamnesis.test.ts` | E1 | deleted with its module |
| `web/src/lib/__tests__/compliance.test.ts`, `observability.test.ts`, `api-error.test.ts` | none | unchanged |
| `web/e2e/patients.spec.ts` | none | unchanged (tab test ids only) |

---

## Group A (parallel, no dependencies)

### Task A1: Shared form library (`lib/forms`)

**Files**
- Create: `web/src/lib/forms/types.ts`, `web/src/lib/forms/constants.ts`, `web/src/lib/forms/response-schema.ts`, `web/src/lib/forms/sections-schema.ts`, `web/src/lib/forms/carry-responses.ts`, `web/src/lib/forms/answers.ts`
- Modify: `web/package.json`, `pnpm-lock.yaml` (`pnpm --filter @floraclin/web add fast-deep-equal@3.1.3`)
- Test: `web/src/lib/forms/__tests__/response-schema.test.ts`, `web/src/lib/forms/__tests__/sections-schema.test.ts`, `web/src/lib/forms/__tests__/carry-responses.test.ts`

**Interfaces**
- Consumes: nothing.
- Produces:

```ts
// types.ts
export const BASE_QUESTION_TYPES = [
  'radio', 'checkbox', 'scale', 'text', 'checkbox_with_other', 'radio_with_other', 'list',
] as const
/** 'face_diagram' exists only in evaluation templates and is rendered by the evaluation wrapper. */
export type FormQuestionType = (typeof BASE_QUESTION_TYPES)[number] | 'face_diagram'

export interface FormListColumn {
  id: string
  label: string
  kind: 'text' | 'select'
  options?: string[]
  required?: boolean
}

export interface FormQuestion {
  id: string
  label: string
  type: FormQuestionType
  required: boolean
  order: number
  options?: string[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  helpText?: string
  warningText?: string
  columns?: FormListColumn[]
}

export interface FormSection { id: string; title: string; order: number; questions: FormQuestion[] }

export type FormListResponse = Record<string, string>[]
export type FormResponseValue =
  | string
  | string[]
  | number
  | { selected: string[]; other: string }
  | { selected: string; other: string }
  | { completed: boolean }
  | FormListResponse
export type FormResponses = Record<string, FormResponseValue>

// constants.ts
export const QUESTION_TYPE_LABELS: Record<FormQuestionType, string>
export const CHOICE_QUESTION_TYPES: readonly FormQuestionType[]
export function generateFormId(): string

// response-schema.ts
export function questionResponseSchema(question: FormQuestion, options: { enforceRequired: boolean }): z.ZodTypeAny
export function buildFormResponseSchema(sections: FormSection[], options: { enforceRequired: boolean }): z.ZodObject<Record<string, z.ZodTypeAny>>

// sections-schema.ts
export const formListColumnSchema
export const formQuestionSchema
export const formSectionsSchema

// carry-responses.ts
export function carryResponses(responses: Record<string, unknown>, sections: FormSection[]): FormResponses

// answers.ts
export function isQuestionAnswered(question: FormQuestion, value: unknown): boolean
```

**Steps**

1. `constants.ts`:

```ts
export const QUESTION_TYPE_LABELS: Record<FormQuestionType, string> = {
  radio: 'Escolha única',
  checkbox: 'Múltipla escolha',
  scale: 'Escala',
  text: 'Texto livre',
  checkbox_with_other: 'Múltipla escolha com "Outro"',
  radio_with_other: 'Escolha única com "Outro"',
  list: 'Lista',
  face_diagram: 'Diagrama facial',
}

export const CHOICE_QUESTION_TYPES: readonly FormQuestionType[] = [
  'radio', 'checkbox', 'radio_with_other', 'checkbox_with_other',
]

export function generateFormId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}
```

2. `answers.ts`: move `isQuestionAnswered` from `components/evaluation/template-renderer.tsx` unchanged, typed with `FormQuestion`, plus `case 'list': return Array.isArray(value) && value.some((row) => row && typeof row === 'object' && Object.values(row).some((c) => typeof c === 'string' && c.trim() !== ''))`.

3. `response-schema.ts` (strict only):

```ts
import { z } from 'zod'
import { isQuestionAnswered } from './answers'
import type { FormQuestion, FormSection } from './types'

const isBlank = (v: string | undefined) => v === undefined || v.trim() === ''

function member(question: FormQuestion) {
  const options = question.options ?? []
  return z.string().refine((v) => options.includes(v), { message: `${question.label}: opção inválida` })
}

function listSchema(question: FormQuestion, enforceRequired: boolean) {
  const columns = question.columns ?? []
  return z
    .array(z.record(z.string(), z.string()))
    .transform((rows) =>
      rows
        .map((row) => Object.fromEntries(columns.filter((c) => !isBlank(row[c.id])).map((c) => [c.id, row[c.id]])))
        .filter((row) => Object.keys(row).length > 0),
    )
    .superRefine((rows, ctx) => {
      rows.forEach((row, index) => {
        for (const column of columns) {
          const value = row[column.id]
          if (enforceRequired && column.required && value === undefined) {
            ctx.addIssue({ code: 'custom', message: `${column.label}: campo obrigatório`, path: [index, column.id] })
          }
          if (column.kind === 'select' && value !== undefined && !(column.options ?? []).includes(value)) {
            ctx.addIssue({ code: 'custom', message: `${column.label}: opção inválida`, path: [index, column.id] })
          }
        }
      })
    })
}

function shapeSchema(question: FormQuestion, enforceRequired: boolean): z.ZodTypeAny {
  switch (question.type) {
    case 'radio':
      return member(question)
    case 'text':
      return z.string()
    case 'scale':
      return z.number()
    case 'checkbox':
      return z.array(member(question))
    case 'checkbox_with_other':
      return z.object({ selected: z.array(member(question)).default([]), other: z.string().default('') })
    case 'radio_with_other':
      return z.object({ selected: z.literal('').or(member(question)).default(''), other: z.string().default('') })
    case 'list':
      return listSchema(question, enforceRequired)
    case 'face_diagram':
      return z.unknown()
  }
}

export function questionResponseSchema(question: FormQuestion, options: { enforceRequired: boolean }): z.ZodTypeAny {
  const shape = shapeSchema(question, options.enforceRequired)
  if (!(options.enforceRequired && question.required)) return shape.optional()
  return z
    .unknown()
    .refine((v) => isQuestionAnswered(question, v), { message: `${question.label}: campo obrigatório` })
    .pipe(shape)
}

export function buildFormResponseSchema(sections: FormSection[], options: { enforceRequired: boolean }) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const section of sections ?? []) {
    for (const question of section.questions ?? []) shape[question.id] = questionResponseSchema(question, options)
  }
  return z.object(shape)
}
```

`z.object` strips unknown keys: that is how unknown question ids are dropped.

4. `sections-schema.ts`:

```ts
const label = z.string().trim().min(1, 'Preencha todos os títulos e rótulos')

export const formListColumnSchema = z
  .object({
    id: z.string().min(1),
    label,
    kind: z.enum(['text', 'select']),
    options: z.array(label).optional(),
    required: z.boolean().optional(),
  })
  .refine((c) => c.kind !== 'select' || (c.options?.length ?? 0) >= 2, {
    message: 'Colunas de seleção precisam de ao menos 2 opções',
    path: ['options'],
  })

export const formQuestionSchema = z
  .object({
    id: z.string().min(1),
    label,
    type: z.enum([...BASE_QUESTION_TYPES, 'face_diagram']),
    required: z.boolean(),
    order: z.number().int(),
    options: z.array(label).optional(),
    scaleMin: z.number().optional(),
    scaleMax: z.number().optional(),
    scaleMinLabel: z.string().optional(),
    scaleMaxLabel: z.string().optional(),
    helpText: z.string().optional(),
    warningText: z.string().optional(),
    columns: z.array(formListColumnSchema).optional(),
  })
  .superRefine((q, ctx) => {
    if (CHOICE_QUESTION_TYPES.includes(q.type) && (q.options?.length ?? 0) < 2) {
      ctx.addIssue({ code: 'custom', message: `"${q.label}" precisa de ao menos 2 opções`, path: ['options'] })
    }
    if (q.type === 'list') {
      const columns = q.columns ?? []
      if (columns.length === 0) {
        ctx.addIssue({ code: 'custom', message: `"${q.label}" precisa de ao menos 1 coluna`, path: ['columns'] })
      }
      if (new Set(columns.map((c) => c.id)).size !== columns.length) {
        ctx.addIssue({ code: 'custom', message: `"${q.label}" tem colunas repetidas`, path: ['columns'] })
      }
    }
  })

export const formSectionsSchema = z
  .array(z.object({ id: z.string().min(1), title: label, order: z.number().int(), questions: z.array(formQuestionSchema) }))
  .superRefine((sections, ctx) => {
    const sectionIds = new Set<string>()
    const questionIds = new Set<string>()
    for (const section of sections) {
      if (sectionIds.has(section.id)) ctx.addIssue({ code: 'custom', message: 'Seções com identificador repetido' })
      sectionIds.add(section.id)
      for (const question of section.questions) {
        if (questionIds.has(question.id)) ctx.addIssue({ code: 'custom', message: 'Perguntas com identificador repetido' })
        questionIds.add(question.id)
      }
    }
  })
```

The parsed output must be assignable to `FormSection[]`. The routes assign it to a `FormSection[]` variable, so a mismatch fails typecheck; fix the schema, not the call site.

5. `carry-responses.ts`:

```ts
export function carryResponses(responses: Record<string, unknown>, sections: FormSection[]): FormResponses {
  const carried: FormResponses = {}
  for (const section of sections) {
    for (const question of section.questions) {
      if (!(question.id in responses)) continue
      const parsed = questionResponseSchema(question, { enforceRequired: false }).safeParse(responses[question.id])
      if (parsed.success && parsed.data !== undefined) carried[question.id] = parsed.data as FormResponseValue
    }
  }
  return carried
}
```

6. Tests (each `it` names the regression):
   - `sections-schema.test.ts`, table-driven over one valid fixture mutated per row: duplicate question id across two sections, duplicate section id, radio with 1 option, list with no columns, list with duplicate column ids, select column with 1 option, blank question label. Each row asserts `success === false`; the untouched fixture asserts `true`.
   - `response-schema.test.ts`: list question (`name` required text, `severity` select `['Leve', 'Grave']`): blank rows dropped from the output; a kept row without `name` fails with `enforceRequired: true` and passes with `false`; `severity: 'Média'` fails in both modes. Radio answer not in options fails; checkbox with one foreign value fails; `radio_with_other` with `selected: ''` and `other: 'x'` passes. A required text question left empty fails only with `enforceRequired: true`. Unknown question ids are absent from the output.
   - `carry-responses.test.ts`: drops answers whose id is gone; keeps an answer whose question label was reworded (same id); drops an answer whose question changed type; drops a radio answer whose option was renamed.

### Task A2: Migration 0033 and Drizzle schema additions

**Files**
- Create: `web/src/db/migrations/0033_editable_anamnesis.sql`
- Modify: `web/src/db/schema.ts`

**Interfaces**
- Produces: `anamneses.templateVersion` (integer, nullable), `anamneses.templateSnapshot` (jsonb, nullable), `anamneses.responses` (jsonb, nullable); table `anamnesisTemplates` (`id`, `tenantId` unique, `sections`, `version`, `createdAt`, `updatedAt`); `anamnesisTemplatesRelations`; DB trigger `anamneses_invalidate_converted`.

**Steps**

1. SQL, applied by hand as one file (the function body contains semicolons, so run it with `psql -f`, not statement by statement):

```sql
ALTER TABLE "floraclin"."anamneses" ADD COLUMN "template_version" integer;
ALTER TABLE "floraclin"."anamneses" ADD COLUMN "template_snapshot" jsonb;
ALTER TABLE "floraclin"."anamneses" ADD COLUMN "responses" jsonb;

CREATE TABLE "floraclin"."anamnesis_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "sections" jsonb NOT NULL,
  "version" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "anamnesis_templates_tenant_id_unique" UNIQUE ("tenant_id")
);
ALTER TABLE "floraclin"."anamnesis_templates" ENABLE ROW LEVEL SECURITY;

-- Old code still writes the legacy columns during the deploy. Any such edit makes the converted
-- answers stale, so drop them and let the conversion script (responses IS NULL) redo the row.
-- Dropped in 0034 together with the legacy columns.
CREATE FUNCTION "floraclin"."anamneses_invalidate_converted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.responses IS NOT DISTINCT FROM OLD.responses AND (
       NEW.main_complaint IS DISTINCT FROM OLD.main_complaint
    OR NEW.patient_goals IS DISTINCT FROM OLD.patient_goals
    OR NEW.medical_history IS DISTINCT FROM OLD.medical_history
    OR NEW.medications IS DISTINCT FROM OLD.medications
    OR NEW.allergies IS DISTINCT FROM OLD.allergies
    OR NEW.previous_surgeries IS DISTINCT FROM OLD.previous_surgeries
    OR NEW.chronic_conditions IS DISTINCT FROM OLD.chronic_conditions
    OR NEW.is_pregnant IS DISTINCT FROM OLD.is_pregnant
    OR NEW.is_breastfeeding IS DISTINCT FROM OLD.is_breastfeeding
    OR NEW.lifestyle IS DISTINCT FROM OLD.lifestyle
    OR NEW.skin_type IS DISTINCT FROM OLD.skin_type
    OR NEW.skin_conditions IS DISTINCT FROM OLD.skin_conditions
    OR NEW.skincare_routine IS DISTINCT FROM OLD.skincare_routine
    OR NEW.previous_aesthetic_treatments IS DISTINCT FROM OLD.previous_aesthetic_treatments
    OR NEW.contraindications IS DISTINCT FROM OLD.contraindications
    OR NEW.facial_evaluation_notes IS DISTINCT FROM OLD.facial_evaluation_notes
  ) THEN
    NEW.responses := NULL;
    NEW.template_snapshot := NULL;
    NEW.template_version := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "anamneses_invalidate_converted"
  BEFORE UPDATE ON "floraclin"."anamneses"
  FOR EACH ROW EXECUTE FUNCTION "floraclin"."anamneses_invalidate_converted"();
```

2. `schema.ts`, in `anamneses` after `patientId` (legacy columns stay until Task E1):

```ts
templateVersion: integer('template_version'),
templateSnapshot: jsonb('template_snapshot'),
responses: jsonb('responses'),
```

3. After `anamnesisTokens`:

```ts
export const anamnesisTemplates = floraclinSchema.table('anamnesis_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  sections: jsonb('sections').notNull(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

and next to `anamnesesRelations`:

```ts
export const anamnesisTemplatesRelations = relations(anamnesisTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [anamnesisTemplates.tenantId], references: [tenants.id] }),
}))
```

4. No test (DDL; the trigger is verified in the rollout's local rehearsal, see Verification).

---

## Group B (depends on Group A; tasks parallel)

### Task B1: Shared form components, evaluation wrappers, procedure detail list display

**Files**
- Create: `web/src/components/forms/question-renderers.tsx`, `web/src/components/forms/form-renderer.tsx`, `web/src/components/forms/section-editor.tsx`, `web/src/components/forms/question-editor-dialog.tsx`, `web/src/components/forms/list-columns-editor.tsx`, `web/src/components/forms/form-template-editor.tsx`, `web/src/components/forms/list-answer-table.tsx`, `web/src/components/evaluation/face-diagram-question.tsx`
- Modify: `web/src/components/evaluation/template-editor.tsx`, `web/src/components/evaluation/template-renderer.tsx`, `web/src/components/evaluation/copy-template-dialog.tsx`, `web/src/components/procedures/procedure-detail-view.tsx`
- Delete: `web/src/components/evaluation/question-renderers.tsx`, `web/src/components/evaluation/section-editor.tsx`, `web/src/components/evaluation/question-editor-dialog.tsx`
- Test: modify `web/src/components/evaluation/__tests__/template-editor.test.tsx`, `copy-template-dialog.test.tsx` (type import only); create `web/src/components/forms/__tests__/question-editor-dialog.test.tsx`, `web/src/components/forms/__tests__/form-renderer.test.tsx`

**Interfaces**
- Consumes: A1.
- Produces:

```ts
// question-renderers.tsx
export function QuestionWrapper(props: { question: FormQuestion; children: React.ReactNode; hasError?: boolean }): JSX.Element
export function RadioQuestion(...); CheckboxQuestion(...); ScaleQuestion(...); TextQuestion(...)
export function CheckboxWithOtherQuestion(...); RadioWithOtherQuestion(...)
export function ListQuestion(props: {
  question: FormQuestion
  value: Record<string, string>[] | undefined
  onChange: (value: Record<string, string>[]) => void
  readOnly?: boolean
  showErrors?: boolean
}): JSX.Element

// form-renderer.tsx
export interface FormRendererProps {
  sections: FormSection[]
  responses: Record<string, unknown>
  onChange: (responses: Record<string, unknown>) => void
  readOnly?: boolean
  showErrors?: boolean
  /** Return a node to replace the default renderer for a question, or undefined to keep it. */
  renderQuestion?: (question: FormQuestion) => React.ReactNode | undefined
}
export function FormRenderer(props: FormRendererProps): JSX.Element

// question-editor-dialog.tsx
export interface QuestionEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  question?: FormQuestion | null
  allowedTypes: readonly FormQuestionType[]
  onSave: (question: Omit<FormQuestion, 'id' | 'order'>) => void
}

// list-columns-editor.tsx
export function ListColumnsEditor(props: { columns: FormListColumn[]; onChange: (columns: FormListColumn[]) => void }): JSX.Element

// list-answer-table.tsx (no 'use client'; rendered in client components and in the server-side PDF HTML)
export function ListAnswerTable(props: { question: FormQuestion; rows: FormListResponse; className?: string }): JSX.Element

// form-template-editor.tsx
export interface FormTemplateEditorProps {
  title?: string
  subtitle?: string
  sections: FormSection[]
  savedSections: FormSection[]
  onSectionsChange: (sections: FormSection[]) => void
  allowedTypes: readonly FormQuestionType[]
  onSave: (sections: FormSection[]) => Promise<{ success?: boolean; error?: string } | null>
  /** Omit to hide "Restaurar padrão". */
  onResetToDefault?: () => Promise<{ success?: boolean; error?: string; sections?: FormSection[] } | null>
  headerActions?: React.ReactNode
  emptyStateHint: string
  /** Omit to render embedded (no sticky full-width bar, no back button). */
  onBack?: () => void
}
export function FormTemplateEditor(props: FormTemplateEditorProps): JSX.Element

// evaluation/template-editor.tsx: props unchanged, typed with FormSection
// evaluation/template-renderer.tsx: TemplateRendererProps unchanged, typed with FormSection
// evaluation/face-diagram-question.tsx: FaceDiagramQuestion with today's props
```

**Steps**

1. `question-renderers.tsx`: move the file, retype with `FormQuestion`, export `QuestionWrapper`, move `FaceDiagramQuestion` to `components/evaluation/face-diagram-question.tsx` (it imports `QuestionWrapper`). `TextQuestion` stays a textarea.
2. `ListQuestion`: rows stacked on mobile, one line per row from `sm` up, with a column header line on `sm+` (required columns marked `*`). Cell: `Input` (placeholder and `aria-label` = column label) for `text`; base-ui `Select` with `items={Object.fromEntries(options.map((o) => [o, o]))}` and placeholder "Selecione..." for `select`. `onValueChange(null)` deletes that cell from the row. Each row has a remove button (`Trash2`, `aria-label="Remover item"`); below, an outline "Adicionar item" button appends `{}`. `readOnly` hides both buttons and disables inputs. `hasError = showErrors && question.required && !isQuestionAnswered(question, value)`.
3. `list-answer-table.tsx`: `<table className={className}>` with a header row of column labels and one row per answer row; a missing cell renders empty.
4. `form-renderer.tsx`: today's `TemplateRenderer` body minus the diagram logic: accordion, per-section `answered/total respondidas` via `isQuestionAnswered`, and a `QuestionRenderer` switch with a `list` case. Before the switch: `const custom = renderQuestion?.(question); if (custom !== undefined) return custom`.
5. `evaluation/template-renderer.tsx`: keep `TemplateRendererProps` and the `firstDiagramQuestionId` memo; render `<FormRenderer ... renderQuestion={(q) => q.type === 'face_diagram' ? <FaceDiagramQuestion question={q} diagramRendered={diagramRendered || q.id !== firstDiagramQuestionId} diagramPoints={diagramPoints} onDiagramChange={onDiagramChange} patientGender={patientGender} products={products} readOnly={readOnly} /> : undefined} />`.
6. `question-editor-dialog.tsx`: move; required prop `allowedTypes`; the type `Select` items are `allowedTypes` mapped through `QUESTION_TYPE_LABELS`; a new question defaults to `allowedTypes[0]`. New state `columns: FormListColumn[]`, shown through `<ListColumnsEditor>` only for `list`; `if (type === 'list') data.columns = columns`. `isValid = formQuestionSchema.safeParse({ ...data, id: 'draft', order: 0 }).success`.
7. `list-columns-editor.tsx`: one card per column with "Nome da coluna" `Input`, kind `Select` (`{ text: 'Texto', select: 'Lista de opções' }`), "Obrigatória" `Switch`, and icon buttons "Mover coluna para cima" / "Mover coluna para baixo" / "Remover coluna" (as `aria-label`s). For `select`, a `Textarea` "Opções (uma por linha)" parsed with `split('\n').map((s) => s.trim()).filter(Boolean)`. "Adicionar coluna" appends `{ id: generateFormId(), label: '', kind: 'text' }`. Column ids never change.
8. `section-editor.tsx`: move, retype, use `QUESTION_TYPE_LABELS` from `@/lib/forms/constants`.
9. `form-template-editor.tsx`: today's `TemplateEditor` body, with: `sections` / `onSectionsChange` replacing local state; `hasChanges = JSON.stringify(sections) !== JSON.stringify(savedSections)`; title block rendered only when `title` is set; back button and the sticky `z-30` full-width bar only when `onBack` is set (otherwise a plain toolbar row); `headerActions` rendered before "Restaurar padrão"; "Restaurar padrão" (desktop button, "Mais ações" dropdown item, inline confirm) only when `onResetToDefault` is set, and on success `onSectionsChange(result.sections)`; the dropdown renders only when it has an item; `QuestionEditorDialog` gets `allowedTypes`; editing a question replaces it with `{ ...data, id: editingQuestion.id, order: editingQuestion.order }` (Decision 19); `generateFormId` replaces `generateId`. Keep every toast string ("Template salvo com sucesso", "Erro ao salvar template", "Template restaurado ao padrão", "Erro ao restaurar template").
10. `evaluation/template-editor.tsx` wrapper:

```tsx
const EVALUATION_QUESTION_TYPES: readonly FormQuestionType[] = [...BASE_QUESTION_TYPES, 'face_diagram']

export function TemplateEditor({ procedureTypeName, procedureTypeId, hasDefaultTemplate, initialSections, onSave, onResetToDefault, onBack }: TemplateEditorProps) {
  const [sections, setSections] = useState<FormSection[]>(initialSections)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  return (
    <>
      <FormTemplateEditor
        title="Ficha de Avaliação"
        subtitle={procedureTypeName}
        sections={sections}
        savedSections={initialSections}
        onSectionsChange={setSections}
        allowedTypes={EVALUATION_QUESTION_TYPES}
        onSave={onSave}
        onResetToDefault={hasDefaultTemplate ? onResetToDefault : undefined}
        headerActions={
          <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(true)} aria-label="Copiar de outro procedimento">
            <CopyIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Copiar de outro procedimento</span>
          </Button>
        }
        emptyStateHint={hasDefaultTemplate
          ? 'Adicione seções e perguntas, restaure o modelo padrão ou copie a ficha de outro procedimento.'
          : 'Adicione seções e perguntas ou copie a ficha de outro procedimento.'}
        onBack={onBack}
      />
      <CopyTemplateDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        currentProcedureTypeId={procedureTypeId}
        onCopy={(copied) => {
          setSections(copied)
          toast.success('Ficha copiada. Revise e salve.')
        }}
      />
    </>
  )
}
```

11. `copy-template-dialog.tsx`: `EvaluationSection` to `FormSection`.
12. `procedure-detail-view.tsx`: `EvaluationSection` / `EvaluationResponses` / `EvaluationQuestion` to `FormSection` / `FormResponses` / `FormQuestion`; `EvalAnswerDisplay` gets `case 'list': return <ListAnswerTable question={question} rows={answer as FormListResponse} className="text-xs [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-mid [&_td]:pr-3" />`. Nothing else changes.
13. Tests:
   - Existing evaluation tests: type import only; they must pass unchanged (proof the refactor changed no behavior).
   - `question-editor-dialog.test.tsx`: with `allowedTypes={BASE_QUESTION_TYPES}` the type list has no "Diagrama facial" (regression: the anamnesis editor offers a type it cannot render); a `list` question keeps "Adicionar" disabled until a column has a name, and a `select` column needs 2 options; saving calls `onSave` with `columns` in the edited order (regression: column reorder lost).
   - `form-renderer.test.tsx`: a `list` question: "Adicionar item", type into the first column, `onChange` receives `[{ name: 'Losartana' }]`; "Remover item" removes it; with `readOnly` there is no add button.

### Task B2: Evaluation type rename, lenient evaluation schema, dead code

**Files**
- Modify: `web/src/types/evaluation.ts`, `web/src/lib/validations/build-evaluation-schema.ts`, `web/src/lib/validations/__tests__/build-evaluation-schema.test.ts`, `web/src/lib/default-evaluation-templates/{bioestimulador,enzima,limpeza-pele,microagulhamento,preenchimentos,skinbooster,skincare,toxina-botulinica}.ts`, `web/src/db/queries/evaluation-templates.ts`, `web/src/db/queries/evaluation-responses.ts`, `web/src/components/procedures/procedure-form.tsx`, `web/src/components/procedures/planning/evaluation-templates-section.tsx`, `web/src/components/service-wizard/service-wizard.tsx` (evaluation type imports only), `web/src/app/(platform)/configuracoes/avaliacao/[procedureTypeId]/evaluation-template-page-client.tsx`, `web/src/app/(platform)/configuracoes/avaliacao/[procedureTypeId]/template-editor-page.tsx`
- Delete: `web/src/lib/evaluation-utils.ts`

**Interfaces**
- Consumes: A1 types and `questionResponseSchema`.
- Produces: `types/evaluation.ts` exports only `ProcedureCategory` and `DefaultTemplateDefinition` (`sections: FormSection[]`). `buildEvaluationResponseSchema(templates: { id: string; sections: FormSection[] }[])` keeps its signature and behavior.

**Steps**

1. `types/evaluation.ts`: delete every generic question/section/response type; import `FormSection` for `DefaultTemplateDefinition`.
2. Each file in this task: `EvaluationSection` to `FormSection`, `EvaluationQuestion` to `FormQuestion`, `EvaluationResponses` to `FormResponses`, from `@/lib/forms/types`. End with `grep -rn "EvaluationSection\|EvaluationQuestion\b\|EvaluationResponses\b\|EvaluationResponseValue\|EvaluationQuestionType" web/src`; only B1-owned files may still match.
3. `build-evaluation-schema.ts` keeps its own lenient per-question schema (optional questions accept any value, required ones use today's switch verbatim) and adds one case:

```ts
case 'list':
  return questionResponseSchema(question, { enforceRequired: true })
```

The function signature changes from `(type, required)` to `(question: FormQuestion)` so the `list` case has the columns; behavior for every existing type is unchanged.
4. Delete `lib/evaluation-utils.ts` (no importer; confirm with grep).
5. Tests: only the type import in `build-evaluation-schema.test.ts`. Run the evaluation suite listed in "Existing tests" unchanged.

### Task B3: Anamnesis domain library

**Files**
- Create: `web/src/lib/anamnesis/types.ts`, `web/src/lib/anamnesis/default-template.ts`, `web/src/lib/anamnesis/schemas.ts`, `web/src/lib/anamnesis/prepare-save.ts`, `web/src/lib/anamnesis/convert-legacy.ts`
- Modify: `web/src/i18n/messages/pt-BR.json` (delete the top-level `"anamnesis": { ... }` object only)
- Test: `web/src/lib/anamnesis/__tests__/default-template.test.ts`, `web/src/lib/anamnesis/__tests__/prepare-save.test.ts`, `web/src/lib/anamnesis/__tests__/convert-legacy.test.ts`

**Interfaces**
- Consumes: A1.
- Produces:

```ts
// types.ts
export interface AnamnesisTemplate { version: number; sections: FormSection[] }
export interface AnamnesisRecord {
  id: string
  patientId: string
  templateVersion: number
  templateSnapshot: FormSection[]
  responses: FormResponses
  updatedBy: string | null
  createdAt: Date | string
  updatedAt: Date | string
}
export interface AnamnesisWrite { templateVersion: number; templateSnapshot: FormSection[]; responses: FormResponses }

// default-template.ts
export const DEFAULT_ANAMNESIS_TEMPLATE: AnamnesisTemplate // version 0

// schemas.ts
export const anamnesisSectionsSchema // formSectionsSchema plus "no face_diagram"
export const anamnesisSaveBodySchema // z.object({ templateVersion, responses, expectedUpdatedAt?, expectNoRow?, applyCurrentTemplate? })
export type AnamnesisSaveBody = z.infer<typeof anamnesisSaveBodySchema>

// prepare-save.ts
export type AnamnesisSaveMode = 'staff' | 'staff_apply_current' | 'public'
export type PrepareSaveResult =
  | { ok: true; write: AnamnesisWrite }
  | { ok: false; status: 409; code: 'stale' | 'template_changed'; error: string }
  | { ok: false; status: 400; error: string }
export function prepareAnamnesisSave(input: {
  mode: AnamnesisSaveMode
  existing: Pick<AnamnesisRecord, 'templateVersion' | 'templateSnapshot'> | null
  current: AnamnesisTemplate
  body: Pick<AnamnesisSaveBody, 'templateVersion' | 'responses' | 'expectNoRow'>
}): PrepareSaveResult

// convert-legacy.ts
export interface LegacyAnamnesisRow {
  main_complaint: string | null
  patient_goals: string | null
  medical_history: Record<string, unknown> | null
  medications: unknown
  allergies: unknown
  previous_surgeries: unknown
  chronic_conditions: unknown
  is_pregnant: boolean | null
  is_breastfeeding: boolean | null
  lifestyle: Record<string, unknown> | null
  skincare_routine: unknown
  previous_aesthetic_treatments: unknown
}
export function convertLegacyAnamnesis(row: LegacyAnamnesisRow): FormResponses
```

**Steps**

1. `default-template.ts`. All questions `required: false`; `order` = index in its section; section `order` = index. Labels follow today's form:

| Section id / title | Question id | Type | Label | Details |
|---|---|---|---|---|
| `anam-sec-complaint` / Queixa principal e objetivos | `anam-main-complaint` | text | Queixa principal | |
| | `anam-patient-goals` | text | Objetivos do paciente | |
| `anam-sec-medical-history` / Histórico médico | `anam-medical-history` | checkbox_with_other | Condições de saúde | options: Diabetes, Hipertensão, Doença autoimune, Doença cardiovascular, Hepatite, HIV/AIDS, Câncer, Epilepsia, Distúrbio de coagulação, Queloides, Herpes |
| `anam-sec-medications` / Medicamentos em uso | `anam-medications` | list | Medicamentos | `name` Nome (required), `dosage` Dosagem, `frequency` Frequência, `reason` Motivo |
| `anam-sec-allergies` / Alergias | `anam-allergies` | list | Alergias | `substance` Substância (required), `reaction` Reação, `severity` Gravidade select [Leve, Moderada, Grave] |
| `anam-sec-surgeries` / Cirurgias anteriores | `anam-previous-surgeries` | list | Cirurgias | `procedure` Procedimento (required), `year` Ano, `notes` Observações |
| `anam-sec-chronic` / Condições crônicas | `anam-chronic-conditions` | list | Condições crônicas | `condicao` Condição (required) |
| `anam-sec-pregnancy` / Gestação / Amamentação | `anam-pregnant` | radio | Gestante? | [Sim, Não] |
| | `anam-breastfeeding` | radio | Amamentando? | [Sim, Não] |
| `anam-sec-lifestyle` / Estilo de vida | `anam-smoking` | radio | Tabagismo | ['Não', 'Ex-fumante', 'Sim, ocasional', 'Sim, diário'] |
| | `anam-alcohol` | radio | Álcool | [Não, Ocasional, Moderado, Frequente] |
| | `anam-exercise` | radio | Exercício físico | [Sedentário, Leve, Moderado, Intenso] |
| | `anam-sleep` | radio | Qualidade do sono | [Ruim, Regular, Bom, Excelente] |
| | `anam-diet` | radio | Alimentação | [Desequilibrada, Regular, Equilibrada, Restritiva] |
| | `anam-sun-exposure` | radio | Exposição solar | [Mínima, Moderada, Alta, Muito alta] |
| `anam-sec-skincare` / Rotina de cuidados com a pele | `anam-skincare-routine` | list | Produtos | `product` Produto (required), `frequency` Frequência, `notes` Observações |
| `anam-sec-treatments` / Tratamentos estéticos anteriores | `anam-previous-treatments` | list | Tratamentos | `procedure` Procedimento (required), `date` Data, `professional` Profissional, `notes` Observações, `satisfaction` Satisfação select [Muito insatisfeito, Insatisfeito, Neutro, Satisfeito, Muito satisfeito] |

Write the object literally with no `undefined`-valued keys (deep equality with jsonb round trips depends on it).

2. `schemas.ts`:

```ts
export const anamnesisSectionsSchema = formSectionsSchema.refine(
  (sections) => sections.every((s) => s.questions.every((q) => q.type !== 'face_diagram')),
  { message: 'Diagrama facial não é permitido na anamnese' },
)

export const anamnesisSaveBodySchema = z.object({
  templateVersion: z.number().int().nonnegative(),
  responses: z.record(z.string(), z.unknown()),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  expectNoRow: z.boolean().optional(),
  applyCurrentTemplate: z.boolean().optional(),
})
```

3. `prepare-save.ts`:

```ts
const STALE = 'Os dados foram alterados por outro usuário. Recarregue a página e tente novamente.'
const TEMPLATE_CHANGED = 'O modelo de anamnese mudou. Os dados foram recarregados.'

export function prepareAnamnesisSave({ mode, existing, current, body }: PrepareSaveInput): PrepareSaveResult {
  if (mode !== 'public' && body.expectNoRow && existing) {
    return { ok: false, status: 409, code: 'stale', error: STALE }
  }

  const useRecordSnapshot = mode === 'staff' && existing !== null
  const target: AnamnesisTemplate = useRecordSnapshot
    ? { version: existing.templateVersion, sections: existing.templateSnapshot }
    : current

  let responses: Record<string, unknown> = body.responses
  let enforceRequired = false
  if (mode === 'public') {
    const sawCurrent = body.templateVersion === current.version
    enforceRequired = sawCurrent
    if (!sawCurrent) responses = carryResponses(responses, current.sections)
  } else if (body.templateVersion !== target.version) {
    return { ok: false, status: 409, code: 'template_changed', error: TEMPLATE_CHANGED }
  }

  const parsed = buildFormResponseSchema(target.sections, { enforceRequired }).safeParse(responses)
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  return {
    ok: true,
    write: { templateVersion: target.version, templateSnapshot: target.sections, responses: parsed.data as FormResponses },
  }
}
```

4. `convert-legacy.ts`: literal key-to-label maps copied from today's constants in `components/anamnesis/anamnesis-form.tsx` (`MEDICAL_HISTORY_LABELS` with `hiv: 'HIV/AIDS'`, `SMOKING_OPTIONS`, `ALCOHOL_OPTIONS`, `EXERCISE_OPTIONS`, `SLEEP_OPTIONS`, `DIET_OPTIONS`, `SUN_EXPOSURE_OPTIONS`, `SEVERITY_OPTIONS`, `SATISFACTION_OPTIONS`), and:

```ts
const LIFESTYLE: Record<string, { id: string; labels: Record<string, string> }> = {
  smoking: { id: 'anam-smoking', labels: SMOKING },
  alcohol: { id: 'anam-alcohol', labels: ALCOHOL },
  exercise: { id: 'anam-exercise', labels: EXERCISE },
  sleep: { id: 'anam-sleep', labels: SLEEP },
  diet: { id: 'anam-diet', labels: DIET },
  sunExposure: { id: 'anam-sun-exposure', labels: SUN_EXPOSURE },
}

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function listRows(value: unknown, columns: string[], selectLabels: Record<string, Record<string, string>> = {}) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row: Record<string, string> = {}
      if (typeof item !== 'object' || item === null) return row
      for (const column of columns) {
        const cell = (item as Record<string, unknown>)[column]
        if (!filled(cell)) continue
        const labels = selectLabels[column]
        if (!labels) row[column] = cell
        else if (labels[cell]) row[column] = labels[cell]
      }
      return row
    })
    .filter((row) => Object.keys(row).length > 0)
}

export function convertLegacyAnamnesis(row: LegacyAnamnesisRow): FormResponses {
  const out: FormResponses = {}
  if (filled(row.main_complaint)) out['anam-main-complaint'] = row.main_complaint
  if (filled(row.patient_goals)) out['anam-patient-goals'] = row.patient_goals

  const history = row.medical_history ?? {}
  const selected = Object.entries(MEDICAL_HISTORY).filter(([key]) => history[key] === true).map(([, label]) => label)
  const other = filled(history.outros) ? history.outros : ''
  if (selected.length > 0 || other) out['anam-medical-history'] = { selected, other }

  const lists: Array<[string, unknown, string[], Record<string, Record<string, string>>?]> = [
    ['anam-medications', row.medications, ['name', 'dosage', 'frequency', 'reason']],
    ['anam-allergies', row.allergies, ['substance', 'reaction', 'severity'], { severity: SEVERITY }],
    ['anam-previous-surgeries', row.previous_surgeries, ['procedure', 'year', 'notes']],
    ['anam-skincare-routine', row.skincare_routine, ['product', 'frequency', 'notes']],
    ['anam-previous-treatments', row.previous_aesthetic_treatments, ['procedure', 'date', 'professional', 'notes', 'satisfaction'], { satisfaction: SATISFACTION }],
  ]
  for (const [id, value, columns, selects] of lists) {
    const rows = listRows(value, columns, selects)
    if (rows.length > 0) out[id] = rows
  }

  const chronic = Array.isArray(row.chronic_conditions)
    ? row.chronic_conditions.filter(filled).map((condicao) => ({ condicao }))
    : []
  if (chronic.length > 0) out['anam-chronic-conditions'] = chronic

  // The legacy columns default to false, so false never proved the patient answered "no".
  if (row.is_pregnant === true) out['anam-pregnant'] = 'Sim'
  if (row.is_breastfeeding === true) out['anam-breastfeeding'] = 'Sim'

  for (const [key, { id, labels }] of Object.entries(LIFESTYLE)) {
    const value = row.lifestyle?.[key]
    if (filled(value) && labels[value]) out[id] = labels[value]
  }
  return out
}
```

5. Tests:
   - `default-template.test.ts`: `anamnesisSectionsSchema.safeParse(DEFAULT_ANAMNESIS_TEMPLATE.sections).success === true` (regression: a default the server rejects on the first save after "Restaurar padrão").
   - `prepare-save.test.ts` (fixtures: record snapshot v2 with `q-old`, `q-kept`; current template v3 with `q-kept`, `q-new` required radio):
     - staff save on an existing row writes the record's snapshot and v2, not v3 (regression: an edit silently moves the record to the new template);
     - staff save with `templateVersion: 1` on a v2 record returns 409 `template_changed`;
     - new patient (`existing: null`) with `templateVersion: 2` while current is v3 returns 409 `template_changed` (no silent carry);
     - `expectNoRow: true` with an existing row returns 409 `stale`;
     - `staff_apply_current` with `templateVersion: 3` writes the v3 snapshot and does not require `q-new`; an answer for `q-old` in the body is stripped;
     - public with `templateVersion: 3` and empty `q-new` returns 400; public with `templateVersion: 2` and empty `q-new` saves v3, drops `q-old`, no error.
   - `convert-legacy.test.ts`, table-driven with hand-written expected values: each legacy field maps to its id and label (main_complaint, patient_goals, medical_history `{ diabetes: true, hipertensao: false, outros: 'Enxaqueca' }` to `{ selected: ['Diabetes'], other: 'Enxaqueca' }`, medications, allergies with `severity: 'grave'` to `'Grave'`, previous_surgeries, chronic_conditions `['Asma']` to `[{ condicao: 'Asma' }]`, skincare_routine, previous_aesthetic_treatments with `satisfaction: 'muito_satisfeito'`, `is_pregnant: true` to `'Sim'`, each lifestyle key); `is_pregnant: false` and `is_breastfeeding: false` leave the ids absent; empty strings, empty arrays, all-blank list rows and `{ outros: '' }` are omitted (an all-empty legacy row converts to `{}`); a fully filled legacy row converts to responses that pass `buildFormResponseSchema(DEFAULT_ANAMNESIS_TEMPLATE.sections, { enforceRequired: false })` unchanged (regression: mapper labels and default template options drift apart).

### Task B4: Validate evaluation template saves

**Files**
- Modify: `web/src/app/api/evaluation/templates/route.ts`
- Test: create `web/src/app/api/evaluation/templates/__tests__/route.test.ts`, `web/src/lib/default-evaluation-templates/__tests__/defaults-valid.test.ts`

**Interfaces**
- Consumes: A1 `formSectionsSchema`.
- Produces: POST `create` and `update` return 400 `{ error: 'Dados inválidos: ...' }` for invalid sections.

**Steps**

1. In POST, for `create` and `update`: `const parsed = formSectionsSchema.safeParse(body.sections)`; on failure return 400 with joined issue messages; pass `parsed.data` to `createTemplate` / `updateTemplate`. `reset` is unchanged (code constants).
2. Tests:
   - Route (mock write-access, auth, `@/db/queries/evaluation-templates`): `update` with a radio question with one option returns 400 and never calls `updateTemplate` (regression: invalid templates saved as today).
   - `defaults-valid.test.ts`: `it.each(defaultTemplates)` passes `formSectionsSchema` (regression: after "Restaurar padrão", the next save of an untouched default is rejected).

### Task B5: Pre-merge evaluation template check script

**Files**
- Create: `web/src/db/migrations/manual/0033_check_evaluation_templates.ts`

**Interfaces**
- Consumes: A1 `formSectionsSchema`.
- Produces: CLI, read-only, exit 1 when any stored template fails.

**Steps**

1. Header with the run command (style of `0009_update_confirmation_template_buttons.ts`): `npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_check_evaluation_templates.ts`.
2. Select `id, tenantId, procedureTypeId, name, sections` from `evaluationTemplates` where `deletedAt is null`; for each, `formSectionsSchema.safeParse(sections)`; print `tenantId templateId name: <issue messages>` for failures, then `N of M templates fail`; `process.exit(failures > 0 ? 1 : 0)`. Read-only.
3. No test (I/O wrapper over the A1 schema, which A1 tests own).

---

## Group C (depends on Groups A and B; tasks parallel)

### Task C1: Anamnesis server (queries and routes)

**Files**
- Create: `web/src/db/queries/anamnesis-templates.ts`, `web/src/app/api/anamnesis/template/route.ts`
- Modify: `web/src/db/queries/anamnesis.ts`, `web/src/app/api/anamnesis/[patientId]/route.ts`, `web/src/app/api/anamnesis/token/[token]/route.ts`
- Test: create `web/src/db/queries/__tests__/anamnesis-templates.test.ts`, `web/src/app/api/anamnesis/template/__tests__/route.test.ts`, `web/src/app/api/anamnesis/[patientId]/__tests__/route.test.ts`; modify `web/src/db/queries/__tests__/anamnesis-tenant-scope.test.ts`, `web/src/app/api/anamnesis/token/[token]/__tests__/route.test.ts`

**Interfaces**
- Consumes: A2 tables; B3 types, `DEFAULT_ANAMNESIS_TEMPLATE`, `anamnesisSectionsSchema`, `anamnesisSaveBodySchema`, `prepareAnamnesisSave`; `fast-deep-equal`.
- Produces:

```ts
// db/queries/anamnesis-templates.ts
export async function getCurrentAnamnesisTemplate(tenantId: string): Promise<AnamnesisTemplate>
export type SaveAnamnesisTemplateResult =
  | { changed: false; template: AnamnesisTemplate }
  | { changed: true; id: string; previous: AnamnesisTemplate; template: AnamnesisTemplate }
export async function saveAnamnesisTemplate(tenantId: string, sections: FormSection[]): Promise<SaveAnamnesisTemplateResult>

// db/queries/anamnesis.ts
export async function getAnamnesis(tenantId: string, patientId: string): Promise<AnamnesisRecord | null>
export class StaleDataError extends Error // unchanged
export async function upsertAnamnesis(
  tenantId: string, patientId: string, userId: string, data: AnamnesisWrite, expectedUpdatedAt?: Date,
): Promise<{ id: string; updatedAt: Date; updatedBy: string | null; templateVersion: number; templateSnapshot: FormSection[] }>

// GET /api/anamnesis/template -> AnamnesisTemplate
// POST /api/anamnesis/template { action: 'update', sections } | { action: 'reset' } -> { success: true, data: AnamnesisTemplate }
// PUT /api/anamnesis/[patientId] AnamnesisSaveBody
//   -> 200 { success: true, data: { id, updatedAt, updatedBy, templateVersion, templateSnapshot } }
//   -> 400 { error } | 409 { error, code: 'stale' | 'template_changed' }
// PUT /api/anamnesis/token/[token] { templateVersion, responses } -> { success: true } | 400
```

**Steps**

1. Template queries:

```ts
export async function getCurrentAnamnesisTemplate(tenantId: string): Promise<AnamnesisTemplate> {
  const [row] = await db
    .select({ version: anamnesisTemplates.version, sections: anamnesisTemplates.sections })
    .from(anamnesisTemplates)
    .where(eq(anamnesisTemplates.tenantId, tenantId))
    .limit(1)
  return row ? { version: row.version, sections: row.sections as FormSection[] } : DEFAULT_ANAMNESIS_TEMPLATE
}

export async function saveAnamnesisTemplate(tenantId: string, sections: FormSection[]): Promise<SaveAnamnesisTemplateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(anamnesisTemplates)
      .where(eq(anamnesisTemplates.tenantId, tenantId))
      .for('update')
      .limit(1)
    const previous: AnamnesisTemplate = row
      ? { version: row.version, sections: row.sections as FormSection[] }
      : DEFAULT_ANAMNESIS_TEMPLATE
    if (equal(previous.sections, sections)) return { changed: false, template: previous }

    const [saved] = row
      ? await tx
          .update(anamnesisTemplates)
          .set({ sections, version: row.version + 1, updatedAt: new Date() })
          .where(eq(anamnesisTemplates.id, row.id))
          .returning()
      : await tx
          .insert(anamnesisTemplates)
          .values({ tenantId, sections, version: 1 })
          .onConflictDoUpdate({
            target: anamnesisTemplates.tenantId,
            set: { sections, version: sql`${anamnesisTemplates.version} + 1`, updatedAt: new Date() },
          })
          .returning()
    return { changed: true, id: saved.id, previous, template: { version: saved.version, sections: saved.sections as FormSection[] } }
  })
}
```

2. Template route:

```ts
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), sections: anamnesisSectionsSchema }),
  z.object({ action: z.literal('reset') }),
])

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    return NextResponse.json(await getCurrentAnamnesisTemplate(ctx.tenantId))
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      )
    }
    const sections = parsed.data.action === 'reset' ? DEFAULT_ANAMNESIS_TEMPLATE.sections : parsed.data.sections
    const result = await saveAnamnesisTemplate(ctx.tenantId, sections)
    if (result.changed) {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: result.previous.version === 0 ? 'create' : 'update',
        entityType: 'anamnesis_template',
        entityId: result.id,
        changes: {
          sections: { old: result.previous.sections, new: result.template.sections },
          version: { old: result.previous.version, new: result.template.version },
        },
      })
    }
    return NextResponse.json({ success: true, data: result.template })
  } catch (error) {
    return handleApiError(error, request)
  }
}
```

3. `db/queries/anamnesis.ts`: drop the `AnamnesisFormData` import. `getAnamnesis` selects `{ id, patientId, templateVersion, templateSnapshot, responses, updatedBy, createdAt, updatedAt }` and maps:

```ts
function toAnamnesisRecord(row: Row): AnamnesisRecord {
  return {
    id: row.id,
    patientId: row.patientId,
    // Null only between the deploy and the post-deploy conversion run; 0034 makes these NOT NULL.
    templateVersion: row.templateVersion ?? DEFAULT_ANAMNESIS_TEMPLATE.version,
    templateSnapshot: (row.templateSnapshot as FormSection[] | null) ?? DEFAULT_ANAMNESIS_TEMPLATE.sections,
    responses: (row.responses as FormResponses | null) ?? {},
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
```

`upsertAnamnesis` keeps `verifyTenantOwnership`, the optimistic lock and the update/insert split, writes only `templateVersion`, `templateSnapshot`, `responses`, `updatedBy`, `updatedAt` (plus `tenantId`, `patientId` on insert), and returns `{ id, updatedAt, updatedBy, templateVersion, templateSnapshot }`.

4. `PUT /api/anamnesis/[patientId]`:

```ts
export async function PUT(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { patientId } = await params
    const body = anamnesisSaveBodySchema.safeParse(await request.json())
    if (!body.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

    const [existing, current] = await Promise.all([
      getAnamnesis(ctx.tenantId, patientId),
      getCurrentAnamnesisTemplate(ctx.tenantId),
    ])
    const prepared = prepareAnamnesisSave({
      mode: body.data.applyCurrentTemplate ? 'staff_apply_current' : 'staff',
      existing,
      current,
      body: body.data,
    })
    if (!prepared.ok) {
      return NextResponse.json(
        prepared.status === 409 ? { error: prepared.error, code: prepared.code } : { error: prepared.error },
        { status: prepared.status },
      )
    }

    const result = await upsertAnamnesis(
      ctx.tenantId, patientId, ctx.userId, prepared.write,
      body.data.expectedUpdatedAt ? new Date(body.data.expectedUpdatedAt) : undefined,
    )
    // audit exactly as today: action create/update, entityType 'anamnesis'
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof StaleDataError) {
      return NextResponse.json({ error: error.message, code: 'stale' }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
```

GET keeps its role check and returns `AnamnesisRecord | null`.

5. Token route: GET unchanged. PUT: after both existing gates, `const body = anamnesisSaveBodySchema.pick({ templateVersion: true, responses: true }).safeParse(await request.json())` (400 on failure); `prepareAnamnesisSave({ mode: 'public', existing: null, current: await getCurrentAnamnesisTemplate(row.tenantId), body: body.data })`; 400 on failure; `upsertAnamnesis(row.tenantId, row.patientId, row.createdBy, prepared.write)`; `markTokenUsed` as today.
6. Tests:
   - `anamnesis-templates.test.ts` (mock `@/db/client` with a `transaction` that calls back with a tx chain whose `select ... for().limit()` resolves the fixture row): saving sections deep-equal to the stored row, and saving the default sections when no row exists, both write nothing and return `changed: false` (regression: no-op saves and "Restaurar padrão" on the default bump the version and trigger banners for every record). Build the "equal" input with keys in a different order than the stored fixture.
   - Template route (mock write-access, audit, auth, the query module): POST asks `requireWrite('owner')` and returns the `blocked` response as-is (non-owner gets 403); a `face_diagram` question or a choice question with 1 option returns 400 and never calls `saveAnamnesisTemplate`; `reset` saves `DEFAULT_ANAMNESIS_TEMPLATE.sections` and audits both sections and versions; a `changed: false` result writes no audit entry.
   - `[patientId]` route (mock write-access, audit, auth, `@/db/queries/anamnesis` keeping the real `StaleDataError`, `@/db/queries/anamnesis-templates`): a body without `responses` (the old `{ formData }` shape) returns 400 and never calls `upsertAnamnesis` (regression: a stale browser bundle blanks the record); a `template_changed` result returns 409 with `code: 'template_changed'`; `upsertAnamnesis` throwing `StaleDataError` returns 409 `code: 'stale'`.
   - Token route: keep the subscription cases with body `{ templateVersion: 0, responses: {} }`; mock `getCurrentAnamnesisTemplate`; add: a body without `responses` returns 400 and never upserts; PUT saves with the template of the token's tenant (called with `TOKEN_TENANT_ID`, `upsertAnamnesis` receives that version and snapshot).
   - `anamnesis-tenant-scope.test.ts`: `DATA = { templateVersion: 0, templateSnapshot: [], responses: {} }`; drop the `validations/anamnesis` import; the three cases stay.

### Task C2: Client hooks

**Files**
- Modify: `web/src/hooks/queries/use-anamnesis.ts`, `web/src/hooks/queries/query-keys.ts`, `web/src/hooks/queries/index.ts`, `web/src/hooks/mutations/use-anamnesis-mutations.ts`

**Interfaces**
- Consumes: B3 types.
- Produces:

```ts
// query-keys.ts
anamnesisTemplate: ['anamnesisTemplate'] as const

// use-anamnesis.ts
export function fetchAnamnesis(patientId: string): Promise<AnamnesisRecord | null>
export function fetchAnamnesisTemplate(): Promise<AnamnesisTemplate>
export function useAnamnesis(patientId: string): UseQueryResult<AnamnesisRecord | null>
export function useAnamnesisTemplate(): UseQueryResult<AnamnesisTemplate>

// use-anamnesis-mutations.ts
export class AnamnesisSaveError extends Error {
  constructor(message: string, readonly status: number, readonly code?: 'stale' | 'template_changed') { super(message) }
}
export interface UpsertAnamnesisInput {
  patientId: string
  templateVersion: number
  responses: FormResponses
  expectedUpdatedAt?: string
  expectNoRow?: boolean
  applyCurrentTemplate?: boolean
}
export interface UpsertAnamnesisResult {
  success: true
  data: { id: string; updatedAt: string; updatedBy: string | null; templateVersion: number; templateSnapshot: FormSection[] }
}
export function useUpsertAnamnesis(): UseMutationResult<UpsertAnamnesisResult, AnamnesisSaveError, UpsertAnamnesisInput>
export type SaveAnamnesisTemplateInput = { action: 'update'; sections: FormSection[] } | { action: 'reset' }
export function useSaveAnamnesisTemplate(): UseMutationResult<{ success: true; data: AnamnesisTemplate }, Error, SaveAnamnesisTemplateInput>
```

**Steps**

1. `fetchAnamnesis` / `fetchAnamnesisTemplate` are the query functions of the two hooks; the form (D1) also passes them to `queryClient.fetchQuery` when it reloads after a 409.
2. `useUpsertAnamnesis` sends `{ templateVersion, responses, expectedUpdatedAt, expectNoRow, applyCurrentTemplate }`, throws `AnamnesisSaveError(json.error, res.status, json.code)` on non-2xx, and keeps invalidating `queryKeys.anamnesis(patientId)` on success.
3. `useSaveAnamnesisTemplate` posts to `/api/anamnesis/template` and returns `queryClient.invalidateQueries({ queryKey: queryKeys.anamnesisTemplate })` from `onSuccess`, so `mutateAsync` resolves after the refetch (same as `useSaveEvaluationTemplate`).
4. Export `useAnamnesisTemplate` from `hooks/queries/index.ts`.
5. No new test: thin fetch wrappers; the form test (D1) and the settings test (D2) mock them at their boundary, and the refetch-ordering pattern is owned by `use-evaluation-mutations.test.ts`.

### Task C3: Conversion script

**Files**
- Create: `web/src/db/migrations/manual/0033_convert_anamneses.ts`

**Interfaces**
- Consumes: B3 `convertLegacyAnamnesis`, `LegacyAnamnesisRow`, `DEFAULT_ANAMNESIS_TEMPLATE`.
- Produces: CLI `[--dry-run]`. Converts every `responses IS NULL` row. Exit 1 when rows remain unconverted.

**Steps**

1. Header with run commands:

```
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_convert_anamneses.ts --dry-run
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_convert_anamneses.ts
```

2. Body:

```ts
import { sql } from 'drizzle-orm'
import { db } from '../../client'
import { convertLegacyAnamnesis, type LegacyAnamnesisRow } from '../../../lib/anamnesis/convert-legacy'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '../../../lib/anamnesis/default-template'

const dryRun = process.argv.includes('--dry-run')

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : (((result as { rows?: T[] }).rows ?? []) as T[])
}

type Row = LegacyAnamnesisRow & { id: string; updated_at: string }

async function main() {
  const pending = rows<Row>(await db.execute(sql`
    select id, updated_at::text as updated_at, main_complaint, patient_goals, medical_history, medications,
           allergies, previous_surgeries, chronic_conditions, is_pregnant, is_breastfeeding, lifestyle,
           skincare_routine, previous_aesthetic_treatments
    from floraclin.anamneses where responses is null
  `))
  console.log(`${pending.length} row(s) to convert${dryRun ? ' (dry run)' : ''}`)
  if (dryRun) return

  const snapshot = JSON.stringify(DEFAULT_ANAMNESIS_TEMPLATE.sections)
  let converted = 0
  for (const row of pending) {
    const responses = JSON.stringify(convertLegacyAnamnesis(row))
    // updated_at stays untouched: it is the optimistic-lock token the open forms hold.
    const updated = rows<{ id: string }>(await db.execute(sql`
      update floraclin.anamneses
      set template_version = ${DEFAULT_ANAMNESIS_TEMPLATE.version},
          template_snapshot = ${snapshot}::jsonb,
          responses = ${responses}::jsonb
      where id = ${row.id} and responses is null and updated_at = ${row.updated_at}::timestamptz
      returning id
    `))
    converted += updated.length
  }

  const [{ remaining }] = rows<{ remaining: number }>(await db.execute(sql`
    select count(*)::int as remaining from floraclin.anamneses where responses is null
  `))
  console.log(`converted ${converted}; ${remaining} row(s) still unconverted`)
  if (remaining > 0) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0), (err) => { console.error(err); process.exit(1) })
```

Print counts only, never answers (patient health data).
3. No test (I/O wrapper; the mapper is tested in B3).

### Task C4: Demo seed

**Files**
- Modify: `web/scripts/demo-clinic/seed.ts`, `web/src/lib/demo-seed/clinical.ts` (doc comments only)

**Interfaces**
- Consumes: A2 columns; B3 `DEFAULT_ANAMNESIS_TEMPLATE`.

**Steps**

1. Each anamnesis row in `writeClinicalRecords` becomes:

```ts
{
  tenantId: DEMO_TENANT_ID,
  patientId: patient.id,
  templateVersion: DEFAULT_ANAMNESIS_TEMPLATE.version,
  templateSnapshot: DEFAULT_ANAMNESIS_TEMPLATE.sections,
  responses: {
    'anam-medical-history': { selected: [], other: demo.history },
    'anam-allergies': demo.allergies.map((substance) => ({ substance })),
    'anam-medications': demo.medications.map((name) => ({ name })),
  },
  updatedBy: ctx.practitionerId,
  createdAt: recordedAt,
  updatedAt: recordedAt,
}
```

Delete `medicalHistoryFor` and the comment about `@/validations/anamnesis`.
2. `clinical.ts`: update the comments that map the values onto `anamneses.allergies` / `anamneses.medications` to say they become `anam-allergies` / `anam-medications` list rows. `buildAnamnesis` is unchanged.

---

## Group D (depends on Group C; tasks parallel)

### Task D1: AnamnesisForm, public page and staff consumers

**Files**
- Modify: `web/src/components/anamnesis/anamnesis-form.tsx` (full rewrite), `web/src/components/anamnesis/public-anamnesis-page.tsx`, `web/src/app/a/[token]/page.tsx`, `web/src/components/patients/patient-anamnesis-tab.tsx`, `web/src/app/(platform)/pacientes/[id]/atendimento/atendimento-page-client.tsx`, `web/src/components/service-wizard/service-wizard.tsx`
- Delete: `web/src/components/anamnesis/anamnesis-section.tsx`
- Test: create `web/src/components/anamnesis/__tests__/anamnesis-form.test.tsx`

**Interfaces**
- Consumes: B1 `FormRenderer`; A1 `buildFormResponseSchema`, `carryResponses`; B3 types; C1 `getCurrentAnamnesisTemplate` (server page); C2 hooks, `fetchAnamnesis`, `fetchAnamnesisTemplate`, `AnamnesisSaveError`; `fast-deep-equal`.
- Produces:

```ts
export interface AnamnesisFormProps {
  patientId: string
  currentTemplate: AnamnesisTemplate
  record?: AnamnesisRecord | null
  updatedByName?: string
  wizardOverrides?: WizardOverrides
  readOnly?: boolean
  publicMode?: boolean
  onPublicSubmit?: (payload: { templateVersion: number; responses: FormResponses }) => Promise<void>
}
// public-anamnesis-page.tsx Props: { firstName; token; patientId; template: AnamnesisTemplate }
// ServiceWizardProps: anamnesis?: AnamnesisRecord | null; anamnesisTemplate: AnamnesisTemplate (new, required)
```

**Behaviors (the agent designs the state; keep one `{ version, sections }` template state, initialized from the record or, without one, from `currentTemplate`)**

1. Renders `FormRenderer` with the template state's sections and the responses (record's or `{}`). Header ("Anamnese", "Salvando...", "Salvo {formatDateTime}") unless `wizardOverrides.hideTitle`; footer as today (public "Enviar"/"Enviando..."; staff "Última atualização: ... por ..." and "Salvar").
2. Staff autosave: every edit marks dirty, calls `wizardOverrides.onUserEdit`, and schedules a save 1000 ms after the last edit. The dirty flag clears only if no edit happened during the save (today's dirty-epoch rule). `onDirtyChange` and `onAutoSaved` as today.
3. Saves are serialized: at most one PUT in flight. A save requested meanwhile (autosave, "Salvar", `triggerSave`, banner action) is queued; when the in-flight save settles, one queued save runs with the latest responses, template version and `expectedUpdatedAt`. Requests carry `templateVersion` from the template state, `expectNoRow: true` while no row is known to exist, and `expectedUpdatedAt` from the last confirmed save.
4. On success the form adopts `data.updatedAt` (lock token, "Última atualização"), `data.templateVersion` and `data.templateSnapshot` (template state), and from then on knows a row exists.
5. Banner (staff, not `readOnly`, row exists): shown when the template state's sections are not deep-equal (`fast-deep-equal`) to `currentTemplate.sections`. Text "O modelo de anamnese mudou. Usar o modelo atual?", hint "Respostas de perguntas removidas serão descartadas.", button "Usar modelo atual" (shows "Aplicando..." and is disabled while queued or in flight). The action queues a save with `applyCurrentTemplate: true`, `templateVersion: currentTemplate.version`, and `carryResponses(latest responses, currentTemplate.sections)`. Local state changes only after the server confirms: then the template state becomes the response's snapshot and version, and responses become `carryResponses(latest local responses, snapshot)` (which keeps edits typed while the request was in flight; if those differ from what was sent, mark dirty so the queued save sends them). On failure nothing local changes.
6. On a 409 (`AnamnesisSaveError.status === 409`, either code): drop the queued save, show the server message as a toast, refetch with `queryClient.fetchQuery({ queryKey: queryKeys.anamnesis(patientId), queryFn: () => fetchAnamnesis(patientId) })` and the template the same way, then reload: if a record exists, take its template, responses and `updatedAt` (local unsaved edits are discarded, as a page reload does today); if none exists, take the current template and `carryResponses(local responses, current.sections)`. Other errors: toast, stay dirty.
7. Wizard `triggerSave`: today's effect shape (reset marker on 0, skip duplicates); flush the debounce, run a save through the queue, report `onSaveComplete({ success: true })` or `{ success: false, error: 'Erro ao salvar anamnese', errorType: 'server' }` (Decision 18).
8. `readOnly`: renderer read-only, no banner, no autosave, no "Salvar"; `triggerSave` reports success without a request.
9. Public mode: no autosave, no banner. Submit validates with `buildFormResponseSchema(sections, { enforceRequired: true })`; on failure set `showErrors` and toast "Preencha os campos obrigatórios."; on success call `onPublicSubmit({ templateVersion, responses: parsed.data })`.
10. Clear the debounce timer on unmount (no flush, as today).

**Consumers**

11. `public-anamnesis-page.tsx`: accept `template`; `handleSubmit(payload)` PUTs `JSON.stringify(payload)`; render `<AnamnesisForm patientId={patientId} currentTemplate={template} publicMode onPublicSubmit={handleSubmit} />`.
12. `app/a/[token]/page.tsx`: after the token check, `const template = await getCurrentAnamnesisTemplate(tokenData.tenantId)` and pass it.
13. `patient-anamnesis-tab.tsx`: delete the `useMemo` mapping and `AnamnesisFormData`. Load `useAnamnesis(patientId)` and `useAnamnesisTemplate()`; loader while either loads; "Erro ao carregar a anamnese." if the template query errors; render `<AnamnesisForm patientId={patientId} record={record ?? null} currentTemplate={template} />`.
14. `atendimento-page-client.tsx`: delete the transform block and `AnamnesisFormData`. Add `useAnamnesisTemplate()` to the loading gate; after the `tenant` check, `if (!anamnesisTemplate) throw new Error('Erro ao carregar o modelo de anamnese')`; pass `anamnesis={anamnesis ?? null}` and `anamnesisTemplate`.
15. `service-wizard.tsx`: retype `anamnesis`, add `anamnesisTemplate`, drop `AnamnesisFormData`; render `<AnamnesisForm patientId={patient.id} record={anamnesis ?? null} currentTemplate={anamnesisTemplate} updatedByName={anamnesisUpdatedByName} wizardOverrides={getOverridesForStep(1)} readOnly={isReadOnlyAfterApproval} />` and remove the `pointer-events-none opacity-75` wrapper around it. The amber notice stays.

**Tests** (`anamnesis-form.test.tsx`; mock `@/hooks/mutations/use-anamnesis-mutations` with a `mutateAsync` spy and the real `AnamnesisSaveError`; render with `renderWithProviders`; fake timers with `shouldAdvanceTime`):

- staff mode renders the record's snapshot question, not the current template's (regression: old answers shown against new questions);
- the banner is hidden when the record snapshot equals the current sections with keys in another order, and shown when a question differs (regression: banner on every record after a no-op template save);
- two edits 1 s apart produce two saves, and the second sends `expectedUpdatedAt` equal to the first result's `data.updatedAt` (regression: Decision 17, 409 on every second autosave);
- a new patient's first save sends `expectNoRow: true`, the next one does not, and the form adopts `templateVersion` / `templateSnapshot` from the response (a later save sends the adopted version);
- with an autosave in flight (deferred promise), clicking "Usar modelo atual" sends no second request until the first resolves; then exactly one request with `applyCurrentTemplate: true` and the first result's `updatedAt`; resolving it hides the banner; no further request follows (regression: 409 loop);
- a rejected banner save (409 `template_changed`) leaves the old questions on screen and calls `fetchQuery` for the record and the template;
- `readOnly`: editing is impossible, no banner, and `triggerSave` reports success without calling `mutateAsync`;
- public mode: an empty required question blocks `onPublicSubmit` and shows "Campo obrigatório"; once filled, `onPublicSubmit` receives `{ templateVersion, responses }`;
- `triggerSave` reports `success: false` when the save rejects (Decision 18).

### Task D2: Settings "Anamnese" tab

**Files**
- Create: `web/src/components/settings/anamnesis-template-settings.tsx`
- Modify: `web/src/app/(platform)/configuracoes/settings-page-client.tsx`, `web/src/app/(platform)/configuracoes/__tests__/settings-page-client.test.tsx`
- Test: create `web/src/components/settings/__tests__/anamnesis-template-settings.test.tsx`

**Interfaces**
- Consumes: B1 `FormTemplateEditor`; A1 `BASE_QUESTION_TYPES`; C2 `useAnamnesisTemplate`, `useSaveAnamnesisTemplate`.
- Produces: settings tab key `'anamnese'`; `export function AnamnesisTemplateSettings(): JSX.Element`.

**Steps**

1. `anamnesis-template-settings.tsx`, one component, editor embedded:

```tsx
export function AnamnesisTemplateSettings() {
  const { data: template, isLoading, isError } = useAnamnesisTemplate()
  const saveTemplate = useSaveAnamnesisTemplate()
  const [draft, setDraft] = useState<FormSection[] | null>(null)

  if (isLoading) return <div className="py-12 text-center text-sm text-mid">Carregando...</div>
  if (isError || !template) return <div className="py-12 text-center text-sm text-mid">Erro ao carregar o modelo de anamnese.</div>

  async function handleSave(sections: FormSection[]) {
    try {
      await saveTemplate.mutateAsync({ action: 'update', sections })
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erro ao salvar template' }
    }
  }

  async function handleReset() {
    try {
      const result = await saveTemplate.mutateAsync({ action: 'reset' })
      return { success: true, sections: result.data.sections }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erro ao restaurar template' }
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-mid">
        {template.version === 0 ? 'Modelo padrão.' : `Versão ${template.version}.`} As alterações valem para novas anamneses.
        Anamneses já salvas mantêm o modelo com que foram respondidas.
      </p>
      <FormTemplateEditor
        sections={draft ?? template.sections}
        savedSections={template.sections}
        onSectionsChange={setDraft}
        allowedTypes={BASE_QUESTION_TYPES}
        onSave={handleSave}
        onResetToDefault={handleReset}
        emptyStateHint="Adicione seções e perguntas ou restaure o modelo padrão."
      />
    </div>
  )
}
```

2. `settings-page-client.tsx`: add `'anamnese'` to `TabKey`; insert `{ key: 'anamnese', label: 'Anamnese', icon: ClipboardListIcon }` after `procedimentos` in "Clínico" (owner-only via the default `TAB_ROLES` rule); render `{effectiveTab === 'anamnese' && <AnamnesisTemplateSettings />}`.
3. `settings-page-client.test.tsx`: add `vi.mock('@/components/settings/anamnesis-template-settings', () => ({ AnamnesisTemplateSettings: stub }))`. Existing assertions stay (the practitioner list is still perfil and documentos only).
4. New test (mock both hooks): editing a section title and clicking "Salvar" calls `mutateAsync({ action: 'update', sections })` with the edited sections; "Restaurar padrão" then "Confirmar" calls `mutateAsync({ action: 'reset' })` and the editor shows the returned sections (regression: reset response ignored, editor keeps stale sections).

### Task D3: Prontuário PDF, summary and report page

**Files**
- Modify: `web/src/db/queries/reports/prontuario.ts`, `web/src/components/reports/prontuario-pdf.tsx`, `web/src/app/(platform)/relatorios/prontuario/page.tsx`
- Test: modify `web/src/components/reports/__tests__/prontuario-pdf.test.tsx`, `web/src/db/queries/reports/__tests__/prontuario.test.ts`, `web/src/app/(platform)/relatorios/prontuario/__tests__/page.test.tsx`; run `web/src/app/api/reports/prontuario/__tests__/route.test.ts` unchanged

**Interfaces**
- Consumes: C1 `getAnamnesis(): Promise<AnamnesisRecord | null>`; A1 `isQuestionAnswered`; B1 `ListAnswerTable`; B3 `AnamnesisRecord`.
- Produces: `ProntuarioDossier.anamnesis: AnamnesisRecord | null`; `ProntuarioSummary.anamnesis: { updatedAt: Date } | null`.

**Steps**

1. `prontuario.ts`: delete the local `AnamnesisRecord` alias and its comment; import `AnamnesisRecord` from `@/lib/anamnesis/types`. `toProntuarioSummary`: `anamnesis: anamnesis ? { updatedAt: new Date(anamnesis.updatedAt) } : null`.
2. `prontuario-pdf.tsx`: delete `MEDICAL_HISTORY_LABELS` and `AnamnesisFormData`. Add a module-private `formatAnswerText(question, value): string` (radio/text the string; checkbox `join(', ')`; scale `` `${value} / ${question.scaleMax}` `` or the number alone without `scaleMax`; checkbox_with_other `[...selected, other].filter(Boolean).join(', ')`; radio_with_other `other || selected`). New `AnamnesisSection`:

```tsx
function AnamnesisSection({ anamnesis }: { anamnesis: ProntuarioDossier['anamnesis'] }) {
  if (!anamnesis) return <div className="prontuario-empty">Anamnese não preenchida.</div>
  const blocks = [...anamnesis.templateSnapshot]
    .sort((a, b) => a.order - b.order)
    .flatMap((section) => {
      const answered = [...section.questions]
        .sort((a, b) => a.order - b.order)
        .filter((q) => isQuestionAnswered(q, anamnesis.responses[q.id]))
      if (answered.length === 0) return []
      return [
        <div key={section.id}>
          <h3 className="prontuario-subsection-title">{section.title}</h3>
          {answered.map((q) =>
            q.type === 'list' ? (
              <div key={q.id}>
                <strong>{q.label}</strong>
                <ListAnswerTable question={q} rows={anamnesis.responses[q.id] as FormListResponse} className="prontuario-table" />
              </div>
            ) : (
              <div key={q.id}><strong>{q.label}:</strong> {formatAnswerText(q, anamnesis.responses[q.id])}</div>
            ),
          )}
        </div>,
      ]
    })
  if (blocks.length === 0) return <div className="prontuario-empty">Anamnese sem respostas registradas.</div>
  return <div>{blocks}</div>
}
```

3. Report page: the Anamnese card shows `Preenchida em ${formatDate(data.anamnesis.updatedAt)}` or "Não preenchida."; its local `ProntuarioSummary` type gets `anamnesis: { updatedAt: string } | null`.
4. Tests:
   - PDF: replace the legacy fixture with an `AnamnesisRecord` (snapshot with a text question, a two-column list, a checkbox_with_other, a scale with `scaleMax: 10`, an unanswered question, and a section with no answers). Assert "label: answer" for text; a table with the list's column headers and cells; the checkbox answer as a comma list including "other"; "7 / 10"; the unanswered question's label and the empty section's title are absent (regression: clutter in the legal record). Keep the "Anamnese não preenchida." case.
   - `prontuario.test.ts`: the summary maps the record to `{ updatedAt }`.
   - Report page test: fixture `anamnesis: { updatedAt: '2026-04-10T15:00:00.000Z' }` shows "Preenchida em 10/04/2026"; the null case still shows "Não preenchida.".

---

## Group E (depends on Group D)

### Task E1: Remove legacy anamnesis columns from Drizzle and dead modules

**Files**
- Modify: `web/src/db/schema.ts`
- Delete: `web/src/validations/anamnesis.ts`, `web/src/validations/__tests__/anamnesis.test.ts`

**Steps**

1. Remove from `anamneses`: `mainComplaint`, `patientGoals`, `medicalHistory`, `medications`, `allergies`, `previousSurgeries`, `chronicConditions`, `isPregnant`, `isBreastfeeding`, `lifestyle`, `skinType`, `skinConditions`, `skincareRoutine`, `previousAestheticTreatments`, `contraindications`, `facialEvaluationNotes`. The DB columns and the trigger stay until 0034; inserts rely on the column defaults.
2. Delete `validations/anamnesis.ts` and its test.
3. Sweep: `grep -rn "validations/anamnesis\|AnamnesisFormData\|mainComplaint\|isPregnant\|medicalHistory\b" web/src web/scripts` returns nothing outside `src/lib/anamnesis/convert-legacy.ts` (snake_case raw-SQL fields) and `src/db/migrations/`. `grep -rn "components/evaluation/question-renderers\|components/evaluation/section-editor\|components/evaluation/question-editor-dialog\|evaluation-utils" web/src` returns nothing.
4. Run the full checks.

---

## Verification after each group

Run from the repo root.

- **After Group A:** `pnpm --filter @floraclin/web exec tsc --noEmit` (green); `pnpm --filter @floraclin/web exec vitest run src/lib/forms`.
- **After Group B:** `pnpm --filter @floraclin/web exec tsc --noEmit` (green); `pnpm --filter @floraclin/web exec vitest run src/lib/forms src/lib/anamnesis src/components/forms src/components/evaluation src/lib/validations src/components/procedures src/hooks/mutations src/app/api/evaluation src/lib/default-evaluation-templates "src/app/(platform)/configuracoes/avaliacao"`.
- **After Group C:** `pnpm --filter @floraclin/web exec vitest run src/db/queries/__tests__/anamnesis-tenant-scope.test.ts src/db/queries/__tests__/anamnesis-templates.test.ts src/app/api/anamnesis src/app/api/__tests__/write-access-coverage.test.ts src/lib/demo-seed`; `pnpm --filter @floraclin/web exec tsc --noEmit` has errors only in Group D files (`components/anamnesis/*`, `patient-anamnesis-tab.tsx`, `atendimento-page-client.tsx`, `service-wizard.tsx`, `app/a/[token]/page.tsx`, prontuário files). Any other error blocks Group D.
- **After Group D:** `pnpm --filter @floraclin/web exec tsc --noEmit` (green); `pnpm --filter @floraclin/web exec vitest run src/components/anamnesis src/components/settings "src/app/(platform)/configuracoes" src/components/reports src/db/queries/reports "src/app/(platform)/relatorios" src/app/api/reports`.
- **After Group E:** `pnpm --filter @floraclin/web exec tsc --noEmit`; `pnpm ci:checks`.
- **Local rehearsal (local Docker Postgres, never Supabase), before merge:** apply 0033; run the conversion; update one row's `allergies` with old-style SQL and confirm the trigger nulled `responses`; run the conversion again and confirm 0 remaining; then in the browser: edit the template in Configurações > Anamnese, save twice (version 1, then 2), save again without changes (version stays 2), restore default; open a converted patient, accept the banner, confirm dropped answers; type in two fields with a pause (no 409); fill the public link with a required question empty, then filled; download the prontuário PDF.

## Rollout (human steps)

Low traffic window (night). Rollback is forward-fix only: once new code has saved anamneses, those answers exist only in the new columns.

0. Before merge: run `0033_check_evaluation_templates.ts` against production. If any stored evaluation template fails `formSectionsSchema`, fix that data first (those clinics could not save their ficha after the deploy).
1. Apply migration 0033 by hand: adds `template_version`, `template_snapshot`, `responses` (nullable) to `anamneses`, creates `anamnesis_templates` with RLS, and installs the `anamneses_invalidate_converted` trigger. Old code keeps working.
2. Run `0033_convert_anamneses.ts` (all `responses IS NULL` rows).
3. Merge and deploy.
4. Right after production is live, run `0033_convert_anamneses.ts` again. It converts rows that old code inserted or edited during the deploy (the trigger nulled their `responses`). Until this run finishes, such rows show the default empty form, and a staff save on one of them replaces its unconverted legacy answers; the window is minutes.
5. Later PR, after a day of checks: run the conversion once more and confirm it reports 0 rows still unconverted. Before migration 0034, count the rows that hold legacy fields the conversion does not map (the form wrote them before 2026-06-03): `SELECT count(*) FROM floraclin.anamneses WHERE coalesce(skin_type, '') <> '' OR coalesce(skin_conditions, '[]'::jsonb) <> '[]'::jsonb OR coalesce(contraindications, '[]'::jsonb) <> '[]'::jsonb OR coalesce(facial_evaluation_notes, '') <> ''`. If the count is not 0, map those fields into `responses` or explicitly accept their loss before dropping the columns. Then migration 0034 drops the trigger and its function, drops the 16 legacy columns, and sets the three new columns NOT NULL. The same PR removes the null coalesce in `getAnamnesis` and can delete `0033_convert_anamneses.ts`, `0033_check_evaluation_templates.ts` and `lib/anamnesis/convert-legacy.ts` with its test.
