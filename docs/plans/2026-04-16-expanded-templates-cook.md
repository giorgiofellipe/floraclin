# Expanded Default Evaluation & Consent Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Cook parallelization:** tasks are grouped below. Agents in the same group are dispatched in parallel and must not touch the same files. Groups run sequentially.

**Goal:** Replace 5 thin evaluation templates with PDF-grade clinical versions, add 4 new TCLE consent types, and wire them into the onboarding seed + DB CHECK constraint.

**Architecture:** Content + enum + one manual SQL migration. Evaluation templates are split from one 1653-line file into a folder with one file per category so 5 agents can rewrite in parallel without merge conflicts. Consent templates, onboarding seed, labels, migration, and schema comment each touch a separate file — all independent. Zero new UI, zero new question types, zero API surface change.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Next.js 16 App Router, pnpm workspace (`@floraclin/web`).

**Source PDFs** (agents read directly — do not paraphrase):
- `/Users/giorgiofellipe/Downloads/floraclin-fichas-avaliacao-v2.pdf` — Limpeza de Pele (pp.1–4), Bioestimulador (pp.5–7), Lipo de Papada (pp.8–10), Skinbooster (pp.11–13)
- `/Users/giorgiofellipe/Downloads/floraclin-microagulhamento-avaliacao-tci.pdf` — Microagulhamento eval (pp.1–6), Microagulhamento TCLE (pp.7–9)
- `/Users/giorgiofellipe/Downloads/floraclin-tci-4procedimentos.pdf` — TCI-01 Limpeza de Pele (pp.1–3), TCI-02 Bioestimulador (pp.4–6), TCI-03 Lipo de Papada (pp.7–9), TCI-04 Skinbooster (pp.10)

**Spec:** `docs/superpowers/specs/2026-04-16-expanded-templates-design.md` — read the "Content fidelity rules" sections before writing content.

**Types reference** (`web/src/types/evaluation.ts`):

```ts
export type EvaluationQuestionType =
  | 'radio' | 'checkbox' | 'scale' | 'text'
  | 'checkbox_with_other' | 'radio_with_other' | 'face_diagram'

export interface EvaluationQuestion {
  id: string
  label: string
  type: EvaluationQuestionType
  required: boolean
  order: number
  options?: string[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  helpText?: string
  warningText?: string
}

export interface EvaluationSection {
  id: string
  title: string
  order: number
  questions: EvaluationQuestion[]
}

export interface DefaultTemplateDefinition {
  name: string
  category: ProcedureCategory   // 'botox' | 'filler' | 'biostimulator' | 'skinbooster' | 'enzima' | 'limpeza_pele' | 'skincare' | 'microagulhamento'
  sections: EvaluationSection[]
}
```

---

## Group 0 — Prerequisite: split evaluation templates file

**Runs alone first.** All Group 1+ evaluation tasks depend on this. One agent, sequential.

### Task 0.1: Split `default-evaluation-templates.ts` into folder

**Files:**
- Delete: `web/src/lib/default-evaluation-templates.ts`
- Create: `web/src/lib/default-evaluation-templates/index.ts`
- Create: `web/src/lib/default-evaluation-templates/toxina-botulinica.ts`
- Create: `web/src/lib/default-evaluation-templates/preenchimentos.ts`
- Create: `web/src/lib/default-evaluation-templates/bioestimulador.ts`
- Create: `web/src/lib/default-evaluation-templates/skinbooster.ts`
- Create: `web/src/lib/default-evaluation-templates/enzima.ts`
- Create: `web/src/lib/default-evaluation-templates/limpeza-pele.ts`
- Create: `web/src/lib/default-evaluation-templates/skincare.ts`
- Create: `web/src/lib/default-evaluation-templates/microagulhamento.ts`

**Callers to preserve** (all import `{ defaultTemplates } from '@/lib/default-evaluation-templates'` — barrel must keep that export working):
- `web/src/app/api/onboarding/route.ts:124`
- `web/src/app/api/evaluation/templates/route.ts:51`
- `web/src/db/queries/evaluation-templates.ts:117`

- [ ] **Step 1: Read the original file and extract section arrays**

```bash
cat web/src/lib/default-evaluation-templates.ts
```

Identify these 8 `const <name>Sections: EvaluationSection[] = [...]` blocks:
- `toxinaBotulínicaSections` (starts line ~5)
- `preenchimentosSections` (starts line ~222)
- `bioestimuladorSections` (starts line ~394)
- `skinboosterSections` (starts line ~564)
- `enzimaSections` (starts line ~733)
- `limpezaPeleSections` (starts line ~907)
- `skincareSections` (starts line ~1073)
- `microagulhamentoSections` (starts line ~1424)

