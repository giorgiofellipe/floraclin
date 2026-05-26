# WhatsApp Template Management System — Design Spec

## Goal

Full lifecycle management of WhatsApp message templates within FloraClin's multi-tenant SaaS. Tenants create, edit, delete, and track Meta approval status of templates entirely from FloraClin's UI — never needing to touch Meta Business Manager. Platform-level blueprints auto-provision common clinic templates on WABA connection. Templates are bindable to platform actions via `purposeKey` (e.g., "Send via WhatsApp" in Anamnese).

## Architecture

Extends the existing sync-based template model (`whatsappTemplates` table + `upsertTemplate`/`listTemplates` queries). CRUD operations hit the Meta WhatsApp Business Management API first, then update the local DB on success. The local DB acts as a fast cache for the template picker and a record of template lifecycle state. Periodic sync catches out-of-band changes made directly in Meta Business Manager.

A new `whatsappAutomations` table stores per-tenant toggle+config for automated message triggers (appointment reminder, payment reminder, follow-up). The automation layer is decoupled from the template layer — automations reference templates by FK.

**Tech stack:** Next.js App Router API routes, Drizzle ORM, Meta Graph API v21.0, shadcn/ui components.

---

## 1. Data Model

### 1.1 whatsappTemplates (existing table, extended)

New columns added to the existing `floraclin.whatsapp_templates` table:

| Column | Type | Description |
|--------|------|-------------|
| `purpose_key` | `varchar(100)`, nullable | Platform action binding (e.g., `anamnese_link`, `appointment_reminder`). Null for custom/unlinked templates. |
| `rejected_reason` | `text`, nullable | Meta's rejection reason when status is REJECTED. |
| `blueprint_slug` | `varchar(100)`, nullable | Which platform blueprint this template was created from. Null for tenant-created templates. |
| `submitted_at` | `timestamptz`, nullable | When the template was submitted to Meta for approval. |
| `variable_mapping` | `jsonb`, nullable | Maps `{{N}}` positions to variable keys. E.g., `[{"index":1,"key":"patient_name","label":"Nome do paciente"}]` |

New constraint:
- `UNIQUE (tenant_id, purpose_key) WHERE purpose_key IS NOT NULL` — at most one template per purpose per tenant.

Existing columns unchanged: `id`, `tenant_id`, `meta_template_id`, `name`, `language`, `category`, `status`, `components`, `synced_at`, `created_at`.

Existing unique: `(tenant_id, name, language)`.

### 1.2 whatsappAutomations (new table)

```
floraclin.whatsapp_automations
├── id              uuid PK default random
├── tenant_id       uuid FK → tenants, NOT NULL
├── trigger         varchar(50) NOT NULL     — 'appointment_reminder', 'payment_reminder', 'follow_up'
├── enabled         boolean default false
├── template_id     uuid FK → whatsapp_templates, nullable
├── config          jsonb, nullable          — trigger-specific (e.g., { "hoursBeforeAppointment": 24 })
├── created_at      timestamptz default now()
├── updated_at      timestamptz default now()
UNIQUE (tenant_id, trigger)
```

---

## 2. Blueprint Library

### 2.1 Definition

Blueprints are hardcoded TypeScript objects in `web/src/lib/whatsapp-blueprints.ts`. Each blueprint defines a template that can be submitted to Meta on behalf of a tenant.

```typescript
interface TemplateBlueprint {
  slug: string
  purposeKey: string
  name: string               // base name, tenant-prefixed at submit time
  category: 'UTILITY' | 'MARKETING'
  language: string            // default 'pt_BR'
  components: MetaTemplateComponent[]
  variables: TemplateVariable[]
  description: string         // shown in UI
}

interface TemplateVariable {
  index: number               // {{1}}, {{2}}, etc.
  key: string                 // e.g., 'patient_name'
  label: string               // "Nome do paciente"
  example: string             // required by Meta for approval
}
```

### 2.2 Seed Set

**Appointment & Follow-up:**

