# Queued Messages & Anamnesis Link via API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the 24h WhatsApp window is expired and staff sends a message, auto-send `resume_conversation` template, queue the original message, and auto-deliver when the patient replies. Also add API-based anamnesis link sending via the `anamnese_link` template with a split-button dropdown.

**Architecture:** New `whatsapp_queued_messages` table for FIFO queue with 24h TTL. Queue logic added to the message POST endpoint; drain logic added to the webhook inbound handler. SSE events for real-time queue status updates. Anamnesis link send uses a new API endpoint that sends the `anamnese_link` template, with prop drilling of `whatsappApiEnabled` through 4 component levels.

**Tech Stack:** Next.js 15, Drizzle ORM (pgSchema `floraclin`), Meta WhatsApp Business API v21.0, Zod, SSE

---

## File Structure

### New files
- `web/src/db/migrations/0010_whatsapp_queued_messages.sql` — migration
- `web/src/app/api/patients/[id]/anamnesis-link/send/route.ts` — API endpoint for sending anamnesis link via template

### Modified files
- `web/src/db/schema.ts` — add `whatsappQueuedMessages` table definition
- `web/src/db/queries/whatsapp.ts` — add 5 queued message query functions
- `web/src/app/api/whatsapp/conversations/[id]/messages/route.ts` — add queue logic when window is closed
- `web/src/app/api/webhooks/whatsapp/route.ts` — add drain logic on inbound messages
- `web/src/hooks/use-whatsapp-sse.ts` — add `onQueueDrained` and `onQueueExpired` callbacks
- `web/src/app/(platform)/whatsapp/page.tsx` — wire new SSE events
- `web/src/components/whatsapp/chat-panel.tsx` — replace locked input with banner + queue-aware send
- `web/src/components/whatsapp/message-bubble.tsx` — add queued/expired visual states
- `web/src/components/patients/send-anamnesis-dialog.tsx` — add split-button dropdown for API send
- `web/src/components/patients/patient-anamnesis-tab.tsx` — accept+pass `whatsappApiEnabled` prop
- `web/src/components/patients/patient-detail-content.tsx` — accept+pass `whatsappApiEnabled` prop
- `web/src/app/(platform)/pacientes/[id]/patient-detail-page-client.tsx` — accept+pass `whatsappApiEnabled` prop
- `web/src/app/(platform)/pacientes/[id]/page.tsx` — fetch tenant settings and pass `whatsappApiEnabled`

### Test files
- `web/src/db/queries/__tests__/whatsapp-queue.test.ts` — unit tests for queue query functions

---

## Group A (parallel) — Schema + Queries + Anamnesis API

### Task 1: Schema & Migration

**Files:**
- Modify: `web/src/db/schema.ts` (add table after line ~711, before SSE section)
- Create: `web/src/db/migrations/0010_whatsapp_queued_messages.sql`

- [ ] **Step 1: Add Drizzle schema definition**

In `web/src/db/schema.ts`, add after the `whatsappAutomations` table (before `// ─── SSE EVENTS`):

```typescript
export const whatsappQueuedMessages = floraclinSchema.table('whatsapp_queued_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id),
  body: text('body'),
  mediaType: varchar('media_type', { length: 20 }),
  mediaUrl: text('media_url'),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  resumeMetaMessageId: varchar('resume_meta_message_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
}, (table) => [
  index('idx_whatsapp_queued_messages_conv_status').on(table.conversationId, table.status),
  index('idx_whatsapp_queued_messages_tenant_created').on(table.tenantId, table.createdAt),
])
```

- [ ] **Step 2: Write the migration SQL**

Create `web/src/db/migrations/0010_whatsapp_queued_messages.sql`:

```sql
CREATE TABLE IF NOT EXISTS floraclin.whatsapp_queued_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  conversation_id UUID NOT NULL REFERENCES floraclin.whatsapp_conversations(id),
  body TEXT,
  media_type VARCHAR(20),
  media_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'expired')),
  resume_meta_message_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ
);

CREATE INDEX idx_whatsapp_queued_messages_conv_status
  ON floraclin.whatsapp_queued_messages (conversation_id, status);

CREATE INDEX idx_whatsapp_queued_messages_tenant_created
  ON floraclin.whatsapp_queued_messages (tenant_id, created_at);
```