And the `defaultTemplates` export (starts line ~1612).

- [ ] **Step 2: Create `web/src/lib/default-evaluation-templates/toxina-botulinica.ts`**

Move the existing `toxinaBotulínicaSections` array verbatim. Rename the export and the identifier (remove the accented name):

```ts
import type { EvaluationSection } from '@/types/evaluation'

export const toxinaBotulinicaSections: EvaluationSection[] = [
  // ... paste existing array body from original lines 5-221 ...
]
```

- [ ] **Step 3: Create the other 4 unchanged-content files** (`preenchimentos.ts`, `skincare.ts`)

For each, the file shape is identical to step 2:

```ts
// web/src/lib/default-evaluation-templates/preenchimentos.ts
import type { EvaluationSection } from '@/types/evaluation'
export const preenchimentosSections: EvaluationSection[] = [
  // ... existing content from original lines 222-393 ...
]
```

```ts
// web/src/lib/default-evaluation-templates/skincare.ts
import type { EvaluationSection } from '@/types/evaluation'
export const skincareSections: EvaluationSection[] = [
  // ... existing content from original lines 1073-1423 ...
]
```

- [ ] **Step 4: Create the 5 files-to-be-rewritten as stubs with existing content**

Agents in Group 1 will rewrite these. For now, **preserve existing content** so the build stays green after this task:

```ts
// web/src/lib/default-evaluation-templates/bioestimulador.ts
import type { EvaluationSection } from '@/types/evaluation'
export const bioestimuladorSections: EvaluationSection[] = [
  // ... existing content from original lines 394-563 ...
]
```

Repeat for `skinbooster.ts` (lines 564–732), `enzima.ts` (lines 733–906), `limpeza-pele.ts` (lines 907–1072), `microagulhamento.ts` (lines 1424–1611).

- [ ] **Step 5: Create the barrel `web/src/lib/default-evaluation-templates/index.ts`**

```ts
import type { DefaultTemplateDefinition } from '@/types/evaluation'
import { toxinaBotulinicaSections } from './toxina-botulinica'
import { preenchimentosSections } from './preenchimentos'
import { bioestimuladorSections } from './bioestimulador'
import { skinboosterSections } from './skinbooster'
import { enzimaSections } from './enzima'
import { limpezaPeleSections } from './limpeza-pele'
import { skincareSections } from './skincare'
import { microagulhamentoSections } from './microagulhamento'

export const defaultTemplates: DefaultTemplateDefinition[] = [
  { name: 'Toxina Botulínica', category: 'botox', sections: toxinaBotulinicaSections },
  { name: 'Preenchimentos', category: 'filler', sections: preenchimentosSections },
  { name: 'Bioestimulador de Colágeno', category: 'biostimulator', sections: bioestimuladorSections },
  { name: 'Skinbooster', category: 'skinbooster', sections: skinboosterSections },
  { name: 'Enzima para Gordura', category: 'enzima', sections: enzimaSections },
  { name: 'Limpeza de Pele', category: 'limpeza_pele', sections: limpezaPeleSections },
  { name: 'Skincare Personalizado', category: 'skincare', sections: skincareSections },
  { name: 'Microagulhamento', category: 'microagulhamento', sections: microagulhamentoSections },
]
```

- [ ] **Step 6: Delete the original file**

```bash
rm web/src/lib/default-evaluation-templates.ts
```

- [ ] **Step 7: Run typecheck to verify the split**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS. TypeScript resolves `@/lib/default-evaluation-templates` to the new folder's `index.ts` by default.

- [ ] **Step 8: Run lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 9: Run tests**

```bash
pnpm --filter @floraclin/web test:run
```