| Slug | Purpose Key | Category | Body |
|------|------------|----------|------|
| `appointment_reminder` | `appointment_reminder` | UTILITY | "Olá, {{1}}! Lembramos que você tem um atendimento agendado na {{2}} no dia {{3}}, às {{4}}. Caso precise reagendar, entre em contato conosco. Até lá!" |
| `appointment_confirmation` | `appointment_confirmation` | UTILITY | "Olá, {{1}}! Gostaríamos de confirmar sua presença na {{2}} no dia {{3}}, às {{4}}. Por favor, responda *SIM* para confirmar ou *NÃO* para reagendar." |
| `follow_up` | `follow_up` | UTILITY | "Olá, {{1}}! Passando para saber como você está se sentindo após o procedimento de {{2}}. Qualquer dúvida, estamos à disposição! 😊" |
| `reschedule` | `reschedule_notification` | UTILITY | "Olá, {{1}}. Informamos que seu atendimento foi reagendado para o dia {{2}}, às {{3}}. Caso tenha alguma dúvida, estamos à disposição." |

**Financial:**

| Slug | Purpose Key | Category | Body |
|------|------------|----------|------|
| `payment_reminder` | `payment_reminder` | UTILITY | "Olá, {{1}}. Informamos que o pagamento no valor de R$ {{2}} referente ao seu atendimento na {{3}} tem vencimento em {{4}}. Qualquer dúvida, estamos à disposição." |
| `payment_confirmation` | `payment_confirmation` | UTILITY | "Olá, {{1}}! Confirmamos o recebimento do seu pagamento no valor de R$ {{2}}. Agradecemos pela pontualidade! 😊" |

**Operational:**

| Slug | Purpose Key | Category | Body |
|------|------------|----------|------|
| `anamnese_link` | `anamnese_link` | UTILITY | "Olá, {{1}}! Para agilizar seu atendimento na {{2}}, pedimos que preencha sua ficha de anamnese pelo link abaixo:\n\n{{3}}\n\nQualquer dúvida, estamos à disposição." |
| `pre_procedure` | `pre_procedure_instructions` | UTILITY | "Olá, {{1}}! Seu procedimento de {{2}} está se aproximando. Seguem orientações importantes para o preparo:\n\n{{3}}\n\nEm caso de dúvidas, entre em contato conosco." |
| `post_procedure` | `post_procedure_care` | UTILITY | "Olá, {{1}}! Seguem os cuidados recomendados após o seu procedimento de {{2}}:\n\n{{3}}\n\nLembre-se de seguir as orientações para o melhor resultado. Estamos à disposição!" |
| `document_request` | `document_request` | UTILITY | "Olá, {{1}}. Para dar continuidade ao seu atendimento na {{2}}, precisamos dos seguintes documentos:\n\n{{3}}\n\nPor favor, envie assim que possível." |

**Marketing & Engagement:**

| Slug | Purpose Key | Category | Body |
|------|------------|----------|------|
| `birthday` | `birthday_greeting` | MARKETING | "Parabéns, {{1}}! 🎂 Toda a equipe da {{2}} deseja a você um dia muito especial e cheio de alegrias. Conte sempre conosco!" |
| `reactivation` | `reactivation` | MARKETING | "Olá, {{1}}! Sentimos sua falta na {{2}}. 😊 Que tal agendar uma visita? Estamos com novidades que podem te interessar. Aguardamos seu contato!" |

### 2.3 Name Prefixing

Template names on Meta must be unique within a WABA. To avoid collisions, each blueprint's `name` is prefixed with a slug derived from the tenant's clinic name:

- Tenant name: "Clínica Flora" → slug: `clinicaflora`
- Blueprint name: `appointment_reminder` → Meta name: `clinicaflora_appointment_reminder`

The slug is generated once on first provisioning and stored in tenant settings as `whatsapp_template_prefix`.

---

## 3. Meta API Integration

### 3.1 New Functions in `web/src/lib/whatsapp.ts`

**createTemplate(tenantId, payload)**
- `POST /{businessAccountId}/message_templates`
- Payload: `{ name, category, language, components }`
- Returns: `{ id, status, category }`

**editTemplate(tenantId, metaTemplateId, payload)**
- `POST /{metaTemplateId}`
- Only works on APPROVED templates (Meta constraint)
- Payload: `{ components }` — body/header/footer/buttons changes
- Puts template back into PENDING review