- [ ] **Step 3: Run the migration**

```bash
# Run migration via postgres client (same approach as previous migrations)
cd /Users/giorgiofellipe/Work/floraclin/web
npx tsx -e "
const { Client } = require('pg');
const fs = require('fs');
const sql = fs.readFileSync('src/db/migrations/0010_whatsapp_queued_messages.sql', 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => client.query(sql)).then(() => { console.log('Migration applied'); client.end(); }).catch(e => { console.error(e); client.end(); process.exit(1); });
"
```

Expected: "Migration applied"

- [ ] **Step 4: Verify schema matches**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 2: Queue Query Functions

**Files:**
- Modify: `web/src/db/queries/whatsapp.ts` (add new section after STATS section, ~line 658)

- [ ] **Step 1: Add import for the new table**

At the top of `web/src/db/queries/whatsapp.ts`, add `whatsappQueuedMessages` to the schema import:

```typescript
import {
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  whatsappAutomations,
  whatsappQueuedMessages,
  sseEvents,
} from '@/db/schema'
```

Also add `lt` to the drizzle-orm import:

```typescript
import { eq, and, or, desc, gt, lt, ilike, sql } from 'drizzle-orm'
```

- [ ] **Step 2: Add type export**

After the existing type exports:

```typescript
export type WhatsappQueuedMessage = typeof whatsappQueuedMessages.$inferSelect
```

- [ ] **Step 3: Add queue query functions**

Add at the end of the file, before the closing:

```typescript
// ─── QUEUED MESSAGES ──────────────────────────────────────────────

export async function createQueuedMessage(
  tenantId: string,
  conversationId: string,
  data: {
    body?: string | null
    mediaType?: string | null
    mediaUrl?: string | null
    resumeMetaMessageId?: string | null
  },
): Promise<WhatsappQueuedMessage> {
  const [msg] = await db
    .insert(whatsappQueuedMessages)
    .values({
      tenantId,
      conversationId,
      body: data.body ?? null,
      mediaType: data.mediaType ?? null,
      mediaUrl: data.mediaUrl ?? null,
      resumeMetaMessageId: data.resumeMetaMessageId ?? null,
    })
    .returning()
  return msg
}

export async function getQueuedMessages(
  tenantId: string,
  conversationId: string,
): Promise<WhatsappQueuedMessage[]> {
  return db
    .select()
    .from(whatsappQueuedMessages)
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
      ),
    )
    .orderBy(whatsappQueuedMessages.createdAt)
}

export async function hasActiveQueue(
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappQueuedMessages)
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
      ),
    )
  return (result?.count ?? 0) > 0
}

export async function updateQueuedMessageStatus(
  id: string,
  status: 'sent' | 'expired',
): Promise<WhatsappQueuedMessage | null> {
  const extra = status === 'sent'
    ? { sentAt: new Date() }
    : { expiredAt: new Date() }

  const [updated] = await db
    .update(whatsappQueuedMessages)
    .set({ status, ...extra })
    .where(eq(whatsappQueuedMessages.id, id))
    .returning()
  return updated ?? null
}

export async function expireStaleQueuedMessages(
  tenantId: string,
  conversationId: string,
): Promise<string[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const expired = await db
    .update(whatsappQueuedMessages)
    .set({ status: 'expired', expiredAt: new Date() })
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
        lt(whatsappQueuedMessages.createdAt, twentyFourHoursAgo),
      ),
    )
    .returning()

  return expired.map((m) => m.id)
}
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 3: Anamnesis Link Send API Endpoint

**Files:**
- Create: `web/src/app/api/patients/[id]/anamnesis-link/send/route.ts`

- [ ] **Step 1: Create the API endpoint**

```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage } from '@/lib/whatsapp'