Expected: PASS. Nothing about behavior changed.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/default-evaluation-templates
git rm web/src/lib/default-evaluation-templates.ts
git commit -m "refactor: split default-evaluation-templates into folder per category"
```

---

## Group 1 — Content rewrites (9 tasks in parallel)

**Every task in this group touches a different file.** All 9 can be dispatched simultaneously after Group 0 completes. Each task ends with its own commit.

### Task 1.1: Rewrite Bioestimulador evaluation template

**Files:**
- Modify: `web/src/lib/default-evaluation-templates/bioestimulador.ts`

**Source:** `floraclin-fichas-avaliacao-v2.pdf` pages 5–7 (Ficha 02 — BIOESTIMULADOR DE COLÁGENO).

**Content fidelity rules** (repeat from spec, applies to all Group 1 evaluation tasks):
- Info banners (⚠ ATENÇÃO boxes) → `warningText` on the first question of that section.
- Active-ingredient tables → flatten to one `checkbox` (ativos em uso) + one `text` (observações/quando parou).
- Photo registry sections → drop entirely.
- Signature + date blocks at end → drop entirely.
- Multi-column row layouts → linearize into sequential questions.
- Portuguese wording preserved verbatim (ANVISA, CDC, LGPD, drug names).
- Radio with inline "Outro: ___" line → use `radio_with_other` (options include the "Outro:" label).
- Checkbox with inline "Outro: ___" → `checkbox_with_other`.

- [ ] **Step 1: Read the source pages**

```bash
# Open the PDF and read pages 5-7 — the BIOESTIMULADOR DE COLÁGENO form
```

Use the Read tool with `pages: "5-7"` on the PDF path.

- [ ] **Step 2: Read the existing file for reference (not to keep its content)**

```bash
cat web/src/lib/default-evaluation-templates/bioestimulador.ts
```

The existing arrays show the shape and how `warningText`, `helpText`, and option lists are structured. Use them as a template — not as content to preserve.

- [ ] **Step 3: Rewrite the file**

Overwrite `web/src/lib/default-evaluation-templates/bioestimulador.ts` with sections mapping 1:1 to the PDF's numbered sections (skip photo registry). Target ~7 sections, ~30–40 questions.

Use id prefix `bio-s<N>-q<M>` (e.g., `bio-s1-q1`). Each question must have `id`, `label`, `type`, `required`, `order`; optional `options`, `scaleMin/Max/Labels`, `helpText`, `warningText`.

Shape example (one section — reproduce this pattern for all sections, based on PDF content):

```ts
import type { EvaluationSection } from '@/types/evaluation'

export const bioestimuladorSections: EvaluationSection[] = [
  {
    id: 'bio-s1',
    title: 'Queixa Principal e Motivação',
    order: 1,
    questions: [
      {
        id: 'bio-s1-q1',
        label: 'O que motivou a busca pelo bioestimulador? (marque todas que se aplicam)',
        type: 'checkbox',
        required: true,
        order: 1,
        options: [
          // transcribe exact options from PDF
        ],
      },
      {
        id: 'bio-s1-q2',
        label: 'Grau de flacidez percebido pelo paciente',
        type: 'scale',
        required: true,
        order: 2,
        scaleMin: 1,
        scaleMax: 5,
        scaleMinLabel: 'Pouco perceptível',
        scaleMaxLabel: 'Muito perceptível',
      },
      // ... additional questions from PDF Section 1 ...
    ],
  },
  // ... additional sections mapping to PDF ...
]
```

- [ ] **Step 4: Verify no other categories' identifiers leak in**

```bash
grep -E "'(lp-|sb-|enz-|micro-|skin-|botox-|filler-)s[0-9]" web/src/lib/default-evaluation-templates/bioestimulador.ts
```

Expected: empty output. All IDs in this file must start with `bio-`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/default-evaluation-templates/bioestimulador.ts
git commit -m "feat(templates): rewrite bioestimulador evaluation with PDF v2 content"
```

---

### Task 1.2: Rewrite Skinbooster evaluation template

**Files:**
- Modify: `web/src/lib/default-evaluation-templates/skinbooster.ts`

**Source:** `floraclin-fichas-avaliacao-v2.pdf` pages 11–13 (Ficha 04 — SKINBOOSTER).

**Fidelity rules:** see Task 1.1 Step 3 preamble.

- [ ] **Step 1: Read the source pages** via Read tool with `pages: "11-13"` on `floraclin-fichas-avaliacao-v2.pdf`.

- [ ] **Step 2: Read existing file for shape reference**

```bash
cat web/src/lib/default-evaluation-templates/skinbooster.ts
```

- [ ] **Step 3: Rewrite the file**

Overwrite `web/src/lib/default-evaluation-templates/skinbooster.ts`. Use id prefix `skb-s<N>-q<M>`. Target ~7 sections mapping to the PDF's "Queixa / Área / Rotina / Hábitos / Fatores hormonais / Contraindicações / Protocolo" structure (photo registry dropped). Shape same as Task 1.1 Step 3.

- [ ] **Step 4: ID prefix check**

```bash
grep -E "'(lp-|bio-|enz-|micro-|skin-|botox-|filler-)s[0-9]" web/src/lib/default-evaluation-templates/skinbooster.ts
```

