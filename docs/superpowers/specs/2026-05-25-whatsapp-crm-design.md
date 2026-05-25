# WhatsApp Integration + CRM Pipeline — Design Spec

## Overview

Integrate Meta's official WhatsApp Cloud API into FloraClin as a per-clinic feature. Each clinic connects their own WhatsApp Business number by providing API credentials in settings. The integration provides two user-facing modules:

1. **WhatsApp Chat** (`/whatsapp`) — a WhatsApp-Web-style inbox for reading and replying to patient messages
2. **CRM Pipeline** (`/crm`) — a Kanban board that tracks prospects from first contact to patient conversion

Unknown phone numbers that message the clinic are automatically created as prospects, classified by AI (keyword matching with OpenAI fallback), and flow through a 6-stage pipeline. Converted prospects become linked to existing or new patient records.

---

## 1. Data Model

### New Tables

#### `whatsapp_conversations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenantId` | UUID FK → tenants | Tenant isolation |
| `phoneNumber` | text | Contact's phone number (E.164 format) |
| `profileName` | text nullable | WhatsApp profile name from Meta payload |
| `prospectId` | UUID FK → prospects nullable | Before conversion |
| `patientId` | UUID FK → patients nullable | After conversion or if existing patient |
| `lastMessageAt` | timestamptz | Timestamp of last message (inbound or outbound) |
| `lastInboundAt` | timestamptz nullable | Timestamp of last inbound message — used for 24h window calc |
| `unreadCount` | integer default 0 | Unread inbound messages |
| `status` | text default 'active' | `active` or `archived` |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

Indexes: `(tenantId, phoneNumber)` unique, `(tenantId, lastMessageAt DESC)` for conversation list ordering.

#### `whatsapp_messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenantId` | UUID FK → tenants | |
| `conversationId` | UUID FK → whatsapp_conversations | |
| `direction` | text | `inbound` or `outbound` |
| `metaMessageId` | text nullable | Meta's message ID for deduplication and status tracking |
| `body` | text nullable | Text content |
| `mediaType` | text nullable | `image`, `video`, `audio`, `document`, `sticker` |
| `mediaUrl` | text nullable | URL to media file (downloaded from Meta and stored in Supabase Storage) |
| `mediaFilename` | text nullable | Original filename for documents |
| `templateName` | text nullable | If sent as a template message |
| `deliveryStatus` | text default 'sent' | `sent`, `delivered`, `read`, `failed` |
| `errorCode` | text nullable | Meta error code if failed |
| `timestamp` | timestamptz | Message timestamp from Meta (inbound) or send time (outbound) |
| `createdAt` | timestamptz | |

Indexes: `(conversationId, timestamp)` for chat history, `(metaMessageId)` unique for dedup.

#### `prospects`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenantId` | UUID FK → tenants | |
| `name` | text nullable | From WhatsApp profile or AI extraction |
| `phone` | text | E.164 format |
| `source` | text default 'whatsapp' | Lead source |
| `stage` | text default 'novo' | `novo`, `contatado`, `qualificado`, `agendado`, `convertido`, `perdido` |
| `intent` | text nullable | AI-classified: `inquiry`, `scheduling`, `complaint`, `followup`, `other` |
| `interestedProcedure` | text nullable | AI-extracted procedure interest |
| `sentiment` | text nullable | `positive`, `neutral`, `negative` |
| `aiTags` | jsonb default '[]' | Additional AI-extracted tags |
| `lostReason` | text nullable | Reason when moved to `perdido` |
| `assignedUserId` | UUID FK → users nullable | Staff member assigned to this prospect |
| `convertedPatientId` | UUID FK → patients nullable | Set on conversion |
| `notes` | text nullable | Staff notes |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |
| `deletedAt` | timestamptz nullable | Soft delete on conversion |

Indexes: `(tenantId, stage)` for kanban queries, `(tenantId, phone)` unique for dedup.

#### `whatsapp_templates`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenantId` | UUID FK → tenants | |
| `metaTemplateId` | text | Meta's template ID |
| `name` | text | Template name |
| `language` | text | e.g. `pt_BR` |
| `category` | text | `UTILITY`, `MARKETING`, `AUTHENTICATION` |
| `status` | text | `APPROVED`, `PENDING`, `REJECTED` |
| `components` | jsonb | Template structure (header, body, footer, buttons) |
| `syncedAt` | timestamptz | Last sync from Meta |
| `createdAt` | timestamptz | |

Index: `(tenantId, name, language)` unique.

### Modified Tables

#### `tenants.settings` (JSONB additions)

