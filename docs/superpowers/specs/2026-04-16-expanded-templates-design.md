# Expanded Default Evaluation & Consent Templates — Design

## Goal

Upgrade FloraClin's built-in clinical content to match a set of rigorously-drafted v2 forms shared by the product owner:

1. **5 evaluation templates** rewritten from thin placeholders to PDF-grade clinical questionnaires (Bioestimulador de Colágeno, Skinbooster, Lipo de Papada/Enzima, Limpeza de Pele, Microagulhamento).
2. **4 new consent (TCLE) types** added (Limpeza de Pele, Lipo de Papada/Enzima, Skinbooster, Microagulhamento) plus the existing `biostimulator` TCLE rewritten to match the legally-aligned PDF version.
3. **Onboarding seed** extended so fresh tenants pick up the new consent types automatically.

This is content + enum + migration work. Zero new UI, zero new question types, zero API surface change.

## Source materials

Three PDFs in `/Users/giorgiofellipe/Downloads/`:

- `floraclin-fichas-avaliacao-v2.pdf` — 4 evaluation forms (Limpeza de Pele, Bioestimulador, Lipo de Papada, Skinbooster)
- `floraclin-microagulhamento-avaliacao-tci.pdf` — Microagulhamento evaluation + TCLE
- `floraclin-tci-4procedimentos.pdf` — 4 TCLE templates (Limpeza, Bioestimulador, Lipo de Papada, Skinbooster)

Agents implementing this work **must read the relevant PDF pages directly** to transcribe section/question wording faithfully. Clinical Portuguese phrasing is deliberate and must not be paraphrased.

## Current state

**`web/src/lib/default-evaluation-templates.ts`** (1653 lines) exports `defaultTemplates` with 8 category entries. All 5 categories in scope already have thin placeholder templates (~4–6 sections, ~10–15 questions each). Code is seeded to tenants per-procedure-type on first onboarding only.

**`web/src/validations/consent.ts`** exports:
- `consentTypes` = `['general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract']`
- `DEFAULT_CONSENT_TEMPLATES` record keyed by type

**`web/src/app/api/onboarding/route.ts:157`** hardcodes which 5 consent types to seed on tenant onboarding.

**`web/src/db/schema.ts:292`** comment notes the `consent_templates.type` column has a CHECK constraint in the migration enforcing the 5-value enum.

**Restore paths already exist:**
- Evaluation: `POST /api/evaluation/templates { action: 'reset' }` supports both overwriting existing and `createIfMissing`. Existing tenants click "Restaurar padrão" per template to pull in the new content after upgrade.
- Consent: `consent-template-form.tsx:63` pre-fills content from `DEFAULT_CONSENT_TEMPLATES` when the user picks a type in the new-template dropdown. Adding types to the enum + label map + defaults record makes them available.

**No data migration** for existing tenants — they opt in via these UI flows.

## Scope decisions (already resolved during brainstorming)

1. **Replace, don't duplicate.** For the 5 overlapping evaluation templates, overwrite the existing section arrays. Not adding "Completa" variants.
2. **Skip photo-registry and signature sections from PDFs.** Patient photos are captured in the Timeline tab; signatures are on the consent form. No new `photo_slot` or `signature` question types.
3. **Drop field placeholders from TCLE content** (CPF / data de nascimento / data do procedimento / "Assinar acima"). They're physical-paper artifacts the digital flow handles elsewhere.
4. **No backfill for existing tenants.** Owners click restore if they want the new content.

## Architecture

### Files changed

1. **`web/src/lib/default-evaluation-templates.ts`** — rewrite 5 const blocks:
   - `limpezaPeleSections` ← Ficha 01 (10 sections in PDF → ~8 sections digital after skipping photo/signature/protocol professional-only)
   - `bioestimuladorSections` ← Ficha 02 (7 sections PDF → ~7 digital)
   - `enzimaSections` ← Ficha 03 Lipo de Papada (8 sections PDF → ~7 digital)
   - `skinboosterSections` ← Ficha 04 (8 sections PDF → ~7 digital)
   - `microagulhamentoSections` ← Microagulhamento eval (10 sections PDF → ~8 digital)

   **Parallelization note:** this file becomes a merge-conflict magnet if 5 agents edit it in parallel. Split into a folder:
   ```
   web/src/lib/default-evaluation-templates/
     index.ts              (re-exports defaultTemplates + DefaultTemplateDefinition type)
     types.ts              (EvaluationSection, EvaluationQuestion, DefaultTemplateDefinition)
     toxina-botulinica.ts  (existing content, moved)
     preenchimentos.ts     (existing content, moved)
     bioestimulador.ts     (new PDF content)
     skinbooster.ts        (new PDF content)
     enzima.ts             (new PDF content)
     limpeza-pele.ts       (new PDF content)
     skincare.ts           (existing content, moved)
     microagulhamento.ts   (new PDF content)
   ```
   Barrel `index.ts` preserves the existing `import { defaultTemplates } from '@/lib/default-evaluation-templates'` contract — all 3 call sites (`onboarding/route.ts:124`, `api/evaluation/templates/route.ts:51`, `db/queries/evaluation-templates.ts:117`) keep working without change.

2. **`web/src/validations/consent.ts`**:
   - Extend `consentTypes` enum with `'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento'`
   - Rewrite `DEFAULT_CONSENT_TEMPLATES.biostimulator` with TCI-02 content from `floraclin-tci-4procedimentos.pdf` pages 4–6
   - Add 4 new keyed entries: `limpeza_pele`, `enzima`, `skinbooster`, `microagulhamento` with content from the respective TCI pages + microagulhamento PDF

