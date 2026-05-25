# WhatsApp + CRM Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Meta WhatsApp Cloud API with a chat inbox, CRM kanban pipeline, and AI prospect classification.

**Architecture:** Per-tenant WhatsApp credentials in settings JSONB. Webhook receives messages → stores in DB → creates prospects → classifies via keyword/OpenAI. SSE pushes live updates to the chat UI. CRM kanban tracks prospect lifecycle.

**Tech Stack:** Drizzle ORM, Next.js 16 API routes, react-konva (existing), @dnd-kit/core (new), openai (new), SSE via ReadableStream

**Spec:** `docs/superpowers/specs/2026-05-25-whatsapp-crm-design.md`

---

## Group A (parallel — foundation modules, no shared files)

### Task 1: DB Schema — New Tables

**Files:**
- Modify: `web/src/db/schema.ts`
- Create: `web/supabase/migrations/0007_whatsapp_crm_tables.sql`

Add 5 new tables to the Drizzle schema following existing patterns (`floraclinSchema.table`, UUID PKs, tenant FK, timestamps).

- [ ] **Step 1: Add table definitions to schema.ts**

Append after the existing table definitions in `web/src/db/schema.ts`:

```ts
export const whatsappConversations = floraclinSchema.table('whatsapp_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  phoneNumber: varchar('phone_number', { length: 30 }).notNull(),
  profileName: varchar('profile_name', { length: 255 }),
  prospectId: uuid('prospect_id'),
  patientId: uuid('patient_id'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_wa_conv_tenant_phone').on(table.tenantId, table.phoneNumber),
  index('idx_wa_conv_last_msg').on(table.tenantId, table.lastMessageAt),
])

export const whatsappMessages = floraclinSchema.table('whatsapp_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id),
  direction: varchar('direction', { length: 10 }).notNull(),
  metaMessageId: varchar('meta_message_id', { length: 255 }),
  body: text('body'),
  mediaType: varchar('media_type', { length: 20 }),
  mediaUrl: text('media_url'),
  mediaFilename: varchar('media_filename', { length: 500 }),
  templateName: varchar('template_name', { length: 255 }),
  deliveryStatus: varchar('delivery_status', { length: 20 }).notNull().default('sent'),
  errorCode: varchar('error_code', { length: 50 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_wa_msg_conv_ts').on(table.conversationId, table.timestamp),
  uniqueIndex('idx_wa_msg_meta_id').on(table.metaMessageId).where(sql`meta_message_id IS NOT NULL`),
])

export const prospects = floraclinSchema.table('prospects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }),
  phone: varchar('phone', { length: 30 }).notNull(),
  source: varchar('source', { length: 50 }).notNull().default('whatsapp'),
  stage: varchar('stage', { length: 20 }).notNull().default('novo'),
  intent: varchar('intent', { length: 50 }),
  interestedProcedure: varchar('interested_procedure', { length: 255 }),
  sentiment: varchar('sentiment', { length: 20 }),
  aiTags: jsonb('ai_tags').default([]),
  lostReason: text('lost_reason'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  convertedPatientId: uuid('converted_patient_id').references(() => patients.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_prospects_stage').on(table.tenantId, table.stage),
  uniqueIndex('idx_prospects_phone').on(table.tenantId, table.phone),
])

export const whatsappTemplates = floraclinSchema.table('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  metaTemplateId: varchar('meta_template_id', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  components: jsonb('components').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_wa_tpl_name_lang').on(table.tenantId, table.name, table.language),
])

export const sseEvents = floraclinSchema.table('sse_events', {
  id: serial('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_sse_events_tenant').on(table.tenantId, table.createdAt),
])
```

Add FK references — after the table defs, add self-referencing FKs:
```ts
// In the whatsappConversations definition, the prospectId and patientId FKs
// reference tables defined in the same file. Use .references() pointing to
// prospects.id and patients.id respectively.
```

Note: Since `prospects` is defined after `whatsappConversations`, the FK on `prospectId` needs to use a callback: `.references(() => prospects.id)`. Similarly `patientId` uses `.references(() => patients.id)`.

- [ ] **Step 2: Generate the Drizzle migration**

Run Drizzle Kit to auto-generate the migration from the schema changes:

```bash
pnpm --filter @floraclin/web drizzle-kit generate
```

This generates a migration file in `web/src/db/migrations/`. Verify the generated SQL includes all 5 tables, indexes, and FK constraints. If Drizzle doesn't handle the deferred FK (conversations → prospects), add a manual migration in `web/src/db/migrations/manual/` with the ALTER TABLE.

For reference, the expected SQL should contain:

```sql
-- WhatsApp Conversations
CREATE TABLE IF NOT EXISTS floraclin.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  phone_number VARCHAR(30) NOT NULL,
  profile_name VARCHAR(255),
  prospect_id UUID,
  patient_id UUID,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_inbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_wa_conv_tenant_phone ON floraclin.whatsapp_conversations(tenant_id, phone_number);
CREATE INDEX idx_wa_conv_last_msg ON floraclin.whatsapp_conversations(tenant_id, last_message_at);

-- WhatsApp Messages
CREATE TABLE IF NOT EXISTS floraclin.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  conversation_id UUID NOT NULL REFERENCES floraclin.whatsapp_conversations(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  meta_message_id VARCHAR(255),
  body TEXT,
  media_type VARCHAR(20),
  media_url TEXT,
  media_filename VARCHAR(500),
  template_name VARCHAR(255),
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed')),
  error_code VARCHAR(50),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_msg_conv_ts ON floraclin.whatsapp_messages(conversation_id, "timestamp");
CREATE UNIQUE INDEX idx_wa_msg_meta_id ON floraclin.whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;

-- Prospects
CREATE TABLE IF NOT EXISTS floraclin.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  name VARCHAR(255),
  phone VARCHAR(30) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
  stage VARCHAR(20) NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo', 'contatado', 'qualificado', 'agendado', 'convertido', 'perdido')),
  intent VARCHAR(50),
  interested_procedure VARCHAR(255),
  sentiment VARCHAR(20),
  ai_tags JSONB DEFAULT '[]',
  lost_reason TEXT,
  assigned_user_id UUID REFERENCES floraclin.users(id),
  converted_patient_id UUID REFERENCES floraclin.patients(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_prospects_stage ON floraclin.prospects(tenant_id, stage);
CREATE UNIQUE INDEX idx_prospects_phone ON floraclin.prospects(tenant_id, phone) WHERE deleted_at IS NULL;

-- Add FK from conversations to prospects (defined after prospects table exists)
ALTER TABLE floraclin.whatsapp_conversations
  ADD CONSTRAINT fk_wa_conv_prospect FOREIGN KEY (prospect_id) REFERENCES floraclin.prospects(id),
  ADD CONSTRAINT fk_wa_conv_patient FOREIGN KEY (patient_id) REFERENCES floraclin.patients(id);

-- WhatsApp Templates
CREATE TABLE IF NOT EXISTS floraclin.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  meta_template_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  language VARCHAR(10) NOT NULL,
  category VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  components JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_wa_tpl_name_lang ON floraclin.whatsapp_templates(tenant_id, name, language);

-- SSE Events (lightweight signaling table)
CREATE TABLE IF NOT EXISTS floraclin.sse_events (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sse_events_tenant ON floraclin.sse_events(tenant_id, created_at);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/db/schema.ts web/src/db/migrations/
git commit -m "feat(schema): add whatsapp conversations, messages, prospects, templates tables"
```

---

### Task 2: Validation Schemas

**Files:**
- Create: `web/src/validations/whatsapp.ts`
- Create: `web/src/validations/prospect.ts`

- [ ] **Step 1: Create WhatsApp validation schemas**