**deleteTemplate(tenantId, payload)**
- `DELETE /{businessAccountId}/message_templates?name={name}`
- Removes from Meta entirely

**getTemplate(tenantId, metaTemplateId)**
- `GET /{metaTemplateId}?fields=name,status,category,components,rejected_reason`
- Returns fresh status from Meta for a single template

**syncTemplates(tenantId)** — enhanced existing
- `GET /{businessAccountId}/message_templates?limit=100`
- Upserts all to DB, updates statuses and rejection reasons
- Matches existing templates by `(name, language)` to preserve `purposeKey` and `blueprintSlug`
- Returns `{ synced, updated }`

### 3.2 Sync Triggers

1. **On WABA connection** — full sync + auto-provisioning
2. **Manual "Sincronizar" button** — full sync
3. **Stale check on template list load** — if `syncedAt` of most recent template > 5 minutes, auto-sync in background
4. **Per-template refresh** — `⟳` button fetches single template status from Meta

---

## 4. API Routes

### 4.1 Template CRUD Routes

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/whatsapp/templates` | List all templates for tenant. Returns `purposeKey`, `rejectedReason`, `blueprintSlug`, `variableMapping`, `submittedAt`. Auto-syncs if stale (>5min). | owner |
| `POST` | `/api/whatsapp/templates` | Create new template. Submits to Meta, stores locally with PENDING. Body: `{ name, category, language, components, purposeKey?, variableMapping? }` | owner |
| `GET` | `/api/whatsapp/templates/[id]` | Get single template. Fetches fresh status from Meta, updates local record. | owner |
| `PATCH` | `/api/whatsapp/templates/[id]` | Edit template. Only APPROVED templates. Submits edit to Meta, updates local. Body: `{ components, variableMapping? }` | owner |
| `DELETE` | `/api/whatsapp/templates/[id]` | Delete template. Deletes from Meta and local DB. Blocks if linked to an active automation. | owner |
| `POST` | `/api/whatsapp/templates/sync` | Manual full sync from Meta. (Existing, enhanced.) | owner |
| `POST` | `/api/whatsapp/templates/provision` | Auto-provision all blueprint templates for tenant. | owner |

### 4.2 Automation Routes

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/whatsapp/automations` | List all automation configs for tenant. | owner |
| `PATCH` | `/api/whatsapp/automations/[trigger]` | Update automation toggle/config. Body: `{ enabled, templateId?, config? }` | owner |

### 4.3 Template Picker Route

The existing `GET /api/whatsapp/templates` serves the template picker too, but the picker filters client-side to show only `APPROVED` templates.

---

## 5. Management UI

### 5.1 Settings Page Layout

The existing WhatsApp settings page (`/settings` → WhatsApp section) gets two new sections below the credentials form:

**Section A: Conexão** (existing) — credentials, webhook URL, verify, roles.

**Section B: Templates de Mensagem** (new):
- Header bar: "Templates de Mensagem" + "Sincronizar" + "Novo Template" buttons
- Template list (table or cards)
- Each row shows: name, category badge, status badge, purpose label, last sync time, actions (refresh/edit/delete)
- Status badges: APROVADO (green), PENDENTE (yellow), REJEITADO (red), PAUSADO (gray), DESATIVADO (gray)
- Filter by status, search by name
- Click row or "Ver detalhes" opens template detail

**Section C: Mensagens Automáticas** (new):
- Toggle cards for each automation trigger
- Each card: trigger label, on/off toggle, template dropdown (approved templates with matching purposeKey), trigger-specific config
- Initial triggers: Lembrete de consulta, Lembrete de pagamento, Acompanhamento pós-procedimento

### 5.2 Template Detail/Edit Dialog

Opens as a Sheet (side panel) or large Dialog:

**Left side — Editor:**
- Header section (optional text)
- Body textarea with variable insertion dropdown above
- Footer text (optional)
- Buttons (optional: URL or quick-reply, max 3)
- Category selector (UTILITY / MARKETING)
- Language selector (default pt_BR)
- Variable mapping table below textarea: `{{N}} → Label (example)`

**Right side — Preview:**
- WhatsApp chat bubble mockup showing how the template will render
- Uses example values from variable mapping