3. **`web/src/lib/constants.ts`** — extend `CONSENT_TYPE_LABELS`:
   ```ts
   limpeza_pele: 'Limpeza de Pele',
   enzima: 'Enzima Lipolítica',
   skinbooster: 'Skinbooster',
   microagulhamento: 'Microagulhamento',
   ```

4. **`web/src/app/api/onboarding/route.ts:157`** — append the 4 new types to the seed list:
   ```ts
   const consentTypes = [
     'general', 'botox', 'filler', 'biostimulator',
     'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento',
     'service_contract',
   ] as const
   ```

5. **Drizzle migration** `web/src/db/migrations/<timestamp>_expand_consent_types.sql`:
   - `ALTER TABLE floraclin.consent_templates DROP CONSTRAINT <existing_check_name>`
   - `ADD CONSTRAINT <new_name> CHECK (type IN ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract', 'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento'))`
   - Agent must inspect `web/src/db/migrations/` to find the constraint name (likely from an earlier migration) before dropping.

6. **`web/src/db/schema.ts:292`** — update the inline comment next to the `type: varchar('type', { length: 30 })` line to list the full set of allowed values so the schema file stays accurate.

### Content fidelity rules (evaluations)

- **Info banners** (yellow `⚠ ATENÇÃO REDOBRADA` boxes in PDF) → attach as `warningText` on the first question of that section.
- **Active-ingredient tables** (PDF has `Ativo | Em uso | Suspenso há quantos dias | Observação`) → flatten to a `checkbox` question listing ativos in use + a separate `text` question for "Se em uso, descreva quando parou cada ativo". Loss of tabular fidelity is accepted.
- **Professional-only sections** (e.g. "Protocolo clínico planejado") → regular questions at the end of the template. No `assignee` distinction exists in the schema.
- **Photo registry sections** → drop entirely.
- **Signature + date blocks** → drop entirely.
- **Multi-question rows** (PDF 2-col grids) → linearize into sequential questions.
- **Exact Portuguese wording preserved**, including references to CDC / LGPD / ANVISA, drug names, and dose tables.
- **Question types available**: `radio`, `checkbox`, `scale`, `text`, `checkbox_with_other`, `radio_with_other`, `face_diagram`. Use `radio_with_other` when the PDF has a radio followed by an inline "Outro: _____" line.

### Content fidelity rules (consents)

- **Preamble + cláusula structure preserved** as plain text in the `content` field.
- **Cláusulas numbered inline** as `Cláusula N — TÍTULO`, body paragraphs follow.
- **Warning callouts** inline as `⚠ ATENÇÃO — ...` lines where the PDF has them.
- **Final declaração block** kept verbatim (the "Eu, ___, declaro que li..." paragraph plus the "Autorizo livremente a realização do procedimento de X" confirmation).
- **Dropped artifacts**:
  - Physical field placeholders for CPF / data de nascimento / data do procedimento
  - "Assinar acima" label and signature lines
  - `[ ] Autorizo / [ ] Não autorizo` image-use checkbox (handled elsewhere in flow)
  - Footer banding / FloraClin wordmark / `TCI · Procedimento` subtitles
- **Language**: verbatim Portuguese from PDFs, including legal citations (`art. 6º, III do CDC (Lei nº 8.078/1990)`, `LGPD — Lei nº 13.709/2018`, `art. 14 §4º do CDC`, `art. 951 do Código Civil`).

## Non-goals

- No new question types.
- No new UI for editing templates.
- No data migration for existing tenants.
- No changes to the evaluation renderer or consent viewer components.
- No changes to the `PROCEDURE_CATEGORIES` enum — it already contains the needed categories.
- No changes to `web/src/validations/consent.ts` `consentTemplateSchema` shape — only the enum values grow.
- Not touching the other 3 existing evaluation templates (toxina_botulinica, preenchimentos, skincare). They stay as-is.
- Not touching the `general`, `botox`, `filler`, `service_contract` consent templates.

## Risks & mitigations

- **File-merge conflict risk** in `default-evaluation-templates.ts` when 5 parallel agents rewrite sections — **mitigated** by splitting into a folder + barrel (each agent owns one file).
- **CHECK constraint name lookup** — agent must inspect existing migrations to find the name rather than assuming. Drizzle auto-names can vary.
- **Existing tenant templates remain stale** — explicitly scoped out; documented as "click restore" path.
- **IDs of existing questions not preserved** — a rewrite necessarily changes question IDs. Any tenants who already completed evaluations with old question IDs keep their stored answers, but answers will not render under the new template structure. Acceptable because the upgrade is opt-in per tenant.

## Testing

Content is data, not logic — no new unit tests. Verification:

1. `pnpm ci:checks` (lint + typecheck + tests) must stay green.
2. Manual smoke (performed by operator after implementation, not in CI): fresh tenant onboarding creates the new consent types; "Restaurar padrão" on an evaluation template loads the upgraded sections.

## Acceptance criteria

- [ ] `defaultTemplates` export still resolves from `@/lib/default-evaluation-templates` with the same 8-entry shape.
- [ ] `bioestimulador`, `skinbooster`, `enzima`, `limpeza_pele`, `microagulhamento` sections reflect the corresponding PDF content per the fidelity rules above.
- [ ] `consentTypes` includes 10 values (6 existing + 4 new).
- [ ] `DEFAULT_CONSENT_TEMPLATES` has entries for the 4 new types and an updated `biostimulator`.
- [ ] `CONSENT_TYPE_LABELS` has PT-BR labels for the 4 new types.
- [ ] Onboarding seed list includes the 4 new types.
- [ ] Drizzle migration drops + re-adds the `consent_templates.type` CHECK constraint with the full 10-value set.
- [ ] `schema.ts:292` comment lists all 10 allowed values.
- [ ] `pnpm ci:checks` green.
