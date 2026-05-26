# WhatsApp Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full lifecycle management of WhatsApp message templates — CRUD via Meta API, blueprint auto-provisioning, approval tracking, management UI in settings, and automated message configuration.

**Architecture:** Extends the existing sync-based model (whatsappTemplates + upsertTemplate). CRUD hits Meta API first → updates local DB on success. Blueprints are hardcoded TypeScript objects auto-submitted on WABA connection. Automations table stores per-tenant toggles for automated message triggers.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM 0.45, Meta Graph API v21.0, React Hook Form + Zod, shadcn/ui, TanStack React Query.

**Spec:** `docs/superpowers/specs/2026-05-25-whatsapp-template-management-design.md`

---

## File Structure

```
web/src/
├── db/
│   ├── schema.ts                          — MODIFY: add columns to whatsappTemplates, add whatsappAutomations table
│   ├── migrations/
│   │   ├── 0009_whatsapp_template_mgmt.sql — CREATE: migration SQL
│   │   └── meta/_journal.json             — MODIFY: add entry
│   └── queries/whatsapp.ts                — MODIFY: add template CRUD + automation queries
├── lib/
│   ├── whatsapp.ts                        — MODIFY: add createTemplate, editTemplate, deleteTemplate, getTemplate
│   └── whatsapp-blueprints.ts             — CREATE: hardcoded blueprint definitions
├── validations/whatsapp.ts                — MODIFY: add template + automation schemas
├── app/api/whatsapp/
│   ├── templates/
│   │   ├── route.ts                       — MODIFY: enhance GET, add POST (create)
│   │   ├── sync/route.ts                  — MODIFY: handle new fields
│   │   ├── [id]/route.ts                  — CREATE: GET/PATCH/DELETE single template
│   │   └── provision/route.ts             — CREATE: POST auto-provision blueprints
│   └── automations/
│       ├── route.ts                       — CREATE: GET list automations
│       └── [trigger]/route.ts             — CREATE: PATCH update automation
├── components/
│   ├── settings/
│   │   ├── whatsapp-settings-form.tsx     — MODIFY: integrate template + automations sections
│   │   ├── whatsapp-template-list.tsx     — CREATE: template list with status badges
│   │   ├── whatsapp-template-editor.tsx   — CREATE: template editor with variable insertion
│   │   └── whatsapp-automations.tsx       — CREATE: automation toggle cards
│   └── whatsapp/
│       ├── template-picker.tsx            — MODIFY: filter by APPROVED, add variable inputs
│       └── chat-panel.tsx                 — MODIFY: update handleSendTemplate to pass params
└── lib/__tests__/
    └── whatsapp-blueprints.test.ts        — CREATE: blueprint validation tests
```

---

## Group A (parallel)

### Task 1: Database Migration

**Files:**
- Create: `web/src/db/migrations/0009_whatsapp_template_mgmt.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add new columns to whatsapp_templates
ALTER TABLE "floraclin"."whatsapp_templates"
  ALTER COLUMN "meta_template_id" DROP NOT NULL;

ALTER TABLE "floraclin"."whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "purpose_key" varchar(100),
  ADD COLUMN IF NOT EXISTS "rejected_reason" text,
  ADD COLUMN IF NOT EXISTS "blueprint_slug" varchar(100),
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "variable_mapping" jsonb;

-- Unique constraint: at most one template per purpose per tenant
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_templates_tenant_purpose"
  ON "floraclin"."whatsapp_templates" ("tenant_id", "purpose_key")
  WHERE "purpose_key" IS NOT NULL;

-- Automations table
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_automations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "trigger" varchar(50) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "template_id" uuid REFERENCES "floraclin"."whatsapp_templates"("id") ON DELETE SET NULL,
  "config" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_automations_tenant_trigger"
  ON "floraclin"."whatsapp_automations" ("tenant_id", "trigger");
```

- [ ] **Step 2: Commit**

```bash
git add web/src/db/migrations/0009_whatsapp_template_mgmt.sql
git commit -m "feat(whatsapp): add template management migration"
```

---

### Task 2: Blueprint Definitions

**Files:**
- Create: `web/src/lib/whatsapp-blueprints.ts`
- Create: `web/src/lib/__tests__/whatsapp-blueprints.test.ts`

- [ ] **Step 1: Write the blueprint test**

```typescript
// web/src/lib/__tests__/whatsapp-blueprints.test.ts
import { describe, it, expect } from 'vitest'
import { TEMPLATE_BLUEPRINTS, type TemplateBlueprint } from '../whatsapp-blueprints'

describe('whatsapp-blueprints', () => {
  it('exports a non-empty array of blueprints', () => {
    expect(TEMPLATE_BLUEPRINTS.length).toBeGreaterThan(0)
  })

  it('each blueprint has unique slug', () => {
    const slugs = TEMPLATE_BLUEPRINTS.map((b) => b.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('each blueprint has unique purposeKey', () => {
    const keys = TEMPLATE_BLUEPRINTS.map((b) => b.purposeKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('template names are snake_case and lowercase', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      expect(bp.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('variable indices are sequential starting from 1', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      const indices = bp.variables.map((v) => v.index)
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i + 1)
      }
    }
  })

  it('body references match variable count', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      const bodyComponent = bp.components.find((c: Record<string, unknown>) => c.type === 'BODY')
      if (!bodyComponent) continue
      const matches = (bodyComponent.text as string).match(/\{\{\d+\}\}/g) ?? []
      const uniqueRefs = new Set(matches)
      expect(uniqueRefs.size).toBe(bp.variables.length)
    }
  })

  it('every blueprint has a valid category', () => {
    for (const bp of TEMPLATE_BLUEPRINTS) {
      expect(['UTILITY', 'MARKETING']).toContain(bp.category)
    }
  })

  it('generateTemplateName produces valid Meta template name', () => {
    const { generateTemplateName } = require('../whatsapp-blueprints')
    expect(generateTemplateName('Clínica Flora', 'appointment_reminder')).toBe('clinica_flora_appointment_reminder')
    expect(generateTemplateName('Dr. João', 'follow_up')).toBe('dr_joao_follow_up')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose src/lib/__tests__/whatsapp-blueprints.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the blueprint definitions**

```typescript
// web/src/lib/whatsapp-blueprints.ts