```ts
// web/src/validations/whatsapp.ts
import { z } from 'zod'

export const sendMessageSchema = z.object({
  body: z.string().min(1, 'Mensagem é obrigatória').max(4096),
})

export const sendTemplateSchema = z.object({
  templateName: z.string().min(1),
  language: z.string().default('pt_BR'),
  params: z.record(z.string()).optional(),
})

export const sendMediaSchema = z.object({
  mediaType: z.enum(['image', 'document', 'audio', 'video']),
  mediaUrl: z.string().url(),
  caption: z.string().max(1024).optional(),
})

export const whatsappSettingsSchema = z.object({
  whatsapp_enabled: z.boolean(),
  whatsapp_phone_number_id: z.string().min(1, 'Phone Number ID é obrigatório'),
  whatsapp_business_account_id: z.string().min(1, 'Business Account ID é obrigatório'),
  whatsapp_access_token: z.string().min(1, 'Access Token é obrigatório'),
  whatsapp_allowed_roles: z.array(z.enum(['owner', 'practitioner', 'receptionist', 'financial'])),
})

export const conversationFilterSchema = z.object({
  search: z.string().optional(),
  filter: z.enum(['all', 'unread', 'prospects', 'patients']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type SendTemplateInput = z.infer<typeof sendTemplateSchema>
export type WhatsAppSettings = z.infer<typeof whatsappSettingsSchema>
```

- [ ] **Step 2: Create Prospect validation schemas**

```ts
// web/src/validations/prospect.ts
import { z } from 'zod'

export const PROSPECT_STAGES = ['novo', 'contatado', 'qualificado', 'agendado', 'convertido', 'perdido'] as const
export type ProspectStage = (typeof PROSPECT_STAGES)[number]

export const updateProspectSchema = z.object({
  stage: z.enum(PROSPECT_STAGES).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  lostReason: z.string().max(500).optional(),
})

export const convertProspectSchema = z.object({
  patientId: z.string().uuid().optional(),
  createPatient: z.object({
    fullName: z.string().min(1),
    phone: z.string().min(1),
  }).optional(),
}).refine(
  (data) => data.patientId || data.createPatient,
  { message: 'Selecione um paciente ou crie um novo' },
)

export const prospectFilterSchema = z.object({
  stage: z.enum(PROSPECT_STAGES).optional(),
  search: z.string().optional(),
  assignedUserId: z.string().uuid().optional(),
})

export type UpdateProspectInput = z.infer<typeof updateProspectSchema>
export type ConvertProspectInput = z.infer<typeof convertProspectSchema>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/validations/whatsapp.ts web/src/validations/prospect.ts
git commit -m "feat(validation): add whatsapp and prospect schemas"
```

---

### Task 3: WhatsApp API Client

**Files:**
- Create: `web/src/lib/whatsapp.ts`
- Create: `web/src/lib/__tests__/whatsapp.test.ts`

- [ ] **Step 1: Create the WhatsApp API client**

```ts
// web/src/lib/whatsapp.ts
import crypto from 'crypto'
import { getTenant } from '@/db/queries/tenants'

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface WhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
  businessAccountId: string
}

async function getCredentials(tenantId: string): Promise<WhatsAppCredentials> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('Tenant not found')
  const settings = tenant.settings as Record<string, unknown> | null
  if (!settings?.whatsapp_enabled) throw new Error('WhatsApp not enabled')
  const phoneNumberId = settings.whatsapp_phone_number_id as string
  const accessToken = settings.whatsapp_access_token as string
  const businessAccountId = settings.whatsapp_business_account_id as string
  if (!phoneNumberId || !accessToken) throw new Error('WhatsApp credentials missing')
  return { phoneNumberId, accessToken, businessAccountId }
}

async function graphFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) {
    const errorMsg = data?.error?.message ?? 'Unknown Meta API error'
    throw new Error(`Meta API error: ${errorMsg}`)
  }
  return data
}

export async function sendTextMessage(tenantId: string, to: string, body: string) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function sendTemplateMessage(
  tenantId: string,
  to: string,
  templateName: string,
  language: string,
  params?: Record<string, string>,
) {
  const creds = await getCredentials(tenantId)
  const components = params
    ? [{ type: 'body', parameters: Object.values(params).map((v) => ({ type: 'text', text: v })) }]
    : undefined
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language }, components },
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function sendMediaMessage(
  tenantId: string,
  to: string,
  mediaType: 'image' | 'document' | 'audio' | 'video',
  mediaUrl: string,
  caption?: string,
) {
  const creds = await getCredentials(tenantId)
  const mediaPayload: Record<string, string> = { link: mediaUrl }
  if (caption) mediaPayload.caption = caption
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: mediaType,
      [mediaType]: mediaPayload,
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function getTemplates(tenantId: string) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates?limit=100`,
    creds.accessToken,
  )
  return (data.data ?? []) as Array<{
    id: string
    name: string
    language: string
    category: string
    status: string
    components: unknown[]
  }>
}