Expected: empty. All IDs start with `skb-`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/default-evaluation-templates/skinbooster.ts
git commit -m "feat(templates): rewrite skinbooster evaluation with PDF v2 content"
```

---

### Task 1.3: Rewrite Enzima (Lipo de Papada) evaluation template

**Files:**
- Modify: `web/src/lib/default-evaluation-templates/enzima.ts`

**Source:** `floraclin-fichas-avaliacao-v2.pdf` pages 8–10 (Ficha 03 — LIPO DE PAPADA · ENZIMA LIPOLÍTICA SUBMENTONIANA).

**Fidelity rules:** see Task 1.1 Step 3 preamble. **Special note:** the PDF's "Triagem de contraindicações" section for this procedure has a strong warning banner ("⚠ ATENÇÃO REDOBRADA — Enzimas lipolíticas submentonianas exigem avaliação criteriosa...") — attach as `warningText` on the first question of that section, verbatim.

- [ ] **Step 1: Read the source pages** via Read tool with `pages: "8-10"` on `floraclin-fichas-avaliacao-v2.pdf`.

- [ ] **Step 2: Read existing file for shape reference**

```bash
cat web/src/lib/default-evaluation-templates/enzima.ts
```

- [ ] **Step 3: Rewrite the file**

Overwrite `web/src/lib/default-evaluation-templates/enzima.ts`. Use id prefix `enz-s<N>-q<M>`. Target ~7 sections mapping to the PDF's "Queixa e histórico / Avaliação clínica da região / Hábitos / Saúde sistêmica / Triagem / Expectativa / Protocolo" (photo registry dropped).

- [ ] **Step 4: ID prefix check**

```bash
grep -E "'(lp-|bio-|skb-|micro-|skin-|botox-|filler-)s[0-9]" web/src/lib/default-evaluation-templates/enzima.ts
```

Expected: empty. All IDs start with `enz-`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/default-evaluation-templates/enzima.ts
git commit -m "feat(templates): rewrite enzima/lipo de papada evaluation with PDF v2 content"
```

---

### Task 1.4: Rewrite Limpeza de Pele evaluation template

**Files:**
- Modify: `web/src/lib/default-evaluation-templates/limpeza-pele.ts`

**Source:** `floraclin-fichas-avaliacao-v2.pdf` pages 1–4 (Ficha 01 — LIMPEZA DE PELE).

**Fidelity rules:** see Task 1.1 Step 3 preamble. **Special note:** this PDF has the active-ingredient table (Retinol/Tretinoína/Ácidos/Vitamina C/Isotretinoína/Anticoagulantes/Anticoncepcional hormonal, with "em uso" checkboxes and "suspenso há quantos dias" column). Flatten per spec: one `checkbox` question listing all ativos with "em uso" semantics, plus one `text` question "Se em uso, descreva quando parou cada ativo e observações".

- [ ] **Step 1: Read the source pages** via Read tool with `pages: "1-4"` on `floraclin-fichas-avaliacao-v2.pdf`.

- [ ] **Step 2: Read existing file for shape reference**

```bash
cat web/src/lib/default-evaluation-templates/limpeza-pele.ts
```

- [ ] **Step 3: Rewrite the file**

Overwrite `web/src/lib/default-evaluation-templates/limpeza-pele.ts`. Use id prefix `lp-s<N>-q<M>`. Target ~8 sections: Tipo/comportamento da pele, Queixas principais, Histórico de limpezas, Medicamentos e ativos tópicos (with warning banner), Rotina de skincare, Hábitos de vida, Fatores hormonais, Triagem de contraindicações, Avaliação e protocolo (drop photo registry).

- [ ] **Step 4: ID prefix check**

```bash
grep -E "'(bio-|sb-|skb-|enz-|micro-|skin-|botox-|filler-)s[0-9]" web/src/lib/default-evaluation-templates/limpeza-pele.ts
```