const bodySchema = z.object({
  url: z.string().url(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const template = await getTemplateByPurpose(ctx.tenantId, 'anamnese_link')
    if (!template || template.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Template de anamnese não disponível' }, { status: 400 })
    }

    const phone = patient.phone.replace(/\D/g, '')
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`
    const firstName = patient.fullName.split(' ')[0]

    const result = await sendTemplateMessage(
      ctx.tenantId,
      normalizedPhone,
      template.name,
      template.language,
      {
        '1': firstName,
        '2': tenant!.name,
        '3': parsed.data.url,
      },
    )

    const conversation = await upsertConversation(
      ctx.tenantId,
      normalizedPhone,
      patient.fullName,
      undefined,
      patientId,
    )

    const message = await createMessage(ctx.tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: result.metaMessageId,
      body: `[Anamnese] Link enviado para ${firstName}`,
      templateName: template.name,
      deliveryStatus: 'sent',
    })

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId: conversation.id,
      message,
    })

    return NextResponse.json({ success: true, data: message }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Anamnesis link send API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

## Group B (depends on A) — API Logic + Webhook Drain

### Task 4: Messages API — Queue Logic

**Files:**
- Modify: `web/src/app/api/whatsapp/conversations/[id]/messages/route.ts`

- [ ] **Step 1: Add imports**

Add to existing imports:

```typescript
import {
  getConversation,
  listMessages,
  createMessage,
  pushSseEvent,
  getTemplateByPurpose,
  hasActiveQueue,
  createQueuedMessage,
  expireStaleQueuedMessages,
} from '@/db/queries/whatsapp'
```

Remove individual imports of `getConversation`, `listMessages`, `createMessage`, `pushSseEvent` from the existing import — they're now all in one import.

- [ ] **Step 2: Add window check helper**

Add after the `checkWhatsAppAccess` function:

```typescript
function isWindowOpen(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return lastInboundAt > twentyFourHoursAgo
}
```

- [ ] **Step 3: Add media-when-closed guard**

In the `POST` handler, add a window check at the start of the media branch (the `else if ('mediaType' in body)` block). Insert right after `if (!parsed.success)` check:

```typescript
      if (!isWindowOpen(conversation.lastInboundAt)) {
        return NextResponse.json(
          { error: 'Janela de 24h expirada — envie um template primeiro para reabrir a conversa.' },
          { status: 400 },
        )
      }
```

- [ ] **Step 4: Update the POST handler — add queue logic for text messages**

In the `POST` handler, replace the text message branch (the `else` block starting at approximately line 145) with queue-aware logic. The full updated `else` block:

```typescript
    } else {
      const parsed = sendMessageSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      if (!isWindowOpen(conversation.lastInboundAt)) {
        // Window closed — queue the message
        const expiredIds = await expireStaleQueuedMessages(ctx.tenantId, conversationId)
        if (expiredIds.length > 0) {
          await pushSseEvent(ctx.tenantId, 'queue_expired', {
            conversationId,
            queuedMessageIds: expiredIds,
          })
        }

        const alreadyQueued = await hasActiveQueue(ctx.tenantId, conversationId)

        let resumeMetaMessageId: string | null = null
        if (!alreadyQueued) {
          const resumeTemplate = await getTemplateByPurpose(ctx.tenantId, 'resume_conversation')
          if (!resumeTemplate || resumeTemplate.status !== 'APPROVED') {
            return NextResponse.json(
              { error: 'Template resume_conversation não disponível. Use um template manualmente.' },
              { status: 400 },
            )
          }

          const firstName = conversation.profileName?.split(' ')[0] ?? 'paciente'
          const resumeResult = await sendTemplateMessage(
            ctx.tenantId,
            conversation.phoneNumber,
            resumeTemplate.name,
            resumeTemplate.language,
            { '1': firstName },
          )
          resumeMetaMessageId = resumeResult.metaMessageId

          await createMessage(ctx.tenantId, conversationId, {
            direction: 'outbound',
            metaMessageId: resumeMetaMessageId,
            templateName: resumeTemplate.name,
            deliveryStatus: 'sent',
          })
        }

        const queued = await createQueuedMessage(ctx.tenantId, conversationId, {
          body: parsed.data.body,
          resumeMetaMessageId,
        })

        const queuedMessage = {
          id: queued.id,
          conversationId,
          direction: 'outbound' as const,
          body: parsed.data.body,
          deliveryStatus: 'queued',
          createdAt: queued.createdAt,
          timestamp: queued.createdAt,
          metaMessageId: null,
          mediaType: null,
          mediaUrl: null,
          mediaFilename: null,
          templateName: null,
          errorCode: null,
        }

        await pushSseEvent(ctx.tenantId, 'new_message', {
          conversationId,
          message: queuedMessage,
        })

        return NextResponse.json({
          success: true,
          data: queuedMessage,
          queued: true,
          resumeSent: !alreadyQueued,
        }, { status: 201 })
      }

      const result = await sendTextMessage(
        ctx.tenantId,
        conversation.phoneNumber,
        parsed.data.body,
      )
      metaMessageId = result.metaMessageId
      messageBody = parsed.data.body
    }
```

> **Note on race conditions:** Two concurrent sends for the same closed-window conversation could both see `hasActiveQueue === false` and send duplicate `resume_conversation` templates. This is a low-probability edge case (staff rarely sends two messages in the exact same instant). The worst outcome is the patient receives two resume templates. A database advisory lock or transaction-level `SELECT FOR UPDATE` on the conversation row would prevent this, but the complexity is not warranted for MVP. If this becomes a real issue, add a `FOR UPDATE` lock on the conversation fetch.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 5: Webhook — Drain Queue on Inbound

**Files:**
- Modify: `web/src/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Add imports**

Add to the existing import from `@/db/queries/whatsapp`:

```typescript
import {
  upsertConversation,
  createMessage,
  incrementUnreadCount,
  updateMessageStatus,
  pushSseEvent,
  getMessageByMetaId,
  getQueuedMessages,
  updateQueuedMessageStatus,
  expireStaleQueuedMessages,
} from '@/db/queries/whatsapp'
```

Add to imports from `@/lib/whatsapp`:

```typescript
import { verifyWebhookSignature, downloadAndStoreMedia, sendTextMessage } from '@/lib/whatsapp'
```

- [ ] **Step 2: Add drain function**

Add after the `updateMessageMedia` function:

```typescript
// ---------------------------------------------------------------------------
// Drain queued messages when window opens
// ---------------------------------------------------------------------------
async function drainQueuedMessages(
  tenantId: string,
  conversationId: string,
  phoneNumber: string,
) {
  const expiredIds = await expireStaleQueuedMessages(tenantId, conversationId)
  if (expiredIds.length > 0) {
    await pushSseEvent(tenantId, 'queue_expired', {
      conversationId,
      queuedMessageIds: expiredIds,
    })
  }

  const queued = await getQueuedMessages(tenantId, conversationId)
  if (queued.length === 0) return

  const drainedMessages: Array<{ id: string; metaMessageId: string; deliveryStatus: string }> = []

  for (const qm of queued) {
    try {
      if (!qm.body) continue

      const result = await sendTextMessage(tenantId, phoneNumber, qm.body)

      await createMessage(tenantId, conversationId, {
        direction: 'outbound',
        metaMessageId: result.metaMessageId,
        body: qm.body,
        deliveryStatus: 'sent',
      })

      await updateQueuedMessageStatus(qm.id, 'sent')

      drainedMessages.push({
        id: qm.id,
        metaMessageId: result.metaMessageId,
        deliveryStatus: 'sent',
      })
    } catch (err) {
      console.error(`Failed to drain queued message ${qm.id}:`, err)
    }
  }

  if (drainedMessages.length > 0) {
    await pushSseEvent(tenantId, 'queue_drained', {
      conversationId,
      messages: drainedMessages,
    })
  }
}
```

- [ ] **Step 3: Call drain after inbound message processing**

In the `processInboundMessage` function, add the drain call at the very end (after the classification fire-and-forget block, around line 213):

```typescript
  // Drain any queued messages now that the window is open
  drainQueuedMessages(tenantId, conversation.id, from).catch((err) =>
    console.error('Queue drain failed:', err),
  )
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

## Group C (depends on B) — SSE Hook + WhatsApp Page Wiring

### Task 6: SSE Hook — Add Queue Events

**Files:**
- Modify: `web/src/hooks/use-whatsapp-sse.ts`

- [ ] **Step 1: Add new callback types**

Update the `WhatsappSseCallbacks` interface:

```typescript
interface WhatsappSseCallbacks {
  onMessage?: (data: unknown) => void
  onStatusUpdate?: (data: unknown) => void
  onNewConversation?: (data: unknown) => void
  onProspectUpdated?: (data: unknown) => void
  onQueueDrained?: (data: unknown) => void
  onQueueExpired?: (data: unknown) => void
}
```

- [ ] **Step 2: Add event listeners**

Add after the `prospect_updated` listener:

```typescript
    es.addEventListener('queue_drained', (e) => {
      callbacksRef.current.onQueueDrained?.(JSON.parse(e.data))
    })

    es.addEventListener('queue_expired', (e) => {
      callbacksRef.current.onQueueExpired?.(JSON.parse(e.data))
    })
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 7: WhatsApp Page — Wire Queue SSE Events

**Files:**
- Modify: `web/src/app/(platform)/whatsapp/page.tsx`

- [ ] **Step 1: Add queue drained handler**

Add after the `handleProspectUpdated` callback:

```typescript
  const handleQueueDrained = useCallback((data: unknown) => {
    const payload = data as {
      conversationId: string
      messages: Array<{ id: string; metaMessageId: string; deliveryStatus: string }>
    }
    for (const msg of payload.messages) {
      chatPanelRef.current?.updateMessageStatus({
        messageId: msg.id,
        status: 'sent',
        metaMessageId: msg.metaMessageId,
      })
    }
  }, [])

  const handleQueueExpired = useCallback((data: unknown) => {
    const payload = data as {
      conversationId: string
      queuedMessageIds: string[]
    }
    for (const id of payload.queuedMessageIds) {
      chatPanelRef.current?.updateMessageStatus({
        messageId: id,
        status: 'expired',
      })
    }
  }, [])
```

- [ ] **Step 2: Wire up in useWhatsappSse call**

Update the `useWhatsappSse` call to include the new handlers:

```typescript
  useWhatsappSse(
    {
      onMessage: handleNewMessage,
      onStatusUpdate: handleStatusUpdate,
      onNewConversation: handleNewConversation,
      onProspectUpdated: handleProspectUpdated,
      onQueueDrained: handleQueueDrained,
      onQueueExpired: handleQueueExpired,
    },
    configStatus === 'configured',
  )
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

## Group D (depends on C) — UI Components

### Task 8: Message Bubble — Queued & Expired States

**Files:**
- Modify: `web/src/components/whatsapp/message-bubble.tsx`

- [ ] **Step 1: Add Clock icon import**

Update the import:

```typescript
import { Check, CheckCheck, Clock } from 'lucide-react'
```

- [ ] **Step 2: Update StatusIcon to handle queued and expired**

Replace the `StatusIcon` component:

```typescript
function StatusIcon({ status }: { status: string }) {
  if (status === 'queued') {
    return <Clock className="size-3.5 text-amber-500" />
  }
  if (status === 'expired') {
    return <span className="text-[10px] text-muted-foreground">Expirada</span>
  }
  if (status === 'sent') {
    return <Check className="size-3.5 text-[#8696A0]" />
  }
  if (status === 'delivered') {
    return <CheckCheck className="size-3.5 text-[#8696A0]" />
  }
  if (status === 'read') {
    return <CheckCheck className="size-3.5 text-[#53BDEB]" />
  }
  if (status === 'failed') {
    return <span className="text-[10px] text-destructive">Falhou</span>
  }
  return null
}
```

- [ ] **Step 3: Add queued label and expired styling in MessageBubble**

Update the `MessageBubble` component to show a label for queued messages and grey out expired ones:

```typescript
export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const isQueued = message.deliveryStatus === 'queued'
  const isExpired = message.deliveryStatus === 'expired'
  const displayText = message.body || (message.templateName ? `[Template: ${message.templateName}]` : '[Mensagem sem texto]')

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
          isOutbound
            ? 'bg-[#D9FDD3] text-[#111B21]'
            : 'bg-white text-[#111B21]',
          isExpired && 'opacity-50',
        )}
      >
        {message.mediaType && message.mediaUrl && (
          <div className="mb-1">
            {message.mediaType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.mediaUrl}
                alt="Imagem"
                className="max-h-64 rounded object-cover"
              />
            ) : (
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline"
              >
                {message.mediaType === 'video' ? 'Abrir video' : message.mediaType === 'audio' ? 'Ouvir audio' : 'Baixar arquivo'}
              </a>
            )}
          </div>
        )}

        <span className="whitespace-pre-wrap break-words">{displayText}</span>

        {isQueued && (
          <div className="mt-1 text-[10px] text-amber-600">
            Na fila — aguardando resposta
          </div>
        )}

        <span className={cn('float-right mt-1 ml-2 flex items-center gap-0.5', isOutbound ? 'text-[#667781]' : 'text-[#667781]')}>
          <span className="text-[11px] leading-none">{formatTime(message.timestamp)}</span>
          {isOutbound && <StatusIcon status={message.deliveryStatus} />}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 9: Chat Panel — Queue-Aware Input

