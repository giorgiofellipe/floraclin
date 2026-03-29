# Evaluation Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded planning step with dynamic evaluation templates linked to procedure types. Each procedure type can have its own customizable evaluation form (ficha de avaliação). Default templates from the clinical protocols PDF are provided and clinics can edit them.

**Architecture:** New `evaluation_templates` and `evaluation_responses` tables. Templates are JSONB arrays of sections/questions. A visual form builder in settings lets clinics customize. The wizard step 3 dynamically renders templates based on selected procedure types. Historical responses are immutable via template snapshots.

---

## Data Model

### `evaluation_templates` table

```sql
CREATE TABLE floraclin.evaluation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  procedure_type_id UUID NOT NULL REFERENCES floraclin.procedure_types(id),
  name VARCHAR(255) NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, procedure_type_id)
);

CREATE INDEX idx_evaluation_templates_tenant ON floraclin.evaluation_templates(tenant_id);
```

### `evaluation_responses` table

```sql
CREATE TABLE floraclin.evaluation_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  template_id UUID NOT NULL REFERENCES floraclin.evaluation_templates(id),
  template_version INTEGER NOT NULL,
  template_snapshot JSONB NOT NULL,
  responses JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evaluation_responses_procedure ON floraclin.evaluation_responses(tenant_id, procedure_record_id);
```

### JSONB Structures

```typescript
interface EvaluationSection {
  id: string
  title: string
  order: number
  questions: EvaluationQuestion[]
}

interface EvaluationQuestion {
  id: string
  label: string
  type: 'radio' | 'checkbox' | 'scale' | 'text' | 'checkbox_with_other' | 'radio_with_other' | 'face_diagram'
  required: boolean
  order: number
  options?: string[]          // for radio, checkbox types
  scaleMin?: number           // for scale (default 1)
  scaleMax?: number           // for scale (default 5)
  scaleMinLabel?: string      // "Muito insatisfeita"
  scaleMaxLabel?: string      // "Muito satisfeita"
  helpText?: string           // italic helper text
  warningText?: string        // amber ⚠ warning box
}

// Response storage: { [questionId]: answer }
// radio: string (selected option)
// checkbox: string[] (selected options)
// scale: number
// text: string
// checkbox_with_other: { selected: string[], other: string }
// radio_with_other: { selected: string, other: string }
// face_diagram: { completed: true } (actual data lives in face_diagrams/diagram_points tables)
```

### Immutability Strategy

- `evaluation_responses.template_snapshot` stores a frozen copy of `sections` JSONB at the time of answering
- `template_version` records which version was filled
- When viewing a historical response → always render from `template_snapshot`
- When editing (only while procedure is `planned`) → load current template, match answers by `questionId`, new questions appear empty, removed questions' answers kept in JSON but hidden
- Template updates increment `version` on the template

---

## Template-Procedure Type Relationship

- One-to-one: each procedure type has at most one evaluation template
- Linked via `procedure_type_id` (UNIQUE per tenant)
- If no template exists for a type → planning step shows just the financial plan
- Template edited from: Configurações → Procedimentos → [type] → Ficha de Avaliação

---

## Face Diagram as Question Type

- `face_diagram` is a question type in the template
- The template controls WHERE in the evaluation flow the diagram appears
- The diagram data lives on the `procedure_record` (existing `face_diagrams` + `diagram_points` tables)
- The response JSON for a `face_diagram` question stores `{ completed: true }` — not the diagram data
- When multiple procedure types are selected and multiple templates have `face_diagram` questions → render the SHARED diagram only at the first occurrence, show "Diagrama preenchido acima" for subsequent ones
- The diagram infers gender from the patient

---

## Wizard Integration

Step 3 (Planejamento) in the wizard becomes dynamic:

1. Load evaluation templates for each procedure type selected in step 2
2. Render each template's sections sequentially, grouped by procedure type with clear visual separation
3. If a procedure type has no template → skip that type's section
4. Face diagram renders once (shared) at the first `face_diagram` question encountered
5. Financial plan always renders at the bottom (not part of any template)