export async function downloadAndStoreMedia(
  tenantId: string,
  mediaId: string,
  filename: string,
): Promise<{ storedUrl: string; mimeType: string }> {
  const creds = await getCredentials(tenantId)
  const meta = await graphFetch(`/${mediaId}`, creds.accessToken)
  const mediaUrl = meta.url as string
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to download media')
  const buffer = Buffer.from(await res.arrayBuffer())
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'

  // Upload to Supabase Storage (tenant-scoped path)
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const path = `whatsapp/${tenantId}/${mediaId}/${filename}`
  const { error } = await supabase.storage
    .from('media')
    .upload(path, buffer, { contentType: mimeType, upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
  return { storedUrl: urlData.publicUrl, mimeType }
}

export async function verifyCredentials(phoneNumberId: string, token: string) {
  try {
    const data = await graphFetch(`/${phoneNumberId}`, token)
    return { valid: true, phoneDisplay: data.display_phone_number as string | undefined }
  } catch {
    return { valid: false, phoneDisplay: undefined }
  }
}

export function verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
  const expectedBuf = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}
```

- [ ] **Step 2: Write tests for verifyWebhookSignature and verifyCredentials**

```ts
// web/src/lib/__tests__/whatsapp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyWebhookSignature } from '../whatsapp'

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const crypto = require('crypto')
    const secret = 'test-secret'
    const payload = '{"test":"data"}'
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyWebhookSignature(payload, `sha256=${hmac}`, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    expect(verifyWebhookSignature('payload', 'sha256=invalid', 'secret')).toBe(false)
  })

  it('returns false for mismatched length signature', () => {
    expect(verifyWebhookSignature('payload', 'sha256=short', 'secret')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/lib/__tests__/whatsapp.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/whatsapp.ts web/src/lib/__tests__/whatsapp.test.ts
git commit -m "feat(whatsapp): add Meta Cloud API client with signature verification"
```

---

### Task 4: AI Classification Module

**Files:**
- Create: `web/src/lib/classify-prospect.ts`
- Create: `web/src/lib/__tests__/classify-prospect.test.ts`

- [ ] **Step 1: Install openai package**

Run: `pnpm --filter @floraclin/web add openai`

- [ ] **Step 2: Create the classification module**

```ts
// web/src/lib/classify-prospect.ts

interface ClassificationResult {
  intent: 'inquiry' | 'scheduling' | 'complaint' | 'followup' | 'other'
  interestedProcedure: string | null
  sentiment: 'positive' | 'neutral' | 'negative'
  extractedName: string | null
}

const KEYWORD_PATTERNS: { patterns: RegExp; intent: ClassificationResult['intent'] }[] = [
  { patterns: /pre[çc]o|quanto custa|valor|tabela|investimento/i, intent: 'inquiry' },
  { patterns: /agendar|marcar|hor[áa]rio|disponibilidade|agenda/i, intent: 'scheduling' },
  { patterns: /reclama[çc][ãa]o|problema|insatisf|ruim|p[ée]ssimo/i, intent: 'complaint' },
  { patterns: /retorno|voltar|revis[ãa]o|p[óo]s/i, intent: 'followup' },
]

export function classifyByKeywords(
  message: string,
  procedureNames: string[],
): Partial<ClassificationResult> | null {
  const lower = message.toLowerCase()

  let intent: ClassificationResult['intent'] | null = null
  for (const { patterns, intent: matchIntent } of KEYWORD_PATTERNS) {
    if (patterns.test(lower)) {
      intent = matchIntent
      break
    }
  }

  let interestedProcedure: string | null = null
  for (const name of procedureNames) {
    if (lower.includes(name.toLowerCase())) {
      interestedProcedure = name
      break
    }
  }

  if (!intent && !interestedProcedure) return null

  return {
    intent: intent ?? 'inquiry',
    interestedProcedure,
  }
}

export async function classifyWithOpenAI(message: string): Promise<ClassificationResult> {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are a classifier for a Brazilian dental/aesthetic clinic. Analyze the WhatsApp message and return JSON:
{
  "intent": "inquiry" | "scheduling" | "complaint" | "followup" | "other",
  "interestedProcedure": "string or null",
  "sentiment": "positive" | "neutral" | "negative",
  "extractedName": "string or null"
}
Respond ONLY with the JSON object, no other text.`,
      },
      { role: 'user', content: message },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim() ?? '{}'
  try {
    return JSON.parse(text) as ClassificationResult
  } catch {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }
}

export async function classifyMessage(
  message: string,
  procedureNames: string[],
): Promise<ClassificationResult> {
  const keywordResult = classifyByKeywords(message, procedureNames)
  if (keywordResult?.intent) {
    return {
      intent: keywordResult.intent,
      interestedProcedure: keywordResult.interestedProcedure ?? null,
      sentiment: 'neutral',
      extractedName: null,
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }

  try {
    return await classifyWithOpenAI(message)
  } catch {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }
}
```

- [ ] **Step 3: Write tests for keyword classification**

```ts
// web/src/lib/__tests__/classify-prospect.test.ts
import { describe, it, expect } from 'vitest'
import { classifyByKeywords } from '../classify-prospect'

describe('classifyByKeywords', () => {
  const procedures = ['Botox', 'Preenchimento', 'Limpeza de Pele']

  it('detects price inquiry', () => {
    const result = classifyByKeywords('Quanto custa o botox?', procedures)
    expect(result).not.toBeNull()
    expect(result?.intent).toBe('inquiry')
    expect(result?.interestedProcedure).toBe('Botox')
  })

  it('detects scheduling intent', () => {
    const result = classifyByKeywords('Gostaria de agendar uma consulta', procedures)
    expect(result?.intent).toBe('scheduling')
  })

  it('detects complaint', () => {
    const result = classifyByKeywords('Tenho uma reclamação sobre o atendimento', procedures)
    expect(result?.intent).toBe('complaint')
  })

  it('detects followup', () => {
    const result = classifyByKeywords('Quero marcar meu retorno', procedures)
    expect(result?.intent).toBe('scheduling')
  })

  it('detects procedure without intent keyword', () => {
    const result = classifyByKeywords('Vi que vocês fazem preenchimento', procedures)
    expect(result?.interestedProcedure).toBe('Preenchimento')
    expect(result?.intent).toBe('inquiry')
  })

  it('returns null when no match', () => {
    const result = classifyByKeywords('Olá, bom dia!', procedures)
    expect(result).toBeNull()
  })

  it('is case-insensitive', () => {
    const result = classifyByKeywords('QUANTO CUSTA?', procedures)
    expect(result?.intent).toBe('inquiry')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @floraclin/web test:run -- --reporter verbose web/src/lib/__tests__/classify-prospect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/classify-prospect.ts web/src/lib/__tests__/classify-prospect.test.ts
git commit -m "feat(ai): add prospect classification with keyword matching and OpenAI fallback"
```

---

## Group B (depends on A — parallel within group)

### Task 5: WhatsApp Query Functions

**Files:**
- Create: `web/src/db/queries/whatsapp.ts`

- [ ] **Step 1: Create WhatsApp query module**

Implement all DB operations for conversations, messages, templates, and SSE events. Follow existing patterns from `queries/patients.ts`: tenant isolation via `eq(table.tenantId, tenantId)`, typed return values, pagination support.

Key functions:
```ts
// Conversations
export async function upsertConversation(tenantId, phoneNumber, profileName?, prospectId?, patientId?)
export async function getConversation(tenantId, conversationId)
export async function getConversationByPhone(tenantId, phoneNumber)
export async function listConversations(tenantId, { search, filter, page, limit })
export async function markConversationRead(tenantId, conversationId)
export async function updateConversationLinks(tenantId, conversationId, { prospectId?, patientId? })

// Messages
export async function createMessage(tenantId, conversationId, data)
export async function getMessageByMetaId(tenantId, metaMessageId)
export async function updateMessageStatus(tenantId, metaMessageId, status, errorCode?)
export async function listMessages(tenantId, conversationId, { page, limit })

// Templates
export async function upsertTemplate(tenantId, template)
export async function listTemplates(tenantId)

// SSE Events
export async function pushSseEvent(tenantId, eventType, payload)
export async function pollSseEvents(tenantId, sinceId)
export async function cleanupSseEvents()

// Stats
export async function getUnreadCount(tenantId): Promise<number>
```

Each function uses `db.select()`, `db.insert()`, `db.update()` from Drizzle with tenant-scoped conditions.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/db/queries/whatsapp.ts
git commit -m "feat(queries): add whatsapp conversation, message, template, and SSE queries"
```

---

### Task 6: Prospect Query Functions

**Files:**
- Create: `web/src/db/queries/prospects.ts`

- [ ] **Step 1: Create Prospect query module**

Key functions:
```ts
export type Prospect = typeof prospects.$inferSelect

export async function createProspect(tenantId, { phone, name?, source? })
export async function getProspect(tenantId, prospectId)
export async function getProspectByPhone(tenantId, phone)
export async function listProspects(tenantId, { stage?, search?, assignedUserId? })
export async function updateProspect(tenantId, prospectId, data)
export async function convertProspect(tenantId, prospectId, patientId)
export async function getProspectStats(tenantId): Promise<Record<ProspectStage, number>>
```

`listProspects` returns all non-deleted prospects grouped-ready (no pagination — kanban loads all). `convertProspect` sets `convertedPatientId`, `stage = 'convertido'`, and soft-deletes. `getProspectStats` returns counts per stage for the header bar.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/db/queries/prospects.ts
git commit -m "feat(queries): add prospect CRUD and pipeline stage queries"
```

---

## Group C (depends on B — parallel within group)

### Task 7: Webhook Endpoint

**Files:**
- Create: `web/src/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Implement webhook handler**

Handles:
- `GET`: Meta verification challenge — compare `hub.verify_token` with `process.env.WHATSAPP_VERIFY_TOKEN`
- `POST`: Validate `X-Hub-Signature-256`, parse payload, route to tenant by phone number ID lookup, process messages and status updates

The POST handler must respond 200 quickly. Heavy work (AI classification, media download) runs after the response using `waitUntil`-style patterns or inline after `NextResponse` is prepared.

Since Next.js API routes don't have `waitUntil`, use `Promise.resolve().then(() => { ... })` for fire-and-forget async work after returning the response.

Key processing logic:
1. Look up tenant by querying tenants where `settings->>'whatsapp_phone_number_id'` matches the incoming phone number ID. Use a direct Drizzle `sql` query with JSONB operator — do NOT iterate all tenants in JS.
2. For each message entry: upsert conversation, create message record, create prospect if new number
3. For status updates: update message delivery status
4. Push SSE events: `new_message` for inbound messages, `new_conversation` for first messages, `status_update` for delivery updates, `prospect_updated` after AI classification completes
5. Fire-and-forget: AI classification for new prospects, media download + Supabase Storage upload for media messages
6. Unknown phone number IDs → return 200 immediately (don't discard silently — log a warning)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/webhooks/whatsapp/route.ts
git commit -m "feat(webhook): add Meta WhatsApp webhook receiver with signature verification"
```

---

### Task 8: SSE Endpoint

**Files:**
- Create: `web/src/app/api/whatsapp/stream/route.ts`

- [ ] **Step 1: Implement SSE endpoint**

```ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { pollSseEvents, cleanupSseEvents } from '@/db/queries/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  if (!settings?.whatsapp_enabled) {
    return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
  }

  const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let lastEventId = 0
  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const poll = async () => {
        try {
          const events = await pollSseEvents(ctx.tenantId, lastEventId)
          for (const event of events) {
            send(event.eventType, event.payload)
            if (event.id > lastEventId) lastEventId = event.id
          }
          await cleanupSseEvents()
        } catch { /* connection closed */ }
      }

      // Heartbeat + poll every 2 seconds
      interval = setInterval(async () => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          await poll()
        } catch {
          clearInterval(interval)
        }
      }, 2000)

      // Initial poll
      await poll()

      controller.enqueue(encoder.encode(': connected\n\n'))
    },
    cancel() {
      if (interval) clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/whatsapp/stream/route.ts
git commit -m "feat(sse): add server-sent events endpoint for real-time whatsapp updates"
```

---

### Task 9: Conversation API Routes

**Files:**
- Create: `web/src/app/api/whatsapp/conversations/route.ts`
- Create: `web/src/app/api/whatsapp/conversations/[id]/messages/route.ts`
- Create: `web/src/app/api/whatsapp/conversations/[id]/route.ts`

Standard REST endpoints following the existing pattern from `api/patients/route.ts`:
- `GET /api/whatsapp/conversations` — list with filters
- `GET /api/whatsapp/conversations/[id]/messages` — paginated messages
- `POST /api/whatsapp/conversations/[id]/messages` — send message (text/template/media)
- `PATCH /api/whatsapp/conversations/[id]` — mark read, archive

All endpoints: auth via `getAuthContext()`, role check against `whatsapp_allowed_roles`, tenant isolation. Send message also creates the outbound message record and pushes SSE event.

- [ ] **Step 1-4: Implement routes, run typecheck, commit**

```bash
git commit -m "feat(api): add whatsapp conversation and message endpoints"
```

---

### Task 10: Prospect API Routes

**Files:**
- Create: `web/src/app/api/crm/prospects/route.ts`
- Create: `web/src/app/api/crm/prospects/[id]/route.ts`
- Create: `web/src/app/api/crm/prospects/[id]/convert/route.ts`

- `GET /api/crm/prospects` — list with stage/search/assigned filters
- `GET /api/crm/prospects/[id]` — detail
- `PATCH /api/crm/prospects/[id]` — update stage, assign, notes
- `DELETE /api/crm/prospects/[id]` — soft-delete (sets `deletedAt`)
- `POST /api/crm/prospects/[id]/convert` — convert to patient (link existing or create new)

Convert endpoint: receives either `patientId` (link existing) or `createPatient: { fullName, phone }` (create new). Updates prospect, conversation FK, audit log.

All mutating endpoints (`PATCH`, `DELETE`, `POST /convert`) must push SSE `prospect_updated` events via `pushSseEvent()` so the CRM kanban updates in real-time.

- [ ] **Step 1-4: Implement routes, run typecheck, commit**

```bash
git commit -m "feat(api): add CRM prospect CRUD and conversion endpoints"
```

---

### Task 11: Template API Routes

**Files:**
- Create: `web/src/app/api/whatsapp/templates/route.ts`
- Create: `web/src/app/api/whatsapp/templates/sync/route.ts`

- `GET /api/whatsapp/templates` — list cached templates
- `POST /api/whatsapp/templates/sync` — fetch from Meta API, upsert in DB

Owner-only endpoints.

- [ ] **Step 1-4: Implement routes, run typecheck, commit**

```bash
git commit -m "feat(api): add whatsapp template list and sync endpoints"
```

---

## Group D (depends on C — parallel within group)

### Task 12: Settings UI — WhatsApp Config Tab

**Files:**
- Create: `web/src/components/settings/whatsapp-settings-form.tsx`
- Modify: `web/src/app/(platform)/configuracoes/settings-page-client.tsx`

Add a new "WhatsApp" tab to the existing settings page. The form includes:
- Enable toggle
- Phone Number ID, Business Account ID, Access Token (masked with `••••{last4}`) inputs
- "Testar conexão" button (calls `verifyCredentials`)
- Webhook URL (read-only, copyable): `https://app.floraclin.com/api/webhooks/whatsapp`
- Verify Token (read-only, copyable): displays the global `WHATSAPP_VERIFY_TOKEN` from a server-side API
- Allowed roles checkboxes (owner, practitioner, receptionist, financial)
- Expandable accordion: "Como configurar o WhatsApp Business API" with step-by-step setup guide
- Template management sub-section (list + sync button)

Follow the existing settings form patterns (React Hook Form + Zod). Use `updateTenantSettings()` from `db/queries/tenants.ts` to merge WhatsApp settings into the existing JSONB.

- [ ] **Step 1-4: Implement component, add to settings tabs, run typecheck, commit**

```bash
git commit -m "feat(settings): add whatsapp integration configuration tab"
```

---

### Task 13: Chat UI Page

**Files:**
- Create: `web/src/app/(platform)/whatsapp/page.tsx`
- Create: `web/src/components/whatsapp/conversation-list.tsx`
- Create: `web/src/components/whatsapp/chat-panel.tsx`
- Create: `web/src/components/whatsapp/message-bubble.tsx`
- Create: `web/src/components/whatsapp/template-picker.tsx`
- Create: `web/src/hooks/use-whatsapp-sse.ts`

**Empty state:** When WhatsApp is not configured for the tenant, `/whatsapp` shows a setup prompt: "Configure o WhatsApp para começar" with a link to `/configuracoes` settings. Check `tenant.settings.whatsapp_enabled` on load.

Full-page chat layout:
- Left sidebar: `ConversationList` — search, filter tabs (all/unread/prospects/patients), conversation cards with unread badges
- Right panel: `ChatPanel` — message history with auto-scroll, input area with 24h window check (if `now - lastInboundAt > 24h`, disable free text, show "Janela expirada — use um template" with template picker button)
- Chat header buttons: "Marcar como lido" (calls PATCH mark read), "Ver paciente" (if linked to patient — navigates to patient detail), "Converter" (if prospect — opens conversion modal)
- `MessageBubble` — inbound/outbound styling, delivery status indicators (✓, ✓✓, read), media previews
- `TemplatePicker` — modal listing approved templates with parameter fill
- `useWhatsappSse` hook — manages EventSource connection, dispatches events to conversation/message state, also listens for `prospect_updated` events

SSE hook pattern:
```ts
export function useWhatsappSse(onMessage, onStatusUpdate, onNewConversation) {
  useEffect(() => {
    const es = new EventSource('/api/whatsapp/stream')
    es.addEventListener('new_message', (e) => onMessage(JSON.parse(e.data)))
    es.addEventListener('status_update', (e) => onStatusUpdate(JSON.parse(e.data)))
    es.addEventListener('new_conversation', (e) => onNewConversation(JSON.parse(e.data)))
    return () => es.close()
  }, [])
}
```

- [ ] **Step 1-6: Implement all components, wire up SSE, run typecheck, commit**

```bash
git commit -m "feat(ui): add whatsapp chat inbox page with real-time SSE updates"
```

---

### Task 14: CRM Kanban Page

**Files:**
- Create: `web/src/app/(platform)/crm/page.tsx`
- Create: `web/src/components/crm/kanban-board.tsx`
- Create: `web/src/components/crm/prospect-card.tsx`
- Create: `web/src/components/crm/prospect-detail-panel.tsx`
- Create: `web/src/components/crm/convert-prospect-modal.tsx`

Install `@dnd-kit/core` and `@dnd-kit/sortable` for drag-and-drop.

Kanban board with 6 columns. Each column renders prospect cards. Drag-and-drop moves prospects between stages (calls `PATCH /api/crm/prospects/[id]`).

`ProspectCard`: name, phone, intent badge, procedure interest, time since first contact (computed from `createdAt`), assigned user avatar.

`ProspectDetailPanel`: slide-over panel with full prospect info, conversation link, assign dropdown, notes, stage dropdown, convert/lost buttons.

`ConvertProspectModal`: two tabs — search existing patient or create new. Pre-fills name/phone.

Header stats bar: stage counts + conversion rate.

- [ ] **Step 1-6: Install dnd-kit, implement components, run typecheck, commit**

```bash
pnpm --filter @floraclin/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
git commit -m "feat(ui): add CRM kanban board with drag-and-drop prospect pipeline"
```

---

### Task 15: Sidebar & Navigation Updates

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx`

Add WhatsApp and CRM nav items. Conditionally show based on tenant's `whatsapp_enabled` setting and role-based access.

```ts
// Add to navigation items (conditionally rendered):
{ href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, badge: unreadCount }
{ href: '/crm', label: 'CRM', icon: Funnel }
```

The sidebar needs to:
1. Fetch tenant settings to check `whatsapp_enabled`
2. Check user role against `whatsapp_allowed_roles`
3. Fetch unread count for the WhatsApp badge
4. Only render the items if both conditions pass

- [ ] **Step 1-3: Add nav items, role checks, unread badge, commit**

```bash
git commit -m "feat(nav): add whatsapp and crm sidebar items with role-based visibility"
```