Expected: empty. All IDs start with `lp-`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/default-evaluation-templates/limpeza-pele.ts
git commit -m "feat(templates): rewrite limpeza de pele evaluation with PDF v2 content"
```

---

### Task 1.5: Rewrite Microagulhamento evaluation template

**Files:**
- Modify: `web/src/lib/default-evaluation-templates/microagulhamento.ts`

**Source:** `floraclin-microagulhamento-avaliacao-tci.pdf` pages 1–6 (the evaluation form; the TCLE on pp.7–9 is handled separately in Task 1.6).

**Fidelity rules:** see Task 1.1 Step 3 preamble. **Special notes:**
- The PDF has a Fitzpatrick I–VI radio with a specific warning banner "⚠ FOTOTIPOS V E VI — ATENÇÃO REDOBRADA..." — attach verbatim as `warningText` on the fototipo question (not on the section's first question — on the fototipo question itself, since it's the triggering field).
- The active-ingredient table ("Preencha a tabela de ativos em uso" with Retinol, Tretinoína, Isotretinoína ORAL (CONTRAINDICA), Ácido glicólico, Ácido salicílico, Ácido mandélico/azelaico, Vitamina C concentrada (>15%), Anticoagulante oral, Corticóide sistêmico, Imunossupressores) → flatten same as limpeza-pele.
- The "SUSPENSÃO OBRIGATÓRIA ANTES DO PROCEDIMENTO" banner (specific days per ativo) must be preserved verbatim as `warningText` on the first question of the "Medicamentos e ativos tópicos em uso" section.

- [ ] **Step 1: Read the source pages** via Read tool with `pages: "1-6"` on `floraclin-microagulhamento-avaliacao-tci.pdf`.

- [ ] **Step 2: Read existing file for shape reference**

```bash
cat web/src/lib/default-evaluation-templates/microagulhamento.ts
```

- [ ] **Step 3: Rewrite the file**

Overwrite `web/src/lib/default-evaluation-templates/microagulhamento.ts`. Use id prefix `micro-s<N>-q<M>`. Target ~8 sections: Objetivo/Queixa, Histórico com microagulhamento e procedimentos anteriores, Avaliação clínica da pele (fototipo + condições + espessura + queloides), Medicamentos e ativos tópicos, Saúde geral e condições sistêmicas, Hábitos de vida e fatores de cicatrização, Eventos e disponibilidade pós-procedimento, Triagem de contraindicações, Protocolo de ativos — drug delivery (photo registry dropped).

- [ ] **Step 4: ID prefix check**

```bash
grep -E "'(lp-|bio-|sb-|skb-|enz-|skin-|botox-|filler-)s[0-9]" web/src/lib/default-evaluation-templates/microagulhamento.ts
```

Expected: empty. All IDs start with `micro-`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/default-evaluation-templates/microagulhamento.ts
git commit -m "feat(templates): rewrite microagulhamento evaluation with PDF v2 content"
```

---

### Task 1.6: Extend consent types enum and add/update consent template content

**Files:**
- Modify: `web/src/validations/consent.ts`

**Sources:**
- TCI-01 Limpeza de Pele: `floraclin-tci-4procedimentos.pdf` pages 1–3
- TCI-02 Bioestimulador: `floraclin-tci-4procedimentos.pdf` pages 4–6
- TCI-03 Lipo de Papada: `floraclin-tci-4procedimentos.pdf` pages 7–9
- TCI-04 Skinbooster: `floraclin-tci-4procedimentos.pdf` page 10
- Microagulhamento TCLE: `floraclin-microagulhamento-avaliacao-tci.pdf` pages 7–9

**Content fidelity rules** (for consents):
- Preamble preserved. Include citations (`art. 6°, III do CDC (Lei nº 8.078/1990)`, `LGPD — Lei nº 13.709/2018`, `art. 14 §4º do CDC`, `art. 951 do Código Civil`) wherever PDF has them.
- Cláusulas preserved as `Cláusula N — TÍTULO` followed by body paragraphs, blank line between cláusulas.
- Bullet lists preserved with `• ` prefix.
- Warning callouts inline as `⚠ ATENÇÃO — ...` where PDF has them.
- Final declaração block preserved including the `Autorizo livremente a realização do procedimento de X` confirmation.
- **Dropped** (physical-paper artifacts): `[ ] Autorizo / [ ] Não autorizo` image-use checkbox, `Assinar acima` lines, signature name/CPF/data placeholders at the bottom, FloraClin footer banding, the header field row (Nome/CPF/Data de nascimento/Data do procedimento — captured at signing time by the app).

- [ ] **Step 1: Read consent.ts current state**

```bash
cat web/src/validations/consent.ts
```

- [ ] **Step 2: Read PDF sources**

Use Read tool with `pages: "1-9"` on `floraclin-tci-4procedimentos.pdf` (gets pages 1–9 in one call; page 10 via `pages: "10"`). Also `pages: "7-9"` on `floraclin-microagulhamento-avaliacao-tci.pdf`.

- [ ] **Step 3: Update the `consentTypes` array**

Replace line 3:

```ts
export const consentTypes = ['general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract'] as const
```

With:

```ts
export const consentTypes = [
  'general',
  'botox',
  'filler',
  'biostimulator',
  'limpeza_pele',
  'enzima',
  'skinbooster',
  'microagulhamento',
  'custom',
  'service_contract',
] as const
```

- [ ] **Step 4: Rewrite the `DEFAULT_CONSENT_TEMPLATES.biostimulator` content**