```
Step 3 — Planejamento

[Toxina Botulínica — Ficha de Avaliação]
  Section 1: Histórico
  Section 2: Queixa Principal (includes face_diagram)
  Section 3: Avaliação Muscular
  Section 4: Contraindicações

[Preenchimentos — Ficha de Avaliação]
  Section 1: Histórico
  Section 2: Áreas de Interesse
  Section 3: Avaliação de Pele
  Section 4: Contraindicações

[Orçamento]  ← always present, not template-driven
  Total, parcelas, forma de pagamento
```

---

## Template Editor (Settings)

Located at: Configurações → Procedimentos → [type] → "Editar Ficha de Avaliação"

**Features:**
- Add/remove/reorder sections (drag handles)
- Add/remove/reorder questions within sections
- Question editor dialog: label, type, required toggle, options list, scale config, help text, warning text
- "Restaurar padrão" button to reset to default template
- Preview mode to see how the form looks
- Saves increment the version number

**Question types in the editor:**
- Escolha única (radio)
- Múltipla escolha (checkbox)
- Escala (scale 1-5)
- Texto livre (text)
- Múltipla escolha com "Outro" (checkbox_with_other)
- Escolha única com "Outro" (radio_with_other)
- Diagrama facial (face_diagram)

---

## Default Templates (from PDF)

8 default templates seeded during onboarding, matching the clinical protocols PDF:

1. **Toxina Botulínica** (6 sections): Histórico, Queixa Principal + face_diagram, Avaliação Muscular, Contraindicações, Observações
2. **Preenchimentos** (6 sections): Histórico, Áreas de Interesse + face_diagram, Avaliação de Pele, Contraindicações, Observações
3. **Bioestimulador de Colágeno** (6 sections): Histórico e Queixa, Estilo de Vida, Expectativa, Contraindicações, Observações
4. **Skinbooster** (6 sections): Hidratação e Qualidade da Pele, Hábitos, Rotina de Skincare, Contraindicações, Observações
5. **Enzima para Gordura** (6 sections): Queixa e Área, Hábitos Alimentares, Avaliação do Tecido, Contraindicações, Observações
6. **Limpeza de Pele** (5 sections): Classificação da Pele, Rotina de Cuidados, Histórico, Observações
7. **Skincare Personalizado** (8 sections): Tipo de Pele, Rotina de Skincare, Hábitos, Fatores Hormonais, Exposição Solar, Expectativas, Observações
8. **Microagulhamento** (7 sections): Queixa Principal, Avaliação da Pele, Medicamentos/Ativos, Contraindicações, Pós-procedimento, Observações

Each template's full question data (labels, types, options) is extracted from the PDF and stored in `src/lib/default-evaluation-templates.ts`.

---

## Dependency Graph

```
Task 1: Schema + queries + types + default templates JSON
  ↓
Tasks 2, 3 IN PARALLEL:
  Task 2: Template editor (settings UI)
  Task 3: Template renderer (fillable form component)
  ↓
Task 4: Wire into wizard step 3 + procedure form
  ↓
Task 5: Seed defaults during onboarding + polish
```

---

## Task 1: Schema + Queries + Default Templates

**Files:**
- Modify: `src/db/schema.ts` — add `evaluationTemplates` + `evaluationResponses` tables
- Create: `src/db/queries/evaluation-templates.ts`
- Create: `src/db/queries/evaluation-responses.ts`
- Create: `src/actions/evaluation-templates.ts`
- Create: `src/actions/evaluation-responses.ts`
- Create: `src/lib/default-evaluation-templates.ts` — 8 templates as JSON
- Create: `src/types/evaluation.ts` — TypeScript interfaces
- Run: `npx drizzle-kit generate`

**Queries:**
- `getTemplateForProcedureType(tenantId, procedureTypeId)` → template or null
- `getTemplatesForProcedureTypes(tenantId, procedureTypeIds[])` → templates[]
- `createTemplate(tenantId, procedureTypeId, data)` → template
- `updateTemplate(tenantId, templateId, sections)` → increments version
- `resetTemplateToDefault(tenantId, templateId, procedureCategory)` → resets sections from defaults
- `saveEvaluationResponse(tenantId, data)` → upserts response with template snapshot
- `getEvaluationResponse(tenantId, procedureRecordId, templateId)` → response or null
- `getEvaluationResponsesForProcedure(tenantId, procedureRecordId)` → all responses

**Commit:** `feat: evaluation templates schema, queries, and default templates data`

---

## Task 2: Template Editor