**Files:**
- Modify: `web/src/components/whatsapp/chat-panel.tsx`

- [ ] **Step 1: Add toast import and update ChatPanelHandle**

Add to imports:

```typescript
import { toast } from 'sonner'
```

Update the `ChatPanelHandle` interface to accept optional `metaMessageId`:

```typescript
export interface ChatPanelHandle {
  addMessage: (msg: Message) => void
  updateMessageStatus: (data: { messageId: string; status: string; metaMessageId?: string }) => void
}
```

Update the `updateMessageStatus` callback to also set `metaMessageId` when provided:

```typescript
    const updateMessageStatus = useCallback(
      (data: { messageId: string; status: string; metaMessageId?: string }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? { ...m, deliveryStatus: data.status, ...(data.metaMessageId ? { metaMessageId: data.metaMessageId } : {}) }
              : m
          )
        )
      },
      []
    )
```

- [ ] **Step 2: Add `firstQueueRef` to track if this is the first queued message**

Add ref after `prevConvIdRef`:

```typescript
    const firstQueueRef = useRef(true)
```

Reset it when conversation changes (in the useEffect that handles conversation change):

```typescript
    useEffect(() => {
      if (!conversation) {
        setMessages([])
        return
      }
      if (conversation.id !== prevConvIdRef.current) {
        prevConvIdRef.current = conversation.id
        setPage(1)
        setInputText('')
        firstQueueRef.current = true
        fetchMessages(conversation.id, 1, false)
      }
    }, [conversation, fetchMessages])
```

