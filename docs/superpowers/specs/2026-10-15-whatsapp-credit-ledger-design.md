# WhatsApp credit ledger

Date: 2026-10-15
Status: approved design, pending implementation plan

## Goal

Every WhatsApp credit spend and every refund on the shared FloraClin number gets its own line in a ledger. The clinic owner reads the ledger as plain sentences, for example "Ana Souza enviou Link de anamnese para Maria Silva".

Success criteria:

- Each call to `sendWithCredits` that charges credits writes exactly one `spend` line.
- Each refund (immediate send failure or later Meta delivery failure) writes exactly one `refund` line linked to its spend.
- For any credit period that starts after the deploy, the sum of `amount` equals `-credits_used`. Earlier periods only have lines since 14/10 (PR #75).
- The owner opens the history from the "Uso de créditos" section of Configurações > WhatsApp and pages through it by credit period.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Clinic owner only. API and UI are owner-only. |
| Failure lines | Both failure types write spend + refund: Meta rejects at once (`send_failed`) and Meta reports `failed` later (`delivery_failed`). |
| Queued sends | The line names the user who queued the message, not the system. |
| List scope | Credit period picker + "Carregar mais" paging (50 lines). No filters, no export. |
| Storage | Structured ledger rows. Sentences are built on read, not stored. |
| Placement | "Ver histórico" button inside "Uso de créditos" on `?tab=whatsapp`, opening a dialog (desktop) or sheet (mobile). |

Out of scope: CSV export, filters, financial role access, platform-admin cross-tenant view, manual credit adjustments, own-number clinics (they use no credits).

## Data model

New table `floraclin.whatsapp_credit_ledger`, replacing `whatsapp_credit_charges`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk tenants, not null | |
| `credit_period_id` | uuid fk whatsapp_credits, not null | |
| `kind` | varchar(10), not null | `spend` or `refund` |
| `amount` | integer, not null | Signed: negative for spend, positive for refund |
| `meta_message_id` | varchar(255), null | Null when Meta rejected the send at once, or until the send returns |
| `refund_of` | uuid fk whatsapp_credit_ledger, null | Set on refunds only |
| `refund_reason` | varchar(20), null | `send_failed` or `delivery_failed` |
| `actor_type` | varchar(10), not null | `user`, `patient` or `system` |
| `actor_user_id` | uuid fk users, null | Set when `actor_type = 'user'` |
| `patient_id` | uuid fk patients, null | |
| `conversation_id` | uuid fk whatsapp_conversations, null | |
| `contact_name` | varchar(255), null | Name at send time; fallback for CRM leads without a patient |
| `contact_phone` | varchar(30), not null | Last fallback for the recipient name |
| `item_kind` | varchar(10), not null | `template`, `text`, `media` or `document` |
| `template_name` | varchar(255), null | |
| `purpose_key` | varchar(100), null | Used for the friendly label via `PURPOSE_LABELS` |
| `document_label` | varchar(255), null | For example "Atestado", "Termo de consentimento" |
| `created_at` | timestamptz, not null, default now() | |

Indexes:

- `(tenant_id, credit_period_id, created_at desc, id desc)` for the paged list.
- Unique `refund_of` where not null: one refund per spend.
- Unique `meta_message_id` where not null and `kind = 'spend'`: the webhook finds the spend by message id.

RLS enabled, same policy shape as migration 0036.

`whatsapp_queued_messages` gets `credit_context jsonb null`, holding the `CreditContext` of the user who queued the message.

## Write path

`CreditContext` (in `lib/whatsapp-credit-ledger.ts`, client-safe types):

```ts
type CreditActor =
  | { type: 'user'; userId: string }
  | { type: 'patient' }
  | { type: 'system' }

type CreditItem =
  | { kind: 'template'; templateName: string; purposeKey: string | null }
  | { kind: 'text' }
  | { kind: 'media' }
  | { kind: 'document'; label: string }

interface CreditContext {
  actor: CreditActor
  recipient: { patientId: string | null; conversationId: string | null; name: string | null }
  item: CreditItem
}
```

`sendTextMessage`, `sendTemplateMessage`, `sendMediaMessage` and `sendOrEnqueueDocument` take a required `credit: CreditContext`. The compiler then forces every caller to provide it. `sendWithCredits(tenantId, credit, resolveCost, send)`:

1. `requireSendAllowed`, then return `send()` directly for own-number clinics (no ledger).
2. `spendCredits(tenantId, cost, credit, to)`: one transaction raises `credits_used` (same guarded update as today) and inserts the `spend` line. If credits are exhausted, nothing is written and `CreditExhaustedError` is thrown.
3. On send success: `attachMetaMessageId(spendId, metaMessageId)`. A failure is reported to Sentry and does not fail the send.
4. On send throw: `refundSpend(spendId, 'send_failed')`, then rethrow the original error. A refund failure is reported to Sentry.

Webhook `failed` status: `refundSpendByMetaMessageId(metaMessageId, 'delivery_failed')` finds the spend line and calls the same refund.

`refundSpend` runs in one transaction: insert the `refund` line (`amount = -spend.amount`, `refund_of = spend.id`), then lower `credits_used` by the same amount (floored at 0). A unique violation on `refund_of` means the spend is already refunded; it is ignored and the counter is not touched.

Removed: `whatsapp_credit_charges`, `recordCharge`, `refundCredits`, `refundFailedCharge`, `consumeCredits` (replaced by `spendCredits`).

## Actors per caller

| Caller | Actor | Item |
|---|---|---|
| Inbox text, media, template; new conversation; retry | Logged-in user | text / media / template |
| Inbox resume template when queueing | Logged-in user | template |
| Queue drain (webhook) | `credit_context` of the queued row; `system` when null | text / media / document |
| Anamnesis link send, terms link send, clinical document send | Logged-in user | template / document |
| Consent copy (`consent/[id]/send-whatsapp`) | User when a session exists, patient when the sign token is used | document |
| Cron confirmations, cron anamnesis auto-send, webhook anamnesis auto-send | System | template |

## Sentences

Built on the client by `describeLedgerEntry(entry)` in `lib/whatsapp-credit-ledger.ts`. Bold marks a name from the record.

| Line | Sentence |
|---|---|
| user + template | "**Ana Souza** enviou **Link de anamnese** para **Maria Silva**" |
| user + text | "**Ana Souza** enviou uma mensagem para **Maria Silva**" |
| user + media | "**Ana Souza** enviou um arquivo para **Maria Silva**" |
| user + document | "**Ana Souza** enviou o documento **Atestado** para **Maria Silva**" |
| patient + document | "**Maria Silva** pediu uma cópia do **Termo de consentimento**" |
| system + any item | "Envio automático: **Lembrete de consulta** para **Maria Silva**" (a mensagem / um arquivo / o documento X for non-template items) |
| refund, `send_failed` | "Estorno: o envio de **Link de anamnese** para **Maria Silva** falhou" |
| refund, `delivery_failed` | "Estorno: o WhatsApp não entregou **Link de anamnese** para **Maria Silva**" |

Name fallbacks:

- Template label: `PURPOSE_LABELS[purpose_key]`, else `template_name`.
- Recipient: current patient name, else `contact_name`, else `contact_phone`.
- User: current user full name, else "Usuário removido".
- A refund line takes item and recipient from its spend line (`refund_of` join).

## API

`GET /api/whatsapp/credits/ledger?periodId=<uuid>&cursor=<opaque>`

- `requireRole('owner')`. Read-only, no subscription gate.
- Without `periodId`: the tenant's current period.
- A `periodId` that does not belong to `ctx.tenantId` returns 404.
- Response:

```ts
{
  periods: { id: string; start: string; end: string; used: number; total: number }[] // newest first
  entries: {
    id: string
    kind: 'spend' | 'refund'
    amount: number
    refundReason: 'send_failed' | 'delivery_failed' | null
    actor: { type: 'user' | 'patient' | 'system'; name: string | null }
    recipientName: string
    item: { kind: 'template' | 'text' | 'media' | 'document'; label: string | null }
    createdAt: string
  }[]
  nextCursor: string | null
}
```

- Order: `created_at desc, id desc`. Page size 50. The cursor encodes `(created_at, id)` of the last row.

## UI

In `whatsapp-settings-form.tsx`, "Uso de créditos" section (shared-number clinics only, owner only as today):

- "Ver histórico" button under `WhatsAppCreditBar`.
- Opens `WhatsAppCreditHistory`: `Dialog` on desktop, full-height `Sheet` on mobile, both from the existing UI components.
- Content:
  1. Period `Select`, current first, label "01/10 a 31/10/2026" (periods are BR calendar months), with "N de M créditos usados" for the selected period.
  2. Entries grouped under day headings (`dd/MM`, BRT). Each line: `HH:mm`, the sentence, and the amount at the right (`-1` red, `+1` green).
  3. "Carregar mais" while `nextCursor` is set (`useInfiniteQuery`).
  4. Empty state: "Nenhum crédito usado neste período".
- At 390px the sentence wraps under the time; the amount stays right-aligned.

Dates go through `@/lib/dates` helpers per AGENTS.md.

## Errors

| Case | Behavior |
|---|---|
| Credits exhausted | Transaction writes nothing; `CreditExhaustedError` (402) as today. |
| Ledger insert fails at spend | Transaction rolls back the counter too; no send; caller gets 500. |
| `meta_message_id` update fails after send | Sentry report; the line stays without the id; a later `failed` webhook cannot refund that message. |
| Refund fails after send throws | Sentry report; original error rethrown; spend stays unrefunded. |
| Duplicate `failed` webhook | Unique `refund_of` blocks the second refund; ignored. |
| `failed` webhook before `meta_message_id` is attached | No spend found, no refund (same race as before the ledger). |
| Refund after the month rolls over | The credit and the refund line go to the spend's period. |
| Patient-triggered resume template | Shown as "Envio automático: Retomar conversa para Maria Silva"; the patient sentence is only for documents. |

## Migrations `0037` (before deploy) and `0038` (after deploy)

1. Create `whatsapp_credit_ledger` with indexes and RLS.
2. Add `credit_context jsonb` to `whatsapp_queued_messages`.
3. Copy existing `whatsapp_credit_charges` rows as `spend` lines (`actor_type = 'system'`, `item_kind = 'template'` when the joined message has a `template_name`, else `text`; recipient from the joined conversation). Rows with `refunded_at` also get a `delivery_failed` refund line.
4. `0038`, after the deploy: copy any charges and refunds the old code wrote in between (idempotent), then drop `whatsapp_credit_charges`.

Queued rows created before deploy have no `credit_context` and drain as `system`.

## Testing

Per the `test-audit` gate; every regression test is seen failing first.

- Credit queries against local Docker Postgres: spend writes counter and line together; exhausted spend writes nothing; refund reverses the spend; a second refund is ignored; per-period sum of `amount` equals `-credits_used`.
- `sendWithCredits`: a throwing send writes a `send_failed` refund; a successful send attaches `meta_message_id`; own-number clinics write nothing.
- Webhook `failed` status writes one `delivery_failed` refund.
- Queue drain uses the queuing user's `credit_context`.
- `describeLedgerEntry`: one table row per sentence above, plus each name fallback.
- Ledger API: owner only; 404 for another tenant's period; cursor paging.
- UI: the button opens the history; "Carregar mais" loads the next page. Manual browser check at 1280px and 390px on local Docker.