Replace the existing `biostimulator` block (currently at lines ~158–204) with TCI-02 content transcribed from PDF pages 4–6. Structure:

```ts
biostimulator: {
  title: 'Termo de Consentimento — Bioestimulador de Colágeno',
  content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
BIOESTIMULADOR DE COLÁGENO · COLAGENOESTIMULAÇÃO

Este documento assegura que o(a) paciente recebeu informações completas e compreensíveis sobre o procedimento de bioestimulação de colágeno, em cumprimento ao art. 6°, III, do CDC (Lei nº 8.078/1990) e às normas de ética profissional aplicáveis. Por tratar-se de procedimento injetável invasivo com substância bioestimuladora, o consentimento informado tem relevância jurídica e clínica elevada. A assinatura é condição obrigatória para a realização.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO E SUBSTÂNCIA UTILIZADA

[... transcribe PDF page 4-5 verbatim ...]

Cláusula 2 — OBJETIVOS, RESULTADOS ESPERADOS E NATUREZA PROGRESSIVA

[... continue transcription ...]

[... all cláusulas through Cláusula 6 — FOTOGRAFIAS, LGPD E RESPONSABILIDADE ...]

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO

Eu, paciente abaixo identificado(a), declaro que li e compreendi integralmente este documento, fui informado(a) de forma clara e acessível sobre o procedimento de bioestimulação de colágeno, seus riscos, contraindicações, natureza progressiva dos resultados e obrigações pós-procedimento. Declaro não apresentar nenhuma das contraindicações listadas e que todas as informações fornecidas na ficha de avaliação são verdadeiras. Autorizo livremente a realização do procedimento de BIOESTIMULADOR DE COLÁGENO, consciente de que minha decisão é voluntária.`,
},
```

Preserve bullet formatting, `⚠ ATENÇÃO — RESULTADO NÃO É IMEDIATO` warning box, and the "Regra dos 5" massage protocol cláusula exactly.

- [ ] **Step 5: Add the 4 new consent template entries**

Insert after the `biostimulator` block (before `service_contract`):

```ts
limpeza_pele: {
  title: 'Termo de Consentimento — Limpeza de Pele Profissional',
  content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
LIMPEZA DE PELE PROFISSIONAL

[... transcribe TCI-01 from floraclin-tci-4procedimentos.pdf pages 1-3 verbatim ...]

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO

[... final paragraph with "Autorizo livremente a realização do procedimento de LIMPEZA DE PELE PROFISSIONAL" ...]`,
},
enzima: {
  title: 'Termo de Consentimento — Lipo de Papada (Enzima Lipolítica)',
  content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
LIPO DE PAPADA · APLICAÇÃO DE ENZIMA LIPOLÍTICA SUBMENTONIANA

[... transcribe TCI-03 from floraclin-tci-4procedimentos.pdf pages 7-9 verbatim ...]

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO

[... final paragraph with "Autorizo livremente a realização do procedimento de LIPO DE PAPADA POR ENZIMA LIPOLÍTICA" ...]`,
},
skinbooster: {
  title: 'Termo de Consentimento — Skinbooster',
  content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
SKINBOOSTER · HIDRATAÇÃO PROFUNDA INTRADÉRMICA

[... transcribe TCI-04 from floraclin-tci-4procedimentos.pdf page 10 verbatim ...]

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO

[... final paragraph with "Autorizo livremente a realização do procedimento de SKINBOOSTER" ...]`,
},
microagulhamento: {
  title: 'Termo de Consentimento — Microagulhamento (Indução Percutânea de Colágeno)',
  content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
MICROAGULHAMENTO · INDUÇÃO PERCUTÂNEA DE COLÁGENO (IPC)

[... transcribe from floraclin-microagulhamento-avaliacao-tci.pdf pages 7-9 verbatim ...]

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO

[... final paragraph with "Autorizo livremente a realização do procedimento de MICROAGULHAMENTO (INDUÇÃO PERCUTÂNEA DE COLÁGENO)" ...]`,
},
```

- [ ] **Step 6: Verify final shape**

```bash
node -e "const { DEFAULT_CONSENT_TEMPLATES, consentTypes } = require('./web/src/validations/consent.ts'); console.log(Object.keys(DEFAULT_CONSENT_TEMPLATES), consentTypes)"
```

This won't actually work because it's TypeScript — instead:

```bash
grep -E "^\s+(general|botox|filler|biostimulator|limpeza_pele|enzima|skinbooster|microagulhamento|service_contract):" web/src/validations/consent.ts
```

Expected: 9 matches (custom has no template entry — it's a type-only value).

```bash
grep -cE "^\s+'(general|botox|filler|biostimulator|limpeza_pele|enzima|skinbooster|microagulhamento|custom|service_contract)'," web/src/validations/consent.ts
```

Expected: 10.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS. The `consentTypes` widening will not break `ConsentTemplateInput` since it's `z.enum(consentTypes)`-derived.

- [ ] **Step 8: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/validations/consent.ts
git commit -m "feat(consent): add 4 new TCLE types and rewrite biostimulator from PDF"
```