- [ ] **Step 3: Update handleSendText to handle queue response**

Replace the `handleSendText` function:

```typescript
    const handleSendText = async () => {
      if (!conversation || !inputText.trim() || sending) return
      setSending(true)
      try {
        const res = await fetch(
          `/api/whatsapp/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: inputText.trim() }),
          }
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Erro ao enviar mensagem' }))
          toast.error(err.error || 'Erro ao enviar mensagem')
          return
        }
        const data = await res.json()
        const newMsg: Message = data.data ?? data
        setMessages((prev) => [...prev, newMsg])
        setInputText('')
        setTimeout(() => scrollToBottom(), 100)

        if (data.queued && data.resumeSent && firstQueueRef.current) {
          firstQueueRef.current = false
          toast.info(
            'Janela expirada — enviamos um pedido de retomada ao paciente. Sua mensagem será enviada quando ele responder.',
            { duration: 6000 },
          )
        }
      } catch {
        toast.error('Erro ao enviar mensagem')
      } finally {
        setSending(false)
      }
    }
```

- [ ] **Step 4: Replace the locked input area with banner + text input**

Replace the entire input area (the `<div className="border-t bg-[#F0F2F5] px-4 py-3">` block) with:

```typescript
        {/* Input area */}
        <div className="border-t bg-[#F0F2F5]">
          {!windowOpen && (
            <div className="bg-amber-50 px-4 py-2 text-xs text-amber-700 border-b border-amber-100">
              Janela de 24h expirada — mensagens serão enfileiradas
            </div>
          )}
          <div className="px-4 py-3">
            <div className="flex items-end gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTemplateOpen(true)}
                title="Enviar template"
              >
                <FileText className="size-5 text-[#54656F]" />
              </Button>

              <div className="flex-1">
                <textarea
                  className={cn(
                    'w-full resize-none rounded-lg border-0 bg-white px-3 py-2 text-sm text-[#111B21] outline-none ring-0',
                    'placeholder:text-[#667781]',
                    'focus:ring-0 focus:outline-none',
                    'min-h-[40px] max-h-[120px]'
                  )}
                  placeholder="Mensagem..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={sending}
                />
              </div>

              <Button
                size="icon"
                onClick={handleSendText}
                disabled={!inputText.trim() || sending}
                className="bg-[#25D366] hover:bg-[#1DA851] text-white shrink-0"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 10: Anamnesis Dialog — Split-Button Dropdown

