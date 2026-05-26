# Queued Messages & Anamnesis Link via API — Design Spec

## Overview

Two related features that leverage the Meta WhatsApp Business API:

1. **Queued Messages:** When the 24h messaging window is expired and staff sends a message, the system auto-sends the `resume_conversation` template (quick-reply "Sim"/"Não"), queues the original message, and auto-delivers it when the patient replies (opening the window). Messages auto-expire after 24h if unanswered.

2. **Anamnesis Link via API:** The existing "Enviar Anamnese" button gains a split-button dropdown. When Meta API is connected, the primary action sends the `anamnese_link` template directly via API. A secondary option preserves the current `wa.me` web WhatsApp flow. When Meta API is not connected, only the web WhatsApp option is shown (current behavior unchanged).

---

## Feature 1: Queued Messages

### Data Model

New table `whatsapp_queued_messages` in `floraclin` schema:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `defaultRandom()` |
| `tenant_id` | UUID FK → tenants | NOT NULL |
| `conversation_id` | UUID FK → whatsapp_conversations | NOT NULL |
| `body` | TEXT | Original message text, nullable (for media-only messages) |
| `media_type` | VARCHAR(20) | Nullable — 'image', 'document', 'audio', 'video' |
| `media_url` | TEXT | Nullable |
| `status` | VARCHAR(20) | NOT NULL, default 'queued'. Values: 'queued', 'sent', 'expired' |
| `resume_meta_message_id` | VARCHAR(255) | Meta message ID of the resume_conversation template that was sent |
| `created_at` | TIMESTAMPTZ | NOT NULL, defaultNow() |
| `sent_at` | TIMESTAMPTZ | Nullable, set when drained |
| `expired_at` | TIMESTAMPTZ | Nullable, set when expired |

**Indexes:**
- `(conversation_id, status)` — fast drain lookup
- `(tenant_id, created_at)` — expiry sweep

**Drizzle schema name:** `whatsappQueuedMessages`

### Queue Lifecycle

#### 1. Staff sends a message (window closed)

Entry point: `POST /api/whatsapp/conversations/[id]/messages`

Current behavior: the server checks `isWindowOpen(lastInboundAt)`. When the window is open, messages are sent via `sendTextMessage()` normally.

New behavior when window is **closed**:

```
Staff types message → hits Send
  ↓
Server detects window closed (lastInboundAt older than 24h or null)
  ↓
Check: any existing 'queued' messages for this conversation?
  ├─ NO → send resume_conversation template via sendTemplateMessage()
  │        save the Meta message ID as resume_meta_message_id
  └─ YES → skip sending resume_conversation (already sent)
  ↓
Insert row into whatsapp_queued_messages with status='queued'
  ↓
Return response with { ...message, deliveryStatus: 'queued' }
  ↓
Client shows queued bubble + toast
```

#### 2. Patient replies (webhook drains queue)

Entry point: `POST /api/webhooks/whatsapp/route.ts` — inbound message handler

After the existing inbound processing (dedup, conversation upsert, prospect creation, SSE push):

```
Inbound message processed
  ↓
Query: whatsapp_queued_messages WHERE conversationId=X AND status='queued'
       ORDER BY created_at ASC
  ↓
For each queued message:
  ├─ Send via sendTextMessage (or sendMediaMessage for media)
  ├─ Create whatsapp_messages record (the actual sent message)
  ├─ Update queued row: status='sent', sent_at=now()
  └─ Push SSE event: { type: 'queue_drained', conversationId, messageId }
```

#### 3. Expiry (24h TTL)

Queued messages expire 24h after creation. Expiry is checked:
- **On drain attempt** (before sending): skip and expire rows older than 24h
- **On next queue insert** for same conversation: expire stale rows first

No background cron needed — expiry is lazy, triggered by the next interaction.

When expired:
- Update row: `status='expired'`, `expired_at=now()`
- Push SSE event: `{ type: 'queue_expired', conversationId, queuedMessageIds: [...] }`
- Client updates bubble to show "Expirada" state

### Chat Panel UI Changes

#### When window is closed — keep the text input visible

Current: when window is closed, the input area shows "Janela de 24h expirada — use um template" and a Template button.

New: show the **normal text input** regardless of window state. The queue system handles the rest transparently. The template button remains accessible.

When a message is queued:
- Show it as a message bubble with a **clock icon** and subtle "Na fila — aguardando resposta" label
- Toast: "Janela expirada — enviamos um pedido de retomada ao paciente. Sua mensagem será enviada quando ele responder."
- Subsequent queued messages show as queued bubbles without extra toast (only the first triggers it)

When queue drains (SSE `queue_drained` event):
- Update each queued bubble to normal sent status with checkmarks

When queue expires (SSE `queue_expired` event):
- Update expired bubbles: grey out, show "Expirada" label

#### Window status indicator

Add a small banner above the input area when window is closed:
- Yellow-ish: "Janela de 24h expirada — mensagens serão enfileiradas"
- This replaces the current "use um template" locked state

### API Changes

#### `POST /api/whatsapp/conversations/[id]/messages` — Enhanced