---

### Task 1.7: Add PT-BR labels for the 4 new consent types

**Files:**
- Modify: `web/src/lib/constants.ts`

- [ ] **Step 1: Read current `CONSENT_TYPE_LABELS`**

```bash
grep -A 8 "CONSENT_TYPE_LABELS" web/src/lib/constants.ts
```

Current shape:

```ts
export const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  custom: 'Personalizado',
  service_contract: 'Contrato de Serviço',
}
```

- [ ] **Step 2: Replace with extended version**

```ts
export const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  limpeza_pele: 'Limpeza de Pele',
  enzima: 'Enzima Lipolítica',
  skinbooster: 'Skinbooster',
  microagulhamento: 'Microagulhamento',
  custom: 'Personalizado',
  service_contract: 'Contrato de Serviço',
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/constants.ts
git commit -m "feat(consent): add PT-BR labels for 4 new consent types"
```

---

### Task 1.8: Extend onboarding seed to include new consent types

**Files:**
- Modify: `web/src/app/api/onboarding/route.ts`

- [ ] **Step 1: Read the seed list at line ~157**

```bash
sed -n '150,170p' web/src/app/api/onboarding/route.ts
```

Current:

```ts
const consentTypes = ['general', 'botox', 'filler', 'biostimulator', 'service_contract'] as const
```

- [ ] **Step 2: Replace with extended list**

```ts
const consentTypes = [
  'general',
  'botox',
  'filler',
  'biostimulator',
  'limpeza_pele',
  'enzima',
  'skinbooster',
  'microagulhamento',
  'service_contract',
] as const
```

Keep `custom` OUT of the seed list — it's meant for user-created custom templates, not seeded defaults.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS. The `DEFAULT_CONSENT_TEMPLATES[type]` access on line 159 must still resolve for each value in the new list — it will, because Task 1.6 added the matching entries.

- [ ] **Step 4: Lint**

```bash
pnpm lint --filter @floraclin/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/onboarding/route.ts
git commit -m "feat(onboarding): seed 4 new consent types for fresh tenants"
```

---

### Task 1.9: Manual migration for consent_templates CHECK constraint + schema comment

**Files:**
- Create: `web/src/db/migrations/manual/0003_expand_consent_types.sql`
- Modify: `web/src/db/schema.ts` (only the comment at line 292)

- [ ] **Step 1: Inspect prior manual migration to match style**

```bash
cat web/src/db/migrations/manual/0002_procedure_status_migration.sql
```

The relevant block is:

```sql
-- Drop old CHECK constraint on consent_templates.type (if it exists)
ALTER TABLE floraclin.consent_templates DROP CONSTRAINT IF EXISTS consent_templates_type_check;

-- Add new CHECK constraint for consent template type (includes service_contract)
ALTER TABLE floraclin.consent_templates
  ADD CONSTRAINT consent_templates_type_check
  CHECK (type IN ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract'));
```

The constraint name is `consent_templates_type_check`.

- [ ] **Step 2: Create the new manual migration**

Create `web/src/db/migrations/manual/0003_expand_consent_types.sql` with:

```sql
-- Expand consent_templates.type to include 4 new clinical TCLE types:
-- limpeza_pele, enzima, skinbooster, microagulhamento
-- See docs/superpowers/specs/2026-04-16-expanded-templates-design.md

ALTER TABLE floraclin.consent_templates DROP CONSTRAINT IF EXISTS consent_templates_type_check;

ALTER TABLE floraclin.consent_templates
  ADD CONSTRAINT consent_templates_type_check
  CHECK (type IN (
    'general',
    'botox',
    'filler',
    'biostimulator',
    'limpeza_pele',
    'enzima',
    'skinbooster',
    'microagulhamento',
    'custom',
    'service_contract'
  ));
```

- [ ] **Step 3: Update schema.ts comment at line 292**

Replace the inline comment on `type: varchar('type', { length: 30 })`:

Before:

```ts
type: varchar('type', { length: 30 }).notNull(), // CHECK in migration: ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract')
```

After:

```ts
type: varchar('type', { length: 30 }).notNull(), // CHECK in migration: ('general', 'botox', 'filler', 'biostimulator', 'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento', 'custom', 'service_contract')
```