export interface TemplateVariable {
  index: number
  key: string
  label: string
  example: string
}

export interface TemplateBlueprint {
  slug: string
  purposeKey: string
  name: string
  category: 'UTILITY' | 'MARKETING'
  language: string
  components: Record<string, unknown>[]
  variables: TemplateVariable[]
  description: string
}

export interface VariablePaletteItem {
  key: string
  label: string
  example: string
}

export const PREDEFINED_VARIABLES: VariablePaletteItem[] = [
  { key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
  { key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
  { key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
  { key: 'appointment_time', label: 'Horário', example: '14:30' },
  { key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
  { key: 'amount', label: 'Valor (R$)', example: '350,00' },
  { key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
  { key: 'link', label: 'Link', example: 'https://app.floraclin.com/...' },
  { key: 'instructions', label: 'Orientações', example: 'Evitar exposição solar...' },
]

function makeBody(text: string, variables: TemplateVariable[]): Record<string, unknown>[] {
  return [
    {
      type: 'BODY',
      text,
      example: {
        body_text: [variables.map((v) => v.example)],
      },
    },
  ]
}

export const TEMPLATE_BLUEPRINTS: TemplateBlueprint[] = [
  {
    slug: 'appointment_reminder',
    purposeKey: 'appointment_reminder',
    name: 'appointment_reminder',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Lembrete de consulta agendada',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
      { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
    ],
    components: makeBody(
      'Olá, {{1}}! Lembramos que você tem um atendimento agendado na {{2}} no dia {{3}}, às {{4}}. Caso precise reagendar, entre em contato conosco. Até lá!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
        { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
      ],
    ),
  },
  {
    slug: 'appointment_confirmation',
    purposeKey: 'appointment_confirmation',
    name: 'appointment_confirmation',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Confirmação de presença na consulta',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
      { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
    ],
    components: makeBody(
      'Olá, {{1}}! Gostaríamos de confirmar sua presença na {{2}} no dia {{3}}, às {{4}}. Por favor, responda *SIM* para confirmar ou *NÃO* para reagendar.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'appointment_date', label: 'Data da consulta', example: '15/04/2026' },
        { index: 4, key: 'appointment_time', label: 'Horário', example: '14:30' },
      ],
    ),
  },
  {
    slug: 'follow_up',
    purposeKey: 'follow_up',
    name: 'follow_up',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Acompanhamento pós-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
    ],
    components: makeBody(
      'Olá, {{1}}! Passando para saber como você está se sentindo após o procedimento de {{2}}. Qualquer dúvida, estamos à disposição! 😊',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
      ],
    ),
  },
  {
    slug: 'reschedule',
    purposeKey: 'reschedule_notification',
    name: 'reschedule_notification',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Notificação de reagendamento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'appointment_date', label: 'Nova data', example: '20/04/2026' },
      { index: 3, key: 'appointment_time', label: 'Novo horário', example: '16:00' },
    ],
    components: makeBody(
      'Olá, {{1}}. Informamos que seu atendimento foi reagendado para o dia {{2}}, às {{3}}. Caso tenha alguma dúvida, estamos à disposição.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'appointment_date', label: 'Nova data', example: '20/04/2026' },
        { index: 3, key: 'appointment_time', label: 'Novo horário', example: '16:00' },
      ],
    ),
  },
  {
    slug: 'payment_reminder',
    purposeKey: 'payment_reminder',
    name: 'payment_reminder',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Lembrete de pagamento pendente',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
      { index: 3, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 4, key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
    ],
    components: makeBody(
      'Olá, {{1}}. Informamos que o pagamento no valor de R$ {{2}} referente ao seu atendimento na {{3}} tem vencimento em {{4}}. Qualquer dúvida, estamos à disposição.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
        { index: 3, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 4, key: 'due_date', label: 'Data de vencimento', example: '20/04/2026' },
      ],
    ),
  },
  {
    slug: 'payment_confirmation',
    purposeKey: 'payment_confirmation',
    name: 'payment_confirmation',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Confirmação de recebimento de pagamento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
    ],
    components: makeBody(
      'Olá, {{1}}! Confirmamos o recebimento do seu pagamento no valor de R$ {{2}}. Agradecemos pela pontualidade! 😊',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'amount', label: 'Valor (R$)', example: '350,00' },
      ],
    ),
  },
  {
    slug: 'anamnese_link',
    purposeKey: 'anamnese_link',
    name: 'anamnese_link',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Link para preenchimento de anamnese',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'link', label: 'Link da anamnese', example: 'https://app.floraclin.com/anamnese/abc123' },
    ],
    components: makeBody(
      'Olá, {{1}}! Para agilizar seu atendimento na {{2}}, pedimos que preencha sua ficha de anamnese pelo link abaixo:\n\n{{3}}\n\nQualquer dúvida, estamos à disposição.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'link', label: 'Link da anamnese', example: 'https://app.floraclin.com/anamnese/abc123' },
      ],
    ),
  },
  {
    slug: 'pre_procedure',
    purposeKey: 'pre_procedure_instructions',
    name: 'pre_procedure_instructions',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Orientações pré-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Preenchimento labial' },
      { index: 3, key: 'instructions', label: 'Orientações', example: 'Evitar anti-inflamatórios 7 dias antes.' },
    ],
    components: makeBody(
      'Olá, {{1}}! Seu procedimento de {{2}} está se aproximando. Seguem orientações importantes para o preparo:\n\n{{3}}\n\nEm caso de dúvidas, entre em contato conosco.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Preenchimento labial' },
        { index: 3, key: 'instructions', label: 'Orientações', example: 'Evitar anti-inflamatórios 7 dias antes.' },
      ],
    ),
  },
  {
    slug: 'post_procedure',
    purposeKey: 'post_procedure_care',
    name: 'post_procedure_care',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Cuidados pós-procedimento',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
      { index: 3, key: 'instructions', label: 'Cuidados', example: 'Não deitar por 4 horas.' },
    ],
    components: makeBody(
      'Olá, {{1}}! Seguem os cuidados recomendados após o seu procedimento de {{2}}:\n\n{{3}}\n\nLembre-se de seguir as orientações para o melhor resultado. Estamos à disposição!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'procedure_name', label: 'Procedimento', example: 'Botox' },
        { index: 3, key: 'instructions', label: 'Cuidados', example: 'Não deitar por 4 horas.' },
      ],
    ),
  },
  {
    slug: 'document_request',
    purposeKey: 'document_request',
    name: 'document_request',
    category: 'UTILITY',
    language: 'pt_BR',
    description: 'Solicitação de documentos',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      { index: 3, key: 'instructions', label: 'Documentos', example: 'RG, CPF e comprovante de endereço.' },
    ],
    components: makeBody(
      'Olá, {{1}}. Para dar continuidade ao seu atendimento na {{2}}, precisamos dos seguintes documentos:\n\n{{3}}\n\nPor favor, envie assim que possível.',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
        { index: 3, key: 'instructions', label: 'Documentos', example: 'RG, CPF e comprovante de endereço.' },
      ],
    ),
  },
  {
    slug: 'birthday',
    purposeKey: 'birthday_greeting',
    name: 'birthday_greeting',
    category: 'MARKETING',
    language: 'pt_BR',
    description: 'Mensagem de aniversário',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    ],
    components: makeBody(
      'Parabéns, {{1}}! 🎂 Toda a equipe da {{2}} deseja a você um dia muito especial e cheio de alegrias. Conte sempre conosco!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      ],
    ),
  },
  {
    slug: 'reactivation',
    purposeKey: 'reactivation',
    name: 'reactivation',
    category: 'MARKETING',
    language: 'pt_BR',
    description: 'Reativação de pacientes inativos',
    variables: [
      { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
      { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
    ],
    components: makeBody(
      'Olá, {{1}}! Sentimos sua falta na {{2}}. 😊 Que tal agendar uma visita? Estamos com novidades que podem te interessar. Aguardamos seu contato!',
      [
        { index: 1, key: 'patient_name', label: 'Nome do paciente', example: 'Maria Silva' },
        { index: 2, key: 'clinic_name', label: 'Nome da clínica', example: 'Clínica Flora' },
      ],
    ),
  },
]

export function generateTemplateName(tenantName: string, blueprintName: string): string {
  const slug = tenantName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return `${slug}_${blueprintName}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose src/lib/__tests__/whatsapp-blueprints.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/whatsapp-blueprints.ts web/src/lib/__tests__/whatsapp-blueprints.test.ts
git commit -m "feat(whatsapp): add template blueprint definitions"
```

---

### Task 3: Validation Schemas

**Files:**
- Modify: `web/src/validations/whatsapp.ts`

- [ ] **Step 1: Add template + automation validation schemas**

Add after the existing `conversationFilterSchema` (line 32) and before the type exports (line 34):

```typescript
export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255).regex(/^[a-z][a-z0-9_]*$/, 'Nome deve ser snake_case (letras minúsculas, números e _)'),
  category: z.enum(['UTILITY', 'MARKETING']),
  language: z.string().default('pt_BR'),
  components: z.array(z.record(z.string(), z.unknown())).min(1, 'Template deve ter ao menos um componente'),
  purposeKey: z.string().max(100).optional(),
  variableMapping: z.array(z.object({
    index: z.number().int().positive(),
    key: z.string(),
    label: z.string(),
    example: z.string(),
  })).optional(),
})

export const updateTemplateSchema = z.object({
  components: z.array(z.record(z.string(), z.unknown())).min(1),
  variableMapping: z.array(z.object({
    index: z.number().int().positive(),
    key: z.string(),
    label: z.string(),
    example: z.string(),
  })).optional(),
})

export const updateAutomationSchema = z.object({
  enabled: z.boolean().optional(),
  templateId: z.string().uuid().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
})
```

Update the type exports at the end of the file to add:

```typescript
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/validations/whatsapp.ts
git commit -m "feat(whatsapp): add template and automation validation schemas"
```

---

### Task 4: Meta API CRUD Functions

**Files:**
- Modify: `web/src/lib/whatsapp.ts`

- [ ] **Step 1: Add createTemplate function**

Add after `getTemplates` (line 120), before `downloadAndStoreMedia` (line 122):

```typescript
export async function createTemplate(
  tenantId: string,
  template: {
    name: string
    category: string
    language: string
    components: unknown[]
  },
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates`,
    creds.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        name: template.name,
        category: template.category,
        language: template.language,
        components: template.components,
      }),
    },
  )
  return data as { id: string; status: string; category: string }
}