**Bottom:**
- "Enviar para aprovação" button (create/edit flow)
- "Cancelar" button

**Variable insertion dropdown** contains predefined variables:

| Key | Label | Example |
|-----|-------|---------|
| `patient_name` | Nome do paciente | Maria Silva |
| `clinic_name` | Nome da clínica | Clínica Flora |
| `appointment_date` | Data da consulta | 15/04/2026 |
| `appointment_time` | Horário | 14:30 |
| `procedure_name` | Procedimento | Botox |
| `amount` | Valor (R$) | 350,00 |
| `due_date` | Data de vencimento | 20/04/2026 |
| `link` | Link | https://... |
| `instructions` | Orientações | Texto livre |

Clicking a variable in the dropdown inserts `{{N}}` at the cursor position in the textarea and adds the mapping entry.

### 5.3 Meta Status Display

Each template detail view shows a "Status na Meta" section:

- **Status**: live badge (APROVADO / PENDENTE / REJEITADO / PAUSADO / DESATIVADO)
- **Motivo da rejeição**: shown prominently in red when REJECTED, with Meta's rejection reason
- **ID na Meta**: `metaTemplateId` for reference
- **Enviado em**: `submittedAt` timestamp
- **Última sincronização**: `syncedAt` timestamp
- **⟳ Atualizar status**: button to fetch fresh status from Meta for this template

---

## 6. Auto-Provisioning Flow

Triggered when a tenant saves valid WABA credentials and verification succeeds:

1. **Sync existing templates** from Meta — captures anything already on the WABA
2. **Match existing templates to blueprints** — by name similarity or purposeKey
3. **For each unmatched blueprint:**
   a. Generate tenant-prefixed name (e.g., `clinicaflora_appointment_reminder`)
   b. Submit to Meta via `createTemplate()`
   c. Store locally with `status: PENDING`, `blueprintSlug`, `purposeKey`
4. **Return summary**: `{ synced: N, provisioned: M }`
5. **Show toast**: "Conexão verificada! Sincronizamos X templates existentes e enviamos Y novos para aprovação da Meta."

The tenant-specific prefix is derived from the clinic name (normalized to lowercase alphanumeric) and stored in tenant settings as `whatsapp_template_prefix`.

---

## 7. Template Picker Enhancements

The existing `TemplatePicker` component in the chat panel gets these improvements:

1. **Filter by status** — only show APPROVED templates
2. **Purpose label** — show the template's purpose alongside its name
3. **Variable input** — when a template has variables, show labeled input fields for each before sending
4. **Search** — filter by name or purpose
5. **Category grouping** — group templates by UTILITY / MARKETING with section headers

---

## 8. Platform Action Integration

Templates with a `purposeKey` can be invoked from platform features:

```typescript
const template = await getTemplateByPurpose(tenantId, 'anamnese_link')
if (!template || template.status !== 'APPROVED') {
  // show "no approved template" feedback
  return
}
await sendTemplateMessage(phoneNumberId, phone, template.name, template.language, params)
```

Initial integration points (future, not in this spec's scope):
- Anamnese page: "Enviar via WhatsApp" button
- Appointment detail: "Enviar lembrete" button
- Financial: "Enviar cobrança" button

These integration points use `getTemplateByPurpose()` to find the tenant's template for that action.

---

## 9. Security

- WABA credentials (`access_token`) are never returned in API responses — masked as `••••{last4}` in settings
- Template CRUD routes require `owner` role
- Template picker (read path) available to `whatsapp_allowed_roles`
- All Meta API calls happen server-side only
- Template names are sanitized before submission (alphanumeric + underscores only)

---

## 10. Error Handling

| Scenario | Handling |
|----------|----------|
| Meta API rate limit (429) | Retry with backoff, show "tente novamente em alguns minutos" |
| Template name already exists on WABA | Show "nome já em uso, escolha outro" |
| Template rejected by Meta | Store rejection reason, show in UI, allow edit + resubmit |
| WABA credentials invalid | Block all template operations, show "verifique suas credenciais" |
| Delete blocked by active automation | Show "desative a automação antes de excluir" |
| Sync fails | Show last successful sync time, allow manual retry |