**Files:**
- Modify: `web/src/components/patients/send-anamnesis-dialog.tsx`

- [ ] **Step 1: Add imports**

Update imports:

```typescript
import { useState } from 'react'
import { SendIcon, Copy, Loader2Icon, CheckIcon, ChevronDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
```

- [ ] **Step 2: Add `whatsappApiEnabled` prop**

```typescript
interface SendAnamnesisDialogProps {
  patientId: string
  patientName: string
  patientPhone?: string
  whatsappApiEnabled?: boolean
}

export function SendAnamnesisDialog({
  patientId,
  patientName,
  patientPhone,
  whatsappApiEnabled = false,
}: SendAnamnesisDialogProps) {
```

- [ ] **Step 3: Add API send state and handler**

Add after the `handleCopy` function:

```typescript
  const [sendingApi, setSendingApi] = useState(false)

  async function handleSendViaApi() {
    if (!url) return
    setSendingApi(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/anamnesis-link/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao enviar' }))
        throw new Error(err.error || 'Erro ao enviar')
      }
      toast.success('Link de anamnese enviado via WhatsApp')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar via WhatsApp')
    } finally {
      setSendingApi(false)
    }
  }
```

- [ ] **Step 4: Replace WhatsApp button with split-button dropdown**

Replace the WhatsApp button section (the `{whatsAppUrl && (` block) with:

```typescript
      {/* WhatsApp button(s) */}
      {whatsAppUrl && whatsappApiEnabled ? (
        <div className="flex items-center">
          <button
            type="button"
            onClick={handleSendViaApi}
            disabled={sendingApi}
            className="flex items-center gap-1.5 rounded-l-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1DA851] transition-colors disabled:opacity-50"
          >
            {sendingApi ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            )}
            Enviar via WhatsApp
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center rounded-r-md border-l border-[#1DA851] bg-[#25D366] px-1.5 py-1.5 text-white hover:bg-[#1DA851] transition-colors"
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a
                  href={whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir no WhatsApp Web
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : whatsAppUrl ? (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1DA851] transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          WhatsApp
        </a>
      ) : null}
```

- [ ] **Step 5: Remove unused ExternalLinkIcon import**

Remove `ExternalLinkIcon` from the lucide-react import since it's not used.

- [ ] **Step 6: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

### Task 11: Prop Threading — whatsappApiEnabled

**Files:**
- Modify: `web/src/app/(platform)/pacientes/[id]/page.tsx`
- Modify: `web/src/app/(platform)/pacientes/[id]/patient-detail-page-client.tsx`
- Modify: `web/src/components/patients/patient-detail-content.tsx`
- Modify: `web/src/components/patients/patient-anamnesis-tab.tsx`

- [ ] **Step 1: Update `page.tsx` to fetch tenant settings**

In `web/src/app/(platform)/pacientes/[id]/page.tsx`, add `getTenant` import and pass `whatsappApiEnabled`:

```typescript
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { PatientDetailPageClient } from './patient-detail-page-client'
```

Update the default export function to fetch tenant and pass the flag:

```typescript
export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { id } = await params
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <PatientDetailPageClient
        patientId={id}
        whatsappApiEnabled={!!settings.whatsapp_enabled}
      />
    </Suspense>
  )
}
```

- [ ] **Step 2: Update `patient-detail-page-client.tsx`**

Add the prop and pass it through:

```typescript
interface PatientDetailPageClientProps {
  patientId: string
  whatsappApiEnabled?: boolean
}

export function PatientDetailPageClient({ patientId, whatsappApiEnabled = false }: PatientDetailPageClientProps) {
```

Pass to `PatientDetailContent`:

```typescript
    <PatientDetailContent
      patient={patient}
      activeTab={tab}
      hasActiveService={hasActiveService}
      whatsappApiEnabled={whatsappApiEnabled}
    />
```

- [ ] **Step 3: Update `patient-detail-content.tsx`**

Find the component's props interface and add:

```typescript
  whatsappApiEnabled?: boolean
```

Find where `PatientAnamnesisTab` is rendered (line 288):

```typescript
          {tab === 'anamnese' && <PatientAnamnesisTab patientId={patient.id} patientName={patient.fullName} patientPhone={patient.phone} whatsappApiEnabled={whatsappApiEnabled} />}
```

Accept the prop in the component signature.

- [ ] **Step 4: Update `patient-anamnesis-tab.tsx`**

Add prop to interface:

```typescript
interface PatientAnamnesisTabProps {
  patientId: string
  patientName?: string
  patientPhone?: string | null
  whatsappApiEnabled?: boolean
}
```

Accept it:

```typescript
export function PatientAnamnesisTab({ patientId, patientName, patientPhone, whatsappApiEnabled }: PatientAnamnesisTabProps) {
```

Pass to `SendAnamnesisDialog`:

```typescript
          <SendAnamnesisDialog
            patientId={patientId}
            patientName={patientName}
            patientPhone={patientPhone ?? undefined}
            whatsappApiEnabled={whatsappApiEnabled}
          />
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

---

## Group E (depends on D) — Tests

### Task 12: Queue Query Function Tests

**Files:**
- Create: `web/src/db/queries/__tests__/whatsapp-queue.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [
          {
            id: 'q-1',
            tenantId: 't-1',
            conversationId: 'c-1',
            body: 'Hello',
            mediaType: null,
            mediaUrl: null,
            status: 'queued',
            resumeMetaMessageId: 'meta-1',
            createdAt: new Date('2026-05-26T10:00:00Z'),
            sentAt: null,
            expiredAt: null,
          },
        ]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => []),
          limit: vi.fn(() => [{ count: 0 }]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => [
            {
              id: 'q-1',
              status: 'sent',
              sentAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  whatsappQueuedMessages: {
    id: 'id',
    tenantId: 'tenant_id',
    conversationId: 'conversation_id',
    body: 'body',
    mediaType: 'media_type',
    mediaUrl: 'media_url',
    status: 'status',
    resumeMetaMessageId: 'resume_meta_message_id',
    createdAt: 'created_at',
    sentAt: 'sent_at',
    expiredAt: 'expired_at',
  },
  whatsappConversations: {},
  whatsappMessages: {},
  whatsappTemplates: {},
  whatsappAutomations: {},
  sseEvents: {},
}))

describe('whatsapp queue queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createQueuedMessage inserts and returns a record', async () => {
    const { createQueuedMessage } = await import('../whatsapp')
    const result = await createQueuedMessage('t-1', 'c-1', {
      body: 'Hello',
      resumeMetaMessageId: 'meta-1',
    })
    expect(result).toBeDefined()
    expect(result.id).toBe('q-1')
    expect(result.status).toBe('queued')
    expect(result.body).toBe('Hello')
  })

  it('hasActiveQueue returns false when count is 0', async () => {
    const { hasActiveQueue } = await import('../whatsapp')
    const result = await hasActiveQueue('t-1', 'c-1')
    expect(result).toBe(false)
  })

  it('updateQueuedMessageStatus updates and returns record', async () => {
    const { updateQueuedMessageStatus } = await import('../whatsapp')
    const result = await updateQueuedMessageStatus('q-1', 'sent')
    expect(result).toBeDefined()
    expect(result?.status).toBe('sent')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @floraclin/web test:run -- src/db/queries/__tests__/whatsapp-queue.test.ts
```

Expected: all tests pass

---

### Task 13: Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @floraclin/web test:run
```

Expected: all tests pass (748+ tests)

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @floraclin/web typecheck
```

Expected: no errors

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: no errors