export async function editTemplate(
  tenantId: string,
  metaTemplateId: string,
  components: unknown[],
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(`/${metaTemplateId}`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({ components }),
  })
  return data as { success: boolean }
}

export async function deleteTemplate(
  tenantId: string,
  templateName: string,
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}`,
    creds.accessToken,
    { method: 'DELETE' },
  )
  return data as { success: boolean }
}

export async function getTemplate(
  tenantId: string,
  metaTemplateId: string,
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${metaTemplateId}?fields=name,status,category,components,rejected_reason`,
    creds.accessToken,
  )
  return data as {
    id: string
    name: string
    status: string
    category: string
    components: unknown[]
    rejected_reason?: string
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/whatsapp.ts
git commit -m "feat(whatsapp): add Meta API template CRUD functions"
```

---

## Group B (depends on A)

### Task 5: Schema + Relations Update

**Files:**
- Modify: `web/src/db/schema.ts`
- Modify: `web/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Update whatsappTemplates table in schema**

In `web/src/db/schema.ts`, replace the `whatsappTemplates` table definition (lines 679-692) with:

```typescript
export const whatsappTemplates = floraclinSchema.table('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  metaTemplateId: varchar('meta_template_id', { length: 255 }),
  name: varchar('name', { length: 255 }).notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  components: jsonb('components').notNull(),
  purposeKey: varchar('purpose_key', { length: 100 }),
  rejectedReason: text('rejected_reason'),
  blueprintSlug: varchar('blueprint_slug', { length: 100 }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  variableMapping: jsonb('variable_mapping'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_templates_tenant_name_lang').on(table.tenantId, table.name, table.language),
  uniqueIndex('uq_whatsapp_templates_tenant_purpose').on(table.tenantId, table.purposeKey).where(sql`purpose_key IS NOT NULL`),
])
```

- [ ] **Step 2: Add whatsappAutomations table**

Add after the `whatsappTemplates` table (before the SSE EVENTS comment):

```typescript
export const whatsappAutomations = floraclinSchema.table('whatsapp_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  trigger: varchar('trigger', { length: 50 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  templateId: uuid('template_id').references(() => whatsappTemplates.id),
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_automations_tenant_trigger').on(table.tenantId, table.trigger),
])
```

- [ ] **Step 3: Update migration journal**

Add the following entry to `_journal.json` entries array:

```json
{
  "idx": 9,
  "version": "7",
  "when": 1780100000000,
  "tag": "0009_whatsapp_template_mgmt",
  "breakpoints": true
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/db/schema.ts web/src/db/migrations/meta/_journal.json
git commit -m "feat(whatsapp): update schema for template management and automations"
```

---

## Group C (depends on B)

### Task 6: Database Query Functions

**Files:**
- Modify: `web/src/db/queries/whatsapp.ts`

- [ ] **Step 1: Update imports**

Replace the imports at lines 1-8 with:

```typescript
import { db } from '@/db/client'
import {
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  whatsappAutomations,
  sseEvents,
} from '@/db/schema'
import { eq, and, or, desc, gt, ilike, sql } from 'drizzle-orm'
import type { PaginatedResult } from '@/types'
```

- [ ] **Step 2: Add type export for WhatsappAutomation**

After the existing type exports (line 16), add:

```typescript
export type WhatsappAutomation = typeof whatsappAutomations.$inferSelect
```

- [ ] **Step 3: Update upsertTemplate to handle new fields**

Replace the `upsertTemplate` function (lines 336-381) with:

```typescript
export async function upsertTemplate(
  tenantId: string,
  template: {
    metaTemplateId?: string | null
    name: string
    language: string
    category: string
    status: string
    components: unknown
    purposeKey?: string | null
    rejectedReason?: string | null
    blueprintSlug?: string | null
    submittedAt?: Date | null
    variableMapping?: unknown | null
  }
): Promise<WhatsappTemplate> {
  const [existing] = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.name, template.name),
        eq(whatsappTemplates.language, template.language)
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(whatsappTemplates)
      .set({
        metaTemplateId: template.metaTemplateId ?? existing.metaTemplateId,
        category: template.category,
        status: template.status,
        components: template.components,
        rejectedReason: template.rejectedReason ?? null,
        syncedAt: new Date(),
      })
      .where(eq(whatsappTemplates.id, existing.id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(whatsappTemplates)
    .values({
      tenantId,
      metaTemplateId: template.metaTemplateId ?? null,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      components: template.components,
      purposeKey: template.purposeKey ?? null,
      rejectedReason: template.rejectedReason ?? null,
      blueprintSlug: template.blueprintSlug ?? null,
      submittedAt: template.submittedAt ?? null,
      variableMapping: template.variableMapping ?? null,
    })
    .returning()

  return created
}
```

- [ ] **Step 4: Add new template query functions**

Add after `listTemplates` (after line 391), before the SSE EVENTS comment:

```typescript
export async function getTemplateById(
  tenantId: string,
  templateId: string,
): Promise<WhatsappTemplate | null> {
  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.id, templateId)
      )
    )
    .limit(1)
  return template ?? null
}

export async function getTemplateByPurpose(
  tenantId: string,
  purposeKey: string,
): Promise<WhatsappTemplate | null> {
  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.purposeKey, purposeKey)
      )
    )
    .limit(1)
  return template ?? null
}

export async function createLocalTemplate(
  tenantId: string,
  data: {
    metaTemplateId?: string | null
    name: string
    language: string
    category: string
    status: string
    components: unknown
    purposeKey?: string | null
    blueprintSlug?: string | null
    submittedAt?: Date | null
    variableMapping?: unknown | null
  },
): Promise<WhatsappTemplate> {
  const [created] = await db
    .insert(whatsappTemplates)
    .values({
      tenantId,
      metaTemplateId: data.metaTemplateId ?? null,
      name: data.name,
      language: data.language,
      category: data.category,
      status: data.status,
      components: data.components,
      purposeKey: data.purposeKey ?? null,
      blueprintSlug: data.blueprintSlug ?? null,
      submittedAt: data.submittedAt ?? null,
      variableMapping: data.variableMapping ?? null,
    })
    .returning()
  return created
}

export async function updateLocalTemplate(
  tenantId: string,
  templateId: string,
  data: Partial<{
    metaTemplateId: string | null
    status: string
    components: unknown
    rejectedReason: string | null
    purposeKey: string | null
    blueprintSlug: string | null
    submittedAt: Date | null
    variableMapping: unknown | null
    syncedAt: Date
  }>,
): Promise<WhatsappTemplate | null> {
  const [updated] = await db
    .update(whatsappTemplates)
    .set(data)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.id, templateId)
      )
    )
    .returning()
  return updated ?? null
}

export async function deleteLocalTemplate(
  tenantId: string,
  templateId: string,
): Promise<boolean> {
  const result = await db
    .delete(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.id, templateId)
      )
    )
    .returning()
  return result.length > 0
}

// ─── AUTOMATIONS ──────────────────────────────────────────────────

export async function listAutomations(
  tenantId: string,
): Promise<WhatsappAutomation[]> {
  return db
    .select()
    .from(whatsappAutomations)
    .where(eq(whatsappAutomations.tenantId, tenantId))
    .orderBy(whatsappAutomations.trigger)
}

export async function upsertAutomation(
  tenantId: string,
  trigger: string,
  data: {
    enabled?: boolean
    templateId?: string | null
    config?: unknown | null
  },
): Promise<WhatsappAutomation> {
  const [existing] = await db
    .select()
    .from(whatsappAutomations)
    .where(
      and(
        eq(whatsappAutomations.tenantId, tenantId),
        eq(whatsappAutomations.trigger, trigger)
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(whatsappAutomations)
      .set({
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.templateId !== undefined ? { templateId: data.templateId } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
        updatedAt: new Date(),
      })
      .where(eq(whatsappAutomations.id, existing.id))
      .returning()
    return updated
  }

  const [created] = await db
    .insert(whatsappAutomations)
    .values({
      tenantId,
      trigger,
      enabled: data.enabled ?? false,
      templateId: data.templateId ?? null,
      config: data.config ?? null,
    })
    .returning()
  return created
}

export async function getAutomationUsingTemplate(
  tenantId: string,
  templateId: string,
): Promise<WhatsappAutomation | null> {
  const [automation] = await db
    .select()
    .from(whatsappAutomations)
    .where(
      and(
        eq(whatsappAutomations.tenantId, tenantId),
        eq(whatsappAutomations.templateId, templateId),
        eq(whatsappAutomations.enabled, true)
      )
    )
    .limit(1)
  return automation ?? null
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/db/queries/whatsapp.ts
git commit -m "feat(whatsapp): add template CRUD and automation query functions"
```

---

## Group D (depends on C, parallel)

### Task 7: Template List + Sync API Routes

**Files:**
- Modify: `web/src/app/api/whatsapp/templates/route.ts`
- Modify: `web/src/app/api/whatsapp/templates/sync/route.ts`

- [ ] **Step 1: Rewrite templates/route.ts with GET + POST**

```typescript
// web/src/app/api/whatsapp/templates/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listTemplates, createLocalTemplate } from '@/db/queries/whatsapp'
import { createTemplate as createMetaTemplate } from '@/lib/whatsapp'
import { createTemplateSchema } from '@/validations/whatsapp'

async function checkWhatsAppOwner() {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  if (!settings?.whatsapp_enabled) {
    throw new Error('WhatsApp not enabled')
  }
  if (ctx.role !== 'owner') {
    throw new Error('Forbidden')
  }
  return { ctx, tenant: tenant!, settings }
}

export async function GET() {
  try {
    const { ctx } = await checkWhatsAppOwner()
    const templates = await listTemplates(ctx.tenantId)

    // Auto-sync if stale (>5 min since last sync)
    if (templates.length > 0) {
      const mostRecent = templates.reduce((a, b) =>
        new Date(a.syncedAt) > new Date(b.syncedAt) ? a : b
      )
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      if (new Date(mostRecent.syncedAt) < fiveMinAgo) {
        try {
          const { getTemplates: fetchMetaTemplates } = await import('@/lib/whatsapp')
          const { upsertTemplate } = await import('@/db/queries/whatsapp')
          const metaTemplates = await fetchMetaTemplates(ctx.tenantId)
          for (const tpl of metaTemplates) {
            await upsertTemplate(ctx.tenantId, {
              metaTemplateId: tpl.id, name: tpl.name, language: tpl.language,
              category: tpl.category, status: tpl.status, components: tpl.components,
            })
          }
          const refreshed = await listTemplates(ctx.tenantId)
          return NextResponse.json({ data: refreshed })
        } catch {
          // Sync failed silently, return stale data
        }
      }
    }

    return NextResponse.json({ data: templates })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error listing WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { ctx } = await checkWhatsAppOwner()
    const body = await request.json()
    const parsed = createTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, category, language, components, purposeKey, variableMapping } = parsed.data

    const metaResult = await createMetaTemplate(ctx.tenantId, {
      name,
      category,
      language,
      components,
    })

    const template = await createLocalTemplate(ctx.tenantId, {
      metaTemplateId: metaResult.id,
      name,
      language,
      category,
      status: metaResult.status || 'PENDING',
      components,
      purposeKey,
      submittedAt: new Date(),
      variableMapping,
    })

    return NextResponse.json({ data: template }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'WhatsApp not enabled') return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    console.error('Error creating WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Update sync/route.ts to handle new fields**

```typescript
// web/src/app/api/whatsapp/templates/sync/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { upsertTemplate } from '@/db/queries/whatsapp'
import { getTemplates } from '@/lib/whatsapp'

export async function POST() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const metaTemplates = await getTemplates(ctx.tenantId)

    let synced = 0
    for (const tpl of metaTemplates) {
      await upsertTemplate(ctx.tenantId, {
        metaTemplateId: tpl.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: tpl.status,
        components: tpl.components,
        rejectedReason: (tpl as Record<string, unknown>).rejected_reason as string | null ?? null,
      })
      synced++
    }

    return NextResponse.json({ synced })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/whatsapp/templates/route.ts web/src/app/api/whatsapp/templates/sync/route.ts
git commit -m "feat(whatsapp): enhance template list/sync routes, add create route"
```

---

### Task 8: Template CRUD + Provision API Routes

**Files:**
- Create: `web/src/app/api/whatsapp/templates/[id]/route.ts`
- Create: `web/src/app/api/whatsapp/templates/provision/route.ts`

- [ ] **Step 1: Create template [id] route (GET/PATCH/DELETE)**

```typescript
// web/src/app/api/whatsapp/templates/[id]/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getTemplateById,
  updateLocalTemplate,
  deleteLocalTemplate,
  getAutomationUsingTemplate,
} from '@/db/queries/whatsapp'
import {
  getTemplate as getMetaTemplate,
  editTemplate as editMetaTemplate,
  deleteTemplate as deleteMetaTemplate,
} from '@/lib/whatsapp'
import { updateTemplateSchema } from '@/validations/whatsapp'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }

    if (template.metaTemplateId) {
      try {
        const metaData = await getMetaTemplate(ctx.tenantId, template.metaTemplateId)
        await updateLocalTemplate(ctx.tenantId, id, {
          status: metaData.status,
          rejectedReason: metaData.rejected_reason ?? null,
          syncedAt: new Date(),
        })
        const refreshed = await getTemplateById(ctx.tenantId, id)
        return NextResponse.json({ data: refreshed })
      } catch {
        return NextResponse.json({ data: template })
      }
    }

    return NextResponse.json({ data: template })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error fetching WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Apenas templates aprovados podem ser editados' },
        { status: 400 },
      )
    }
    if (!template.metaTemplateId) {
      return NextResponse.json({ error: 'Template sem ID na Meta' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = updateTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await editMetaTemplate(ctx.tenantId, template.metaTemplateId, parsed.data.components)

    const updated = await updateLocalTemplate(ctx.tenantId, id, {
      components: parsed.data.components,
      status: 'PENDING',
      variableMapping: parsed.data.variableMapping ?? template.variableMapping,
      submittedAt: new Date(),
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    console.error('Error updating WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }

    const activeAutomation = await getAutomationUsingTemplate(ctx.tenantId, id)
    if (activeAutomation) {
      return NextResponse.json(
        { error: 'Desative a automação vinculada antes de excluir o template' },
        { status: 400 },
      )
    }

    if (template.metaTemplateId) {
      try {
        await deleteMetaTemplate(ctx.tenantId, template.name)
      } catch (err) {
        console.error('Failed to delete template from Meta:', err)
      }
    }

    await deleteLocalTemplate(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error deleting WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create provision route**

```typescript
// web/src/app/api/whatsapp/templates/provision/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant, updateTenantSettings } from '@/db/queries/tenants'
import { listTemplates, createLocalTemplate, upsertTemplate, updateLocalTemplate } from '@/db/queries/whatsapp'
import { getTemplates, createTemplate as createMetaTemplate } from '@/lib/whatsapp'
import { TEMPLATE_BLUEPRINTS, generateTemplateName } from '@/lib/whatsapp-blueprints'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Ensure template prefix is stored
    let prefix = settings.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      prefix = generateTemplateName(tenant!.name, '').replace(/_$/, '')
      await updateTenantSettings(ctx.tenantId, { whatsapp_template_prefix: prefix })
    }

    const metaTemplates = await getTemplates(ctx.tenantId)
    let synced = 0
    for (const tpl of metaTemplates) {
      await upsertTemplate(ctx.tenantId, {
        metaTemplateId: tpl.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: tpl.status,
        components: tpl.components,
      })
      synced++
    }

    const existingTemplates = await listTemplates(ctx.tenantId)
    const existingPurposeKeys = new Set(
      existingTemplates.map((t) => t.purposeKey).filter(Boolean)
    )

    // Claim existing templates that match blueprint names but lack purposeKey
    for (const blueprint of TEMPLATE_BLUEPRINTS) {
      if (existingPurposeKeys.has(blueprint.purposeKey)) continue
      const expectedName = `${prefix}_${blueprint.name}`
      const match = existingTemplates.find((t) => t.name === expectedName && !t.purposeKey)
      if (match) {
        await updateLocalTemplate(ctx.tenantId, match.id, {
          purposeKey: blueprint.purposeKey,
          blueprintSlug: blueprint.slug,
          variableMapping: blueprint.variables,
        } as Record<string, unknown>)
        existingPurposeKeys.add(blueprint.purposeKey)
      }
    }

    let provisioned = 0
    const errors: Array<{ blueprint: string; error: string }> = []

    for (const blueprint of TEMPLATE_BLUEPRINTS) {
      if (existingPurposeKeys.has(blueprint.purposeKey)) continue

      const templateName = `${prefix}_${blueprint.name}`

      try {
        const metaResult = await createMetaTemplate(ctx.tenantId, {
          name: templateName,
          category: blueprint.category,
          language: blueprint.language,
          components: blueprint.components,
        })

        await createLocalTemplate(ctx.tenantId, {
          metaTemplateId: metaResult.id,
          name: templateName,
          language: blueprint.language,
          category: blueprint.category,
          status: metaResult.status || 'PENDING',
          components: blueprint.components,
          purposeKey: blueprint.purposeKey,
          blueprintSlug: blueprint.slug,
          submittedAt: new Date(),
          variableMapping: blueprint.variables,
        })
        provisioned++

        // Small delay to avoid Meta API rate limits
        await delay(200)
      } catch (err) {
        errors.push({
          blueprint: blueprint.slug,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({ synced, provisioned, errors })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error provisioning WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/whatsapp/templates/\[id\]/route.ts web/src/app/api/whatsapp/templates/provision/route.ts
git commit -m "feat(whatsapp): add template CRUD and provisioning API routes"
```

---

### Task 9: Automations API Routes

**Files:**
- Create: `web/src/app/api/whatsapp/automations/route.ts`
- Create: `web/src/app/api/whatsapp/automations/[trigger]/route.ts`

- [ ] **Step 1: Create automations list route**

```typescript
// web/src/app/api/whatsapp/automations/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const automations = await listAutomations(ctx.tenantId)
    return NextResponse.json({ data: automations })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error listing WhatsApp automations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create automation [trigger] route**

```typescript
// web/src/app/api/whatsapp/automations/[trigger]/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { upsertAutomation } from '@/db/queries/whatsapp'
import { updateAutomationSchema } from '@/validations/whatsapp'

const VALID_TRIGGERS = ['appointment_reminder', 'payment_reminder', 'follow_up']

type RouteParams = { params: Promise<{ trigger: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { trigger } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!VALID_TRIGGERS.includes(trigger)) {
      return NextResponse.json({ error: 'Trigger inválido' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = updateAutomationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const automation = await upsertAutomation(ctx.tenantId, trigger, parsed.data)
    return NextResponse.json({ data: automation })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error updating WhatsApp automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/whatsapp/automations/route.ts web/src/app/api/whatsapp/automations/\[trigger\]/route.ts
git commit -m "feat(whatsapp): add automation API routes"
```

---

## Group E (depends on D, parallel)

### Task 10: Template Management UI Components

**Files:**
- Create: `web/src/components/settings/whatsapp-template-list.tsx`
- Create: `web/src/components/settings/whatsapp-template-editor.tsx`

- [ ] **Step 1: Create template list component**

Create `web/src/components/settings/whatsapp-template-list.tsx`:

A client component that:
- Fetches templates from `GET /api/whatsapp/templates`
- Renders a table/card list with columns: Name, Category (badge), Status (badge), Purpose (label), Last Sync, Actions
- Status badges: `APPROVED` (green), `PENDING` (yellow), `REJECTED` (red), `PAUSED`/`DISABLED` (gray)
- When `REJECTED`, shows rejection reason on hover via tooltip
- Actions: Refresh (⟳), Edit (pencil, only APPROVED), Delete (trash, with confirmation dialog)
- Header bar: "Templates de Mensagem" title + "Sincronizar" button + "Novo Template" button
- Search filter by name
- Status filter dropdown
- Sync button calls `POST /api/whatsapp/templates/sync`
- Delete calls `DELETE /api/whatsapp/templates/[id]`
- Refresh calls `GET /api/whatsapp/templates/[id]` to fetch fresh status
- "Novo Template" and "Edit" open the template editor component
- Uses shadcn Button, Badge, Input, Skeleton components
- Uses lucide icons: RefreshCw, Plus, Pencil, Trash2, Search, FileText
- Shows loading skeleton while fetching
- Shows empty state when no templates

Props:
```typescript
interface WhatsAppTemplateListProps {
  onProvision: () => Promise<void>
}
```

State: templates array, loading, searchQuery, statusFilter, selectedTemplate (for editor), editorOpen

Key UI patterns to follow from existing code:
- Section headers use: `<div className="flex items-center gap-2 mb-1"><h3 className="uppercase tracking-wider text-xs font-medium text-mid">...</h3><div className="flex-1 h-px bg-blush/60" /></div>`
- Borders use `border-[#E8ECEF]`
- Backgrounds use `bg-[#F4F6F8]` for read-only fields
- Text colors: `text-charcoal` (primary), `text-mid` (secondary)
- Cards use `rounded-[3px] border border-[#E8ECEF] bg-white p-4`

Meta status section per template detail:
- Status badge
- "Motivo da rejeição" in red when REJECTED
- "ID na Meta" with metaTemplateId
- "Enviado em" with submittedAt formatted
- "Última sincronização" with syncedAt formatted
- "⟳ Atualizar status" button

- [ ] **Step 2: Create template editor component**

Create `web/src/components/settings/whatsapp-template-editor.tsx`:

A Sheet (side panel) component that:
- Opens for creating new or editing existing templates
- Has two modes: `create` and `edit`

**Editor layout:**
- Template name input (only in create mode, snake_case validation)
- Category selector: radio group UTILITY / MARKETING
- Language selector: dropdown, default pt_BR
- Body textarea with variable insertion dropdown above it
- Variable insertion dropdown: shows predefined variables from `PREDEFINED_VARIABLES`. Clicking inserts `{{N}}` at cursor and adds to mapping table below.
- Variable mapping table below textarea: shows `{{N}} → Label (example)` for each variable used
- Preview panel: shows how the template body looks with example values filled in (chat bubble style)
- "Enviar para aprovação" button (create) or "Salvar alterações" button (edit)
- Loading state during submission

**Variable insertion logic:**
- Track cursor position in textarea
- On variable click: insert `{{nextIndex}}` at cursor, increment counter, add to mapping array
- Display mapping as editable table

Props:
```typescript
interface WhatsAppTemplateEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: WhatsappTemplate | null
  onSaved: () => void
}
```

Uses: Sheet, Button, Input, Textarea, Label, Select from shadcn. Uses react-hook-form + zod for validation.

Create mode: POST to `/api/whatsapp/templates`
Edit mode: PATCH to `/api/whatsapp/templates/[id]`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/whatsapp-template-list.tsx web/src/components/settings/whatsapp-template-editor.tsx
git commit -m "feat(whatsapp): add template list and editor UI components"
```

---

### Task 11: Automations UI Component

**Files:**
- Create: `web/src/components/settings/whatsapp-automations.tsx`

- [ ] **Step 1: Create automations component**

Create `web/src/components/settings/whatsapp-automations.tsx`:

A client component that:
- Fetches automations from `GET /api/whatsapp/automations`
- Fetches approved templates from `GET /api/whatsapp/templates` (filtered client-side to APPROVED only)
- Shows one card per trigger type with:
  - Trigger label (translated to Portuguese)
  - Switch toggle for enabled/disabled
  - Template dropdown (approved templates, filtered by matching purposeKey when available)
  - Trigger-specific config (e.g., "Lembrar X horas antes" for appointment_reminder)
- Saves on toggle change: PATCH to `/api/whatsapp/automations/[trigger]`

Trigger definitions:
```typescript
const TRIGGERS = [
  { key: 'appointment_reminder', label: 'Lembrete de consulta', purposeKey: 'appointment_reminder', configFields: [{ key: 'hoursBeforeAppointment', label: 'Horas antes', type: 'number', default: 24 }] },
  { key: 'payment_reminder', label: 'Lembrete de pagamento', purposeKey: 'payment_reminder', configFields: [{ key: 'daysBeforeDue', label: 'Dias antes do vencimento', type: 'number', default: 3 }] },
  { key: 'follow_up', label: 'Acompanhamento pós-procedimento', purposeKey: 'follow_up', configFields: [{ key: 'daysAfterProcedure', label: 'Dias após procedimento', type: 'number', default: 7 }] },
]
```

Section header: "Mensagens Automáticas" with existing UI pattern.

Uses: Switch, Select, Input, Label, Card from shadcn. Lucide icons: Bell, Clock, MessageSquare.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/settings/whatsapp-automations.tsx
git commit -m "feat(whatsapp): add automations UI component"
```

---

### Task 12: Template Picker Enhancements + Chat Panel Update

**Files:**
- Modify: `web/src/components/whatsapp/template-picker.tsx`
- Modify: `web/src/components/whatsapp/chat-panel.tsx`

- [ ] **Step 1: Enhance template picker**

Replace the entire file with an enhanced version that:

1. **Filters by status** — only shows APPROVED templates
2. **Shows purpose label** — displays `purposeKey` translated to Portuguese alongside name
3. **Variable input** — when a template has `variableMapping`, shows labeled input fields for each variable before sending
4. **Search** — filter by name or purpose (Input at top)
5. **Category grouping** — group by UTILITY / MARKETING with section headers
6. **Two-step flow** — select template → fill variables → send

Key changes from existing:
- Template interface gains: `purposeKey`, `variableMapping`, `id`
- `onSelectTemplate` callback signature changes to include params: `(templateName: string, language: string, params?: Record<string, string>) => void`
- After selecting template, if it has variables, show variable input form in a second step
- Variable inputs use labels from `variableMapping`
- "Voltar" button to go back to template list
- "Enviar" button to send with filled variables

The `fetchTemplates` call stays the same (`GET /api/whatsapp/templates`) but the response now includes extra fields. Filter `templates.filter(t => t.status === 'APPROVED')` client-side.

Purpose key labels:
```typescript
const PURPOSE_LABELS: Record<string, string> = {
  appointment_reminder: 'Lembrete de consulta',
  appointment_confirmation: 'Confirmação de consulta',
  follow_up: 'Acompanhamento',
  reschedule_notification: 'Reagendamento',
  payment_reminder: 'Lembrete de pagamento',
  payment_confirmation: 'Confirmação de pagamento',
  anamnese_link: 'Link de anamnese',
  pre_procedure_instructions: 'Orientações pré-procedimento',
  post_procedure_care: 'Cuidados pós-procedimento',
  document_request: 'Solicitação de documentos',
  birthday_greeting: 'Aniversário',
  reactivation: 'Reativação',
}
```

- [ ] **Step 2: Update chat-panel.tsx to pass template params**

In `web/src/components/whatsapp/chat-panel.tsx`, update the `handleSendTemplate` function to accept an optional third `params` argument and include it in the POST body:

```typescript
// Update the handler to accept params from the enhanced TemplatePicker
async function handleSendTemplate(templateName: string, language: string, params?: Record<string, string>) {
  // ... existing code, but add params to the POST body:
  body: JSON.stringify({ templateName, language, params }),
}
```

Also update the `onSelectTemplate` prop passed to `TemplatePicker` to match the new 3-parameter signature.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/whatsapp/template-picker.tsx web/src/components/whatsapp/chat-panel.tsx
git commit -m "feat(whatsapp): enhance template picker with variables and filtering"
```

---

## Group F (depends on E)

### Task 13: Settings Form Integration

**Files:**
- Modify: `web/src/components/settings/whatsapp-settings-form.tsx`

- [ ] **Step 1: Import and render template + automations sections**

Add imports at the top:
```typescript
import { WhatsAppTemplateList } from './whatsapp-template-list'
import { WhatsAppAutomations } from './whatsapp-automations'
```

After the existing "Ajuda" accordion section (before the submit button div), add the template list and automations sections, wrapped in the same `{enabled && ( ... )}` conditional:

```tsx
{/* Template Management Section */}
<WhatsAppTemplateList
  onProvision={async () => {
    const res = await fetch('/api/whatsapp/templates/provision', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      toast.success(`Sincronizados: ${data.synced}, Provisionados: ${data.provisioned}`)
    } else {
      toast.error(data.error || 'Erro ao provisionar templates')
    }
  }}
/>

{/* Automations Section */}
<WhatsAppAutomations />
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/settings/whatsapp-settings-form.tsx
git commit -m "feat(whatsapp): integrate template management and automations into settings"
```

---

## Post-Implementation

- [ ] **Run full test suite**

```bash
pnpm --filter @floraclin/web test:run
```

- [ ] **Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Run lint**

```bash
pnpm lint
```

- [ ] **Apply migration locally**

```bash
cd web && npx dotenv -e .env.local -- npx drizzle-kit push
```