**Files:**
- Create: `src/components/evaluation/template-editor.tsx` — visual form builder
- Create: `src/components/evaluation/question-editor-dialog.tsx` — add/edit question dialog
- Create: `src/components/evaluation/section-editor.tsx` — section with drag-reorder questions
- Modify: `src/components/settings/procedure-type-list.tsx` — add "Ficha de Avaliação" action
- Create: `src/app/(platform)/configuracoes/avaliacao/[procedureTypeId]/page.tsx` — editor page

**Editor features:**
- Add/remove/reorder sections
- Add/remove/reorder questions within sections
- Question editor: label, type selector, required toggle, options manager, scale config, help/warning text
- "Restaurar padrão" button with confirmation
- Save → increments version
- Brand v2 styling

**Commit:** `feat: evaluation template editor - visual form builder in settings`

---

## Task 3: Template Renderer

**Files:**
- Create: `src/components/evaluation/template-renderer.tsx` — renders template as fillable form
- Create: `src/components/evaluation/question-renderers.tsx` — individual question type components

**Renderer features:**
- Accepts: template sections, current responses, onChange callback, readOnly flag
- Renders each section as a collapsible card with numbered header
- Renders each question based on its type:
  - `radio`: radio button group
  - `checkbox`: checkbox group
  - `scale`: 1-5 button row with min/max labels
  - `text`: textarea
  - `checkbox_with_other`: checkboxes + "Outra: ___" text input
  - `radio_with_other`: radios + "Outra: ___" text input
  - `face_diagram`: renders FaceDiagramEditor (shared instance)
- Shows `warningText` as amber ⚠ alert box
- Shows `helpText` as italic caption
- Required fields show * indicator
- Tracks completion per section (X/Y respondidas)
- WizardOverrides compatible (triggerSave, onSaveComplete)

**Commit:** `feat: evaluation template renderer - dynamic form from template JSON`

---

## Task 4: Wire into Wizard + Procedure Form

**Files:**
- Modify: `src/components/service-wizard/service-wizard.tsx` — step 3 loads templates
- Modify: `src/components/procedures/procedure-form.tsx` — replace hardcoded planning with template renderer
- Modify: `src/hooks/use-service-wizard.ts` — store evaluation responses in state

**What changes in step 3:**
1. After step 2 sets `selectedTypeIds`, step 3 loads templates via `getTemplatesForProcedureTypesAction`
2. For each template found, render a `TemplateRenderer` with the procedure type name as header
3. Face diagram: render once at the first `face_diagram` question, skip subsequent ones
4. Financial plan: always at the bottom
5. "Próximo" saves all template responses + diagram + financial in one action
6. Each response saved with `template_snapshot` for immutability

**What changes in standalone procedure form:**
- Same template rendering when not in wizard mode (backward compat)

**Commit:** `feat: wire evaluation templates into wizard step 3 and procedure form`

---

## Task 5: Seed Defaults + Polish

**Files:**
- Modify: `src/actions/onboarding.ts` — seed 8 default templates during onboarding
- Modify: `src/components/settings/procedure-type-list.tsx` — show template status indicator

**What to do:**
- During onboarding, after creating procedure types, create evaluation templates for each type using the defaults from `src/lib/default-evaluation-templates.ts`
- Match template to procedure type by category (botox → toxina template, filler → preenchimentos template, etc.)
- Procedure type list shows "Ficha: Configurada" or "Ficha: Sem modelo" indicator

**Commit:** `feat: seed default evaluation templates during onboarding`

---

## Post-Implementation Checklist

- [ ] 8 default templates seeded during onboarding
- [ ] Template editor: can add/remove/reorder sections and questions
- [ ] Template editor: all 7 question types configurable
- [ ] Template editor: "Restaurar padrão" works
- [ ] Template renderer: all question types render correctly
- [ ] Wizard step 3: loads templates based on selected procedure types
- [ ] Wizard step 3: face diagram renders once (shared) at first occurrence
- [ ] Wizard step 3: financial plan always at bottom
- [ ] Responses saved with template snapshot
- [ ] Historical responses viewable with original questions
- [ ] Editing responses on planned procedure works (matches by questionId)
- [ ] No data loss when template is edited after responses exist
- [ ] All text pt-BR
- [ ] Brand v2 styling