Add queue logic to the existing handler:

1. If `body` is provided (text message) and window is closed:
   - Expire stale queued messages for this conversation
   - Check if resume_conversation already sent (any `queued` rows exist)
   - If not, find and send `resume_conversation` template
   - Insert queued message
   - Return `{ data: { ...queuedMsg, deliveryStatus: 'queued' } }`

2. If `templateName` is provided: send normally (templates work regardless of window state)

#### Webhook handler — Drain on inbound

In `POST /api/webhooks/whatsapp/route.ts`, after processing the inbound message:

1. Query queued messages for the conversation
2. If any exist, drain them (send + update status)
3. Push SSE events for each drained message

### DB Queries (new functions in `web/src/db/queries/whatsapp.ts`)

- `createQueuedMessage(tenantId, data)` — insert row
- `getQueuedMessages(conversationId)` — WHERE status='queued' ORDER BY created_at ASC
- `updateQueuedMessageStatus(id, status, extra?)` — set status, sentAt/expiredAt
- `expireStaleQueuedMessages(conversationId)` — bulk update WHERE createdAt < 24h ago AND status='queued'
- `hasActiveQueue(conversationId)` — boolean check for existing queued messages

---

## Feature 2: Anamnesis Link via API

### SendAnamnesisDialog Changes

The component at `web/src/components/patients/send-anamnesis-dialog.tsx` currently shows:
1. "Enviar Anamnese" button → generates link → shows [Link | Copy | WhatsApp]

New behavior:

**Props change:** Add `whatsappApiEnabled: boolean` prop. Threaded from:
`layout.tsx (whatsappEnabled)` → page → `patient-detail-content.tsx` → `patient-anamnesis-tab.tsx` → `SendAnamnesisDialog`

**After link is generated:**

If `whatsappApiEnabled` is true:
- The WhatsApp button becomes a **split-button dropdown** (using a `DropdownMenu` wrapping the button):
  - **"Enviar via WhatsApp"** (primary/default) — calls `POST /api/patients/[id]/anamnesis-link/send` with the generated URL
  - **"Abrir no WhatsApp Web"** — opens `wa.me` link (current behavior)
- The primary action ("Enviar via WhatsApp") is only shown if the `anamnese_link` template is approved. A lightweight check is done by attempting the API call — if the template isn't provisioned, the API returns an appropriate error and falls back gracefully.

If `whatsappApiEnabled` is false:
- Current behavior unchanged — single WhatsApp button opens `wa.me`

### New API Endpoint

`POST /api/patients/[id]/anamnesis-link/send`

Body: `{ url: string }` — the already-generated anamnesis link

Logic:
1. Auth check + tenant check + whatsapp_enabled check
2. Fetch patient to get phone number and name
3. Fetch tenant name (for clinic_name variable)
4. Find `anamnese_link` template by purposeKey for this tenant
5. If template not found or not APPROVED → return 400 "Template não disponível"
6. Call `sendTemplateMessage()` with variables:
   - `{{1}}` = patient first name
   - `{{2}}` = tenant name (clinic)
   - `{{3}}` = anamnesis URL
7. Find or create whatsapp_conversation for the patient's phone
8. Create whatsapp_messages record
9. Return success

### Prop Threading

The `whatsappEnabled` boolean is already in the platform layout. Threading path:

```
layout.tsx (settings.whatsapp_enabled)
  → currently passed to Sidebar and Header only
  → needs to be available in patient pages

Option: Use a React context or pass via page-level server component.
```

No existing tenant context exists in this codebase. The prop threading path is short (4 levels), so direct prop drilling is preferred over adding a new context provider.

Threading path:
1. `page.tsx` (server) — already calls `getAuthContext()`, add `getTenant(ctx.tenantId)` to read `settings.whatsapp_enabled`, pass as prop to `PatientDetailPageClient`
2. `PatientDetailPageClient` — passes `whatsappApiEnabled` to `PatientDetailContent`
3. `PatientDetailContent` — passes to `PatientAnamnesisTab`
4. `PatientAnamnesisTab` — passes to `SendAnamnesisDialog`

---

## Shared Concerns

### SSE Events

New event types:
- `queue_drained` — payload: `{ conversationId, messages: [{ id, metaMessageId, deliveryStatus }] }`
- `queue_expired` — payload: `{ conversationId, queuedMessageIds: string[] }`

### Error Handling

- If `resume_conversation` template is not provisioned or not approved: fall back to current behavior (show "use a template" message, don't queue)
- If `sendTemplateMessage` fails when sending resume_conversation: return error, don't queue the message
- If drain fails for a specific message: log error, leave it as `queued` (will be retried on next inbound or expired after 24h)
- If `anamnese_link` API send fails: show toast error, user can retry or fall back to web WhatsApp

### Migration

One migration adding the `whatsapp_queued_messages` table. No changes to existing tables.

---

## Out of Scope

- Media message queuing (support text only in v1 — media can be added later)
- Batch resume_conversation to multiple conversations
- "Não" button special handling (treated same as no reply — message expires after 24h)
- Retry logic for failed drain sends
- Analytics/metrics on queue usage