- [ ] **Step 4: Typecheck (comment change is non-breaking)**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Verify migration SQL is syntactically valid**

```bash
cat web/src/db/migrations/manual/0003_expand_consent_types.sql
```

Verify: `ALTER TABLE` statements end with `;`, constraint name matches the DROP, the 10 type values match Task 1.6's `consentTypes` array exactly (including order: `custom` and `service_contract` last).

- [ ] **Step 6: Commit**

```bash
git add web/src/db/migrations/manual/0003_expand_consent_types.sql web/src/db/schema.ts
git commit -m "feat(db): expand consent_templates.type CHECK constraint for 4 new TCLE types"
```

---

## Group 2 — Integration verification

Runs after Group 1 is merged. Not a parallel group — one task, one commit (if needed).

### Task 2.1: Run full pre-push gate

**Files:** none modified unless checks fail.

- [ ] **Step 1: Run all CI checks**

```bash
pnpm ci:checks
```

Expected: PASS (lint + typecheck + test:run).

- [ ] **Step 2: If any check fails, diagnose and fix**

Common expected failures:
- **Type narrowing in consent validation**: If `ConsentTemplateInput`-derived types are used elsewhere with a hardcoded subset of `consentTypes`, they'll now fail. Grep: `grep -rn "'general'.*'botox'.*'filler'" web/src` — fix any such hardcoded narrowings.
- **Missing label fallback**: if any component renders `CONSENT_TYPE_LABELS[type]` without a `??` fallback, the new types will now render but that's desired. No action.
- **Test fixtures** in `__tests__` directories hardcoding old consent types: grep `grep -rn "consentTypes\|DEFAULT_CONSENT_TEMPLATES" web/src/db/queries/__tests__` — update if any fixture enumerates types.

Fix the root cause. Re-run `pnpm ci:checks` until green.

- [ ] **Step 3: If fixes were made, commit**

```bash
git add <fixed-files>
git commit -m "fix: address CI failures from expanded consent types"
```

- [ ] **Step 4: Verify build (sanity check)**

```bash
pnpm --filter @floraclin/web build
```

Expected: PASS.

- [ ] **Step 5: Confirm no other callers broke**

```bash
# Verify the 3 callers of defaultTemplates still resolve
grep -rn "from '@/lib/default-evaluation-templates'" web/src
```

Expected: three hits — `onboarding/route.ts`, `api/evaluation/templates/route.ts`, `db/queries/evaluation-templates.ts`. All should still work because the barrel `index.ts` re-exports `defaultTemplates`.

---

## Self-Review Notes

**Spec coverage:**
- ✅ 5 evaluation template rewrites → Tasks 1.1–1.5
- ✅ Consent enum + 4 new content + biostimulator rewrite → Task 1.6
- ✅ PT-BR labels → Task 1.7
- ✅ Onboarding seed extension → Task 1.8
- ✅ CHECK constraint migration + schema comment → Task 1.9
- ✅ File split for parallel safety → Task 0.1
- ✅ Verification → Task 2.1

**Parallelization integrity:**
- Group 0 runs alone.
- Group 1 has 9 tasks, each owning a different file:
  - 1.1 → `bioestimulador.ts`
  - 1.2 → `skinbooster.ts`
  - 1.3 → `enzima.ts`
  - 1.4 → `limpeza-pele.ts`
  - 1.5 → `microagulhamento.ts`
  - 1.6 → `validations/consent.ts`
  - 1.7 → `lib/constants.ts`
  - 1.8 → `app/api/onboarding/route.ts`
  - 1.9 → `db/migrations/manual/0003_expand_consent_types.sql` + `db/schema.ts` (comment only)
  - **No file overlap.** ✅

**Type consistency:**
- `consentTypes` array in Task 1.6 and `consentTypes` array in Task 1.8 must contain exactly the same 9 values in the same relative order (custom excluded from Task 1.8 as noted). ✅
- `CONSENT_TYPE_LABELS` keys in Task 1.7 include every value from `consentTypes`. ✅
- CHECK constraint values in Task 1.9 match `consentTypes` exactly. ✅
- `limpezaPeleSections` → `limpeza-pele.ts` (kebab-case filename, camelCase identifier). ✅ Barrel imports use the exact identifier.

**No placeholders** — all steps have exact file paths, exact SQL, exact code for plumbing tasks. The 5 evaluation rewrites (1.1–1.5) contain the PDF source path + page range + fidelity rules + shape example rather than verbatim transcriptions; agents transcribe from the PDFs. This is intentional and allowed per the spec's "agents implementing this work must read the relevant PDF pages directly" directive.