```ts
{
  // ... existing settings ...
  whatsapp_enabled: boolean
  whatsapp_phone_number_id: string
  whatsapp_business_account_id: string
  whatsapp_access_token: string        // encrypted at rest
  whatsapp_allowed_roles: string[]     // e.g. ['owner', 'receptionist']
}
```

---

## 2. WhatsApp API Integration Layer

### Webhook Endpoint

**Route:** `POST /api/webhooks/whatsapp`

- **Public** — no auth middleware. Verification via:
  1. `GET` requests: Meta webhook verification challenge (compare `hub.verify_token` with global env var `WHATSAPP_VERIFY_TOKEN` — single webhook URL for all tenants)
  2. `POST` requests: Validate `X-Hub-Signature-256` header using the Meta App Secret (global env var `META_APP_SECRET` — one per FloraClin Meta App, shared across all tenants)
- **Multi-tenant routing:** Meta includes the phone number ID in the payload. Look up the tenant by matching `whatsapp_phone_number_id` in settings. If no tenant matches, respond 200 but discard the event (Meta retries on non-200).

**Handles 3 event types:**

1. **Incoming message** (`messages` field):
   - Upsert conversation by phone number
   - Store message (dedup by `metaMessageId`)
   - If phone number not linked to a patient or prospect → create prospect with stage `novo`
   - Trigger AI classification (async — don't block webhook response)
   - Push SSE event to connected clients
   - Update `lastInboundAt` and increment `unreadCount`

2. **Status update** (`statuses` field):
   - Update `deliveryStatus` on the matching message (by `metaMessageId`)
   - Push SSE event

3. **Errors** (`errors` field):
   - Log to Sentry with tenant context
   - Update message status to `failed` with error code

**Webhook must respond 200 within 5 seconds** — all heavy processing (AI classification, media download) happens after the response.

### Outbound API Client

**Module:** `web/src/lib/whatsapp.ts`

```ts
sendTextMessage(tenantId, to, body): Promise<{ metaMessageId: string }>
sendTemplateMessage(tenantId, to, templateName, language, params): Promise<{ metaMessageId: string }>
sendMediaMessage(tenantId, to, mediaType, mediaUrl, caption?): Promise<{ metaMessageId: string }>
getTemplates(tenantId): Promise<WhatsAppTemplate[]>
downloadMedia(tenantId, mediaId): Promise<Buffer>
verifyCredentials(phoneNumberId, token): Promise<{ valid: boolean; phoneDisplay?: string }>
```

Each function reads credentials from `tenants.settings` via `getTenant(tenantId)`. All calls go to `https://graph.facebook.com/{WHATSAPP_API_VERSION}/{phoneNumberId}/messages`.

### 24-Hour Window

Each conversation tracks `lastInboundAt`. The chat UI computes:
- **Window open:** `now - lastInboundAt < 24 hours` → free-form text input enabled
- **Window closed:** Free-form input disabled, UI shows "Janela expirada — use um template" with a template picker button

---

## 3. Chat UI

### Route: `/whatsapp`

Full-page layout with two panels:

**Left panel — Conversation list:**
- Search bar (filter by name/phone)
- Filter tabs: `Todos`, `Não lidos`, `Prospects`, `Pacientes`
- Each conversation card shows: profile name (or phone), last message preview (truncated), timestamp, unread badge, pipeline stage badge (for prospects)
- Sorted by `lastMessageAt DESC`
- Active conversation highlighted

**Right panel — Chat view:**
- **Header:** Contact name, phone, pipeline stage badge, action buttons:
  - "Ver paciente" (if linked to patient — navigates to patient detail)
  - "Converter" (if prospect — opens conversion modal)
  - "Marcar como lido" button
- **Message area:** WhatsApp-style bubbles
  - Inbound: white bubbles, left-aligned
  - Outbound: green bubbles, right-aligned
  - Delivery status indicators: ✓ (sent), ✓✓ (delivered), blue ✓✓ (read), ✗ (failed)
  - Timestamps on each message
  - Media messages: inline image/video preview, audio player, document download link
  - Date separators between different days
- **Input area:**
  - Text input with send button
  - Attachment button (image, document)
  - When 24h window is closed: input disabled, "Usar template" button shown
  - Template picker: modal listing approved templates, preview with parameter fill, send

### Empty state

When WhatsApp is not configured for the tenant, `/whatsapp` shows a setup prompt: "Configure o WhatsApp para começar" with a link to settings.

---

## 4. CRM Pipeline

### Route: `/crm`

Kanban board with 6 columns:

| Column | Color | Description |
|--------|-------|-------------|
| Novo | Green (#25D366) | Just messaged, not yet contacted by staff |
| Contatado | Blue (#42A5F5) | Staff has replied |
| Qualificado | Orange (#FFA726) | Staff marked as qualified lead |
| Agendado | Purple (#AB47BC) | Appointment linked |
| Convertido | Green (#66BB6A) | Converted to patient |
| Perdido | Gray (#9E9E9E) | Lost lead |

**Prospect cards show:**
- Name (or phone number if no name)
- AI-detected interest/procedure
- Time since first contact
- Assigned staff member avatar (if assigned)

**Card actions (click to open detail panel):**
- View conversation (link to `/whatsapp` filtered to this conversation)
- Assign staff member
- Edit stage (dropdown)
- Add notes
- Convert to patient (for qualified/agendado stages)
- Mark as lost (with reason input)

**Stage transitions:**
- `novo` → `contatado`: **Automatic** when staff sends first reply via chat
- `contatado` → `qualificado`: Manual — staff clicks "Qualificar"
- `qualificado` → `agendado`: **Automatic** when an appointment is created for the linked patient (requires conversion first) or manual
- `agendado` → `convertido`: Manual — staff clicks "Converter"
- Any → `perdido`: Manual — staff clicks "Marcar como perdido", enters reason

**Conversion modal:**
- Two tabs: "Paciente existente" (search by name/phone) and "Novo paciente" (form pre-filled with prospect name + phone)
- On conversion: set `prospect.convertedPatientId`, set `prospect.stage = 'convertido'`, set `whatsapp_conversation.patientId`, soft-delete prospect

**Header stats bar:**
- Total prospects per stage (count badges)
- Conversion rate: `convertido / (convertido + perdido)` percentage

---

## 5. AI Classification

### Trigger

Runs asynchronously after a prospect is created from a new inbound message. Does not block the webhook response.

### Pass 1 — Keyword Matching

Scan the message body against pattern lists:

| Pattern | Intent tag |
|---------|-----------|
| `preço`, `quanto custa`, `valor`, `tabela` | `inquiry` |
| `agendar`, `marcar`, `horário`, `disponibilidade` | `scheduling` |
| `reclamação`, `problema`, `insatisf` | `complaint` |
| `retorno`, `voltar`, `revisão` | `followup` |

Also match against the clinic's `procedure_types` table names/categories to detect `interestedProcedure`.

If a clear match is found, update the prospect and skip Pass 2.

### Pass 2 — OpenAI Fallback

If no keyword match, call OpenAI API (gpt-4o-mini for cost efficiency):

**System prompt:**
```
You are a classifier for a Brazilian dental/aesthetic clinic. Analyze the WhatsApp message and return JSON:
{
  "intent": "inquiry" | "scheduling" | "complaint" | "followup" | "other",
  "interestedProcedure": "string or null",
  "sentiment": "positive" | "neutral" | "negative",
  "extractedName": "string or null"
}
Respond ONLY with the JSON object, no other text.
```

**User message:** The inbound WhatsApp message body.

**Cost:** ~R$0.01-0.03 per classification using gpt-4o-mini. Only called when keyword matching fails.

**Error handling:** If OpenAI is unavailable or returns invalid JSON, the prospect is created with no classification. Staff can classify manually.

### Storage

Classification results are written to the prospect record: `intent`, `interestedProcedure`, `sentiment`, `aiTags`. If OpenAI extracts a name and the prospect has no name (only phone), update `prospect.name`.

---

## 6. Real-time via SSE

### SSE Endpoint

**Route:** `GET /api/whatsapp/stream`

- Authenticated via `getAuthContext()` — only allowed roles can connect
- Returns `text/event-stream` content type
- Keeps connection alive with heartbeat comments every 15 seconds

### Event Types

```
event: new_message
data: { "conversationId": "...", "message": { ... } }

event: status_update
data: { "conversationId": "...", "messageId": "...", "status": "delivered" }

event: new_conversation
data: { "conversation": { ... } }

event: prospect_updated
data: { "prospectId": "...", "stage": "contatado", "intent": "scheduling" }
```

### Cross-process Signaling

The webhook handler and SSE handler run in separate request contexts. Signaling approach:

**Primary:** After the webhook writes to the DB, it also writes a row to a lightweight `sse_events` table (or uses Postgres `NOTIFY`/`LISTEN`). The SSE handler polls this table every 2 seconds as its heartbeat check.

**`sse_events` table:**

| Column | Type |
|--------|------|
| `id` | serial PK |
| `tenantId` | UUID |
| `eventType` | text |
| `payload` | jsonb |
| `createdAt` | timestamptz default now() |

Auto-cleanup: delete events older than 5 minutes (via the SSE handler on each poll cycle).

### Client-side

The chat page opens an `EventSource` connection on mount:

```ts
const es = new EventSource('/api/whatsapp/stream')
es.addEventListener('new_message', (e) => { /* append to chat */ })
es.addEventListener('new_conversation', (e) => { /* add to sidebar */ })
```

`EventSource` auto-reconnects on disconnect. On reconnect, fetch missed messages via REST to fill gaps.

---

## 7. Tenant Settings UI

### Settings Section: WhatsApp Integration

**Location:** `/configuracoes` page, new "WhatsApp" section. Owner-only.

**Fields:**
- Toggle: "Ativar integração WhatsApp"
- Phone Number ID (text input)
- Business Account ID (text input)
- Access Token (password input, paste-only)
- "Testar conexão" button → calls `verifyCredentials()`, shows success with phone display name or error message
- Webhook URL (read-only, copyable): `https://app.floraclin.com/api/webhooks/whatsapp` — clinic pastes this into Meta's webhook config
- Verify Token (read-only, copyable): displays the global `WHATSAPP_VERIFY_TOKEN` — clinic pastes this into Meta's webhook verification field

**Access control:**
- "Quem pode acessar o WhatsApp?" — checkboxes for each role (owner always has access)

**Setup guide:**
- Expandable accordion: "Como configurar o WhatsApp Business API"
- Step-by-step instructions with screenshots/links to Meta's developer dashboard
- Steps: Create Meta Business account → Create app → Add WhatsApp product → Get credentials → Paste into FloraClin → Configure webhook on Meta → Test

### Template Management

Sub-section within WhatsApp settings:

- "Sincronizar templates" button — fetches templates from Meta API
- Table: template name, language, category, status badge (approved/pending/rejected)
- "Pré-visualizar" button on each row — shows template preview in a modal
- Note: "Templates são criados no painel da Meta. Aqui você pode sincronizá-los e usá-los no chat."

---

## 8. Access Control

**Tenant-level configuration** stored in `tenants.settings.whatsapp_allowed_roles`:

- Owner always has access (hardcoded)
- Other roles (practitioner, receptionist) toggled in settings
- API routes check: `getAuthContext().role` against allowed roles
- Sidebar items (WhatsApp, CRM) hidden for unauthorized roles
- SSE endpoint rejects connections from unauthorized roles

---

## 9. API Routes Summary

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET/POST | `/api/webhooks/whatsapp` | Public (signature) | Meta webhook |
| GET | `/api/whatsapp/conversations` | Tenant + role | List conversations |
| GET | `/api/whatsapp/conversations/[id]/messages` | Tenant + role | Message history |
| POST | `/api/whatsapp/conversations/[id]/messages` | Tenant + role | Send message |
| PATCH | `/api/whatsapp/conversations/[id]` | Tenant + role | Mark read, archive |
| GET | `/api/whatsapp/stream` | Tenant + role | SSE endpoint |
| GET | `/api/whatsapp/templates` | Tenant + owner | List templates |
| POST | `/api/whatsapp/templates/sync` | Tenant + owner | Sync from Meta |
| GET | `/api/crm/prospects` | Tenant + role | List prospects |
| GET | `/api/crm/prospects/[id]` | Tenant + role | Prospect detail |
| PATCH | `/api/crm/prospects/[id]` | Tenant + role | Update stage, assign, notes |
| POST | `/api/crm/prospects/[id]/convert` | Tenant + role | Convert to patient |
| DELETE | `/api/crm/prospects/[id]` | Tenant + role | Soft delete |

---

## 10. Security Considerations

- **Token storage:** WhatsApp access tokens stored in `tenants.settings` JSONB. The token field is never returned to the client in API responses — masked as `••••{last4}` in the settings UI.
- **Webhook signature verification:** Every incoming POST validated against `X-Hub-Signature-256` using the app secret. Reject if invalid.
- **Tenant isolation:** All queries scoped by `tenantId`. Webhook routes tenant by phone number ID lookup.
- **Rate limiting:** Outbound messages rate-limited per tenant (Meta's own limits apply: 250-100K/24h depending on quality tier).
- **Media handling:** Media downloaded from Meta is re-uploaded to Supabase Storage (tenant-scoped bucket). Meta media URLs expire after a few days.
- **LGPD:** Prospects created from WhatsApp include only phone number and publicly-visible profile name. No scraping of additional data. Conversation history deletable on request.
- **OpenAI:** Only the message body text is sent to OpenAI for classification. No patient PII beyond the message content itself. Use the `openai` npm package with API key from environment.
