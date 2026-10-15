# WhatsApp Credit Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write one ledger line per WhatsApp credit spend and per refund on the shared number, and show the owner a plain-language history from "Uso de créditos".

**Architecture:** A new `whatsapp_credit_ledger` table replaces `whatsapp_credit_charges`. `sendWithCredits` takes a required `CreditContext` (actor + recipient) and writes the spend line in the same transaction as the counter; refunds write their own line in the same transaction as the counter decrement. A read-only owner API returns structured lines; the client turns them into sentences with a pure function.

**Tech Stack:** Next.js 16 route handlers, Drizzle (postgres-js), Postgres schema `floraclin`, TanStack Query v5, Vitest, Tailwind, existing `components/ui` (Dialog, Sheet, Select, Button).

**Spec:** `docs/superpowers/specs/2026-10-15-whatsapp-credit-ledger-design.md`

Two refinements over the spec, same behavior: (1) callers pass only actor, recipient and an optional `documentLabel`; each send function derives the item kind, and `sendTemplateMessage` reads `purposeKey` from the template row it already loads for the cost. (2) A refund line copies the item and recipient columns of its spend at insert time, so the list query needs no self-join.

## Global Constraints

- Working directory for all commands: `/Users/giorgiofellipe/Work/floraclin-credits/web` (git root is its parent).
- Never use em dashes (`—`) or en dashes in any new code, comment, string, or commit message.
- Comments only when a competent reader would get it wrong without one, 1 to 2 lines.
- Dates: never `new Date('YYYY-MM-DD')` bare, never `.toISOString().split('T')[0]`. Use `@/lib/dates` (`BR_TZ`, `toBrYmd`, ...). Time-of-day formatting in BR uses `formatInTimeZone(date, BR_TZ, 'HH:mm')` from `date-fns-tz`.
- No backward-compatibility layers: delete `whatsapp_credit_charges`, `recordCharge`, `refundCredits`, `refundFailedCharge`, `consumeCredits`.
- Commit messages: plain, human-authored, no mention of Claude or AI, no `Co-Authored-By`.
- Tests: no test may hit Supabase. DB integration tests use local Docker Postgres (`pnpm test:db:up`, port 5433) and the `describeIntegration` guard (`RUN_DB_TESTS`).
- Each bug-regression test is seen failing before its implementation step.
- Only touch the files listed in your task.

## Shared Interfaces (all tasks rely on these exact names)

`web/src/lib/whatsapp-credit-ledger.ts` (Task 2, client-safe, no server imports):

```ts
export type CreditActor = { type: 'user'; userId: string } | { type: 'patient' } | { type: 'system' }

export interface CreditRecipient {
  patientId: string | null
  conversationId?: string | null
  name: string | null
}

export interface CreditContext {
  actor: CreditActor
  recipient: CreditRecipient
  // Set only for sendOrEnqueueDocument / a media send of a named document.
  documentLabel?: string
}

export type LedgerItemKind = 'template' | 'text' | 'media' | 'document'
export type LedgerRefundReason = 'send_failed' | 'delivery_failed'

export interface LedgerEntry {
  id: string
  kind: 'spend' | 'refund'
  amount: number
  refundReason: LedgerRefundReason | null
  actor: { type: CreditActor['type']; name: string | null }
  recipientName: string
  item: { kind: LedgerItemKind; label: string | null }
  createdAt: string
}

export interface LedgerPeriod { id: string; start: string; end: string; used: number; total: number }

export interface LedgerPage { periods: LedgerPeriod[]; periodId: string; entries: LedgerEntry[]; nextCursor: string | null }

export type SentencePart = { text: string; strong: boolean }
export function describeLedgerEntry(entry: LedgerEntry): SentencePart[]
```

`web/src/db/queries/whatsapp-credits.ts` (Task 1):

```ts
export type LedgerSpendInput = {
  actorType: 'user' | 'patient' | 'system'
  actorUserId: string | null
  patientId: string | null
  conversationId: string | null
  contactName: string | null
  contactPhone: string
  itemKind: 'template' | 'text' | 'media' | 'document'
  templateName: string | null
  purposeKey: string | null
  documentLabel: string | null
}

export type SpendResult =
  | { allowed: true; spendId: string; creditsUsed: number; creditsTotal: number }
  | { allowed: false; creditsUsed: number; creditsTotal: number }

export async function spendCredits(tenantId: string, cost: number, entry: LedgerSpendInput): Promise<SpendResult>
export async function attachMetaMessageId(spendId: string, metaMessageId: string): Promise<void>
export async function refundSpend(spendId: string, reason: 'send_failed' | 'delivery_failed'): Promise<boolean>
export async function refundSpendByMetaMessageId(metaMessageId: string): Promise<boolean>
// unchanged: getOrCreateCurrentPeriod, getCreditUsage
```

`web/src/lib/whatsapp.ts` (Task 3), new signatures (credit is always the 2nd argument):

```ts
sendTextMessage(tenantId: string, credit: CreditContext, to: string, body: string)
sendTemplateMessage(tenantId: string, credit: CreditContext, to: string, templateName: string, language: string, params?: Record<string, string>, buttonParams?: TemplateButtonParam[])
sendMediaMessage(tenantId: string, credit: CreditContext, to: string, mediaType: 'image' | 'document' | 'audio' | 'video', mediaUrl: string, caption?: string, filename?: string)
sendOrEnqueueDocument(tenantId: string, credit: CreditContext & { documentLabel: string }, to: string, patientFirstName: string, mediaUrl: string, caption: string, filename: string, storagePath?: string)
```

`web/src/db/queries/whatsapp.ts` (Task 3): `createQueuedMessage(tenantId, conversationId, data)` gains `data.creditContext?: CreditContext | null`; `WhatsappQueuedMessage.creditContext` is `unknown` (jsonb) and is read with a cast.

API (Task 4): `GET /api/whatsapp/credits/ledger?periodId=<uuid>&cursor=<string>` returns `LedgerPage`. Owner only.

## Review Focus

1. Concurrent sends at the last credit: two requests race for the final credit; exactly one spend line is written and the counter never exceeds total (guarded update inside the transaction). Pinned in Task 1.
2. Duplicate Meta `failed` webhooks for one message: only one refund line, counter decremented once. Pinned in Task 1 (`refundSpend` twice) and Task 8 (webhook).
3. A send that throws after the spend: the caller still sees the original Meta error even if the refund write fails. Pinned in Task 3.
4. A queued message from before deploy (no `credit_context`) drains as `system` instead of crashing. Pinned in Task 8.
5. A `periodId` belonging to another tenant, or a garbage `cursor`, returns 404 / 400 and never leaks rows. Pinned in Task 4.

---

## Parallelization Groups

```
Group A (parallel):
  Task 1: Ledger storage: migration, schema, write queries (files: src/db/migrations/0037_whatsapp_credit_ledger.sql, src/db/schema.ts, src/db/queries/whatsapp-credits.ts, src/db/queries/__tests__/whatsapp-credits-ledger.test.ts)
  Task 2: Ledger types + sentence builder (files: src/lib/whatsapp-credit-ledger.ts, src/lib/__tests__/whatsapp-credit-ledger.test.ts)

Group B (depends on A):
  Task 3: sendWithCredits + send functions + queue context (files: src/lib/whatsapp.ts, src/lib/__tests__/whatsapp.test.ts, src/db/queries/whatsapp.ts)
  Task 4: Ledger read query + API route (files: src/db/queries/whatsapp-credit-ledger.ts, src/app/api/whatsapp/credits/ledger/route.ts, src/app/api/whatsapp/credits/ledger/__tests__/route.test.ts)
  Task 5: History UI (files: src/hooks/queries/use-whatsapp-credit-ledger.ts, src/hooks/queries/query-keys.ts, src/components/settings/whatsapp-credit-history.tsx, src/components/settings/__tests__/whatsapp-credit-history.test.tsx, src/components/settings/whatsapp-settings-form.tsx)

Group C (depends on B; typecheck is red between B and C until these land):
  Task 6: Inbox callers (files: src/app/api/whatsapp/conversations/[id]/messages/route.ts, src/app/api/whatsapp/conversations/route.ts, src/app/api/whatsapp/conversations/[id]/messages/[messageId]/retry/route.ts, plus any existing __tests__ in those three route folders)
  Task 7: Link and document callers (files: src/app/api/patients/[id]/anamnesis-link/send/route.ts, src/app/api/consent/send-signing-link/send/route.ts, src/app/api/clinical-documents/[id]/send-whatsapp/route.ts, src/app/api/consent/[id]/send-whatsapp/route.ts, plus existing __tests__ in those four route folders)
  Task 8: System callers + webhook (files: src/app/api/cron/whatsapp-automations/route.ts, src/lib/whatsapp-anamnesis.ts, src/app/api/webhooks/whatsapp/route.ts, src/app/api/cron/whatsapp-automations/__tests__/route.test.ts, src/lib/__tests__/whatsapp-anamnesis.test.ts, src/app/api/webhooks/whatsapp/__tests__/*.test.ts)
```

Between groups the orchestrator runs the tests of the finished tasks. After Group C: `pnpm ci:checks` from the repo root.

---

### Task 1: Ledger storage

**Files:**
- Create: `web/src/db/migrations/0037_whatsapp_credit_ledger.sql`
- Modify: `web/src/db/schema.ts` (replace `whatsappCreditCharges` near line 1093; add `creditContext` to `whatsappQueuedMessages` near line 791)
- Modify: `web/src/db/queries/whatsapp-credits.ts`
- Test: `web/src/db/queries/__tests__/whatsapp-credits-ledger.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `whatsappCreditLedger` table export; `LedgerSpendInput`, `SpendResult`, `spendCredits`, `attachMetaMessageId`, `refundSpend`, `refundSpendByMetaMessageId` (signatures in Shared Interfaces). Removes `whatsappCreditCharges`, `consumeCredits`, `refundCredits`, `recordCharge`, `refundFailedCharge`.

- [ ] **Step 1: Schema**

In `schema.ts`, delete the `whatsappCreditCharges` table and its comment. Add in its place:

```ts
// One line per credit movement on the shared number; refunds point at their spend.
export const whatsappCreditLedger = floraclinSchema.table('whatsapp_credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  creditPeriodId: uuid('credit_period_id').notNull().references(() => whatsappCredits.id),
  kind: varchar('kind', { length: 10 }).notNull(),
  amount: integer('amount').notNull(),
  metaMessageId: varchar('meta_message_id', { length: 255 }),
  refundOf: uuid('refund_of').references((): AnyPgColumn => whatsappCreditLedger.id),
  refundReason: varchar('refund_reason', { length: 20 }),
  actorType: varchar('actor_type', { length: 10 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  patientId: uuid('patient_id').references(() => patients.id),
  conversationId: uuid('conversation_id').references(() => whatsappConversations.id),
  contactName: varchar('contact_name', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 30 }).notNull(),
  itemKind: varchar('item_kind', { length: 10 }).notNull(),
  templateName: varchar('template_name', { length: 255 }),
  purposeKey: varchar('purpose_key', { length: 100 }),
  documentLabel: varchar('document_label', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_whatsapp_credit_ledger_period').on(table.tenantId, table.creditPeriodId, table.createdAt, table.id),
  uniqueIndex('uq_whatsapp_credit_ledger_refund_of').on(table.refundOf).where(sql`refund_of IS NOT NULL`),
  uniqueIndex('uq_whatsapp_credit_ledger_spend_meta').on(table.metaMessageId).where(sql`meta_message_id IS NOT NULL AND kind = 'spend'`),
])
```

In `whatsappQueuedMessages`, add after `resumeMetaMessageId`:

```ts
  creditContext: jsonb('credit_context'),
```

Grep the file for any `relations(` block or type export mentioning `whatsappCreditCharges` and remove it.

- [ ] **Step 2: Migration**

Create `0037_whatsapp_credit_ledger.sql` (statements separated by `--> statement-breakpoint`, same style as 0036):

```sql
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
	"credit_period_id" uuid NOT NULL REFERENCES "floraclin"."whatsapp_credits"("id"),
	"kind" varchar(10) NOT NULL,
	"amount" integer NOT NULL,
	"meta_message_id" varchar(255),
	"refund_of" uuid REFERENCES "floraclin"."whatsapp_credit_ledger"("id"),
	"refund_reason" varchar(20),
	"actor_type" varchar(10) NOT NULL,
	"actor_user_id" uuid REFERENCES "floraclin"."users"("id"),
	"patient_id" uuid REFERENCES "floraclin"."patients"("id"),
	"conversation_id" uuid REFERENCES "floraclin"."whatsapp_conversations"("id"),
	"contact_name" varchar(255),
	"contact_phone" varchar(30) NOT NULL,
	"item_kind" varchar(10) NOT NULL,
	"template_name" varchar(255),
	"purpose_key" varchar(100),
	"document_label" varchar(255),
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_credit_ledger_period" ON "floraclin"."whatsapp_credit_ledger" USING btree ("tenant_id","credit_period_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_credit_ledger_refund_of" ON "floraclin"."whatsapp_credit_ledger" USING btree ("refund_of") WHERE refund_of IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_credit_ledger_spend_meta" ON "floraclin"."whatsapp_credit_ledger" USING btree ("meta_message_id") WHERE meta_message_id IS NOT NULL AND kind = 'spend';--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_queued_messages" ADD COLUMN IF NOT EXISTS "credit_context" jsonb;--> statement-breakpoint
INSERT INTO "floraclin"."whatsapp_credit_ledger"
	("id","tenant_id","credit_period_id","kind","amount","meta_message_id","actor_type","patient_id","conversation_id","contact_name","contact_phone","item_kind","template_name","created_at")
SELECT c.id, c.tenant_id, c.credit_period_id, 'spend', -c.cost, c.meta_message_id, 'system',
	conv.patient_id, conv.id, conv.profile_name, COALESCE(conv.phone_number, ''),
	CASE WHEN m.template_name IS NOT NULL THEN 'template' WHEN m.media_type IS NOT NULL THEN 'media' ELSE 'text' END,
	m.template_name, c.created_at
FROM "floraclin"."whatsapp_credit_charges" c
LEFT JOIN "floraclin"."whatsapp_messages" m ON m.meta_message_id = c.meta_message_id
LEFT JOIN "floraclin"."whatsapp_conversations" conv ON conv.id = m.conversation_id;--> statement-breakpoint
INSERT INTO "floraclin"."whatsapp_credit_ledger"
	("tenant_id","credit_period_id","kind","amount","refund_of","refund_reason","actor_type","patient_id","conversation_id","contact_name","contact_phone","item_kind","template_name","created_at")
SELECT l.tenant_id, l.credit_period_id, 'refund', -l.amount, l.id, 'delivery_failed', 'system',
	l.patient_id, l.conversation_id, l.contact_name, l.contact_phone, l.item_kind, l.template_name, c.refunded_at
FROM "floraclin"."whatsapp_credit_charges" c
JOIN "floraclin"."whatsapp_credit_ledger" l ON l.id = c.id
WHERE c.refunded_at IS NOT NULL;--> statement-breakpoint
DROP TABLE "floraclin"."whatsapp_credit_charges";
```

- [ ] **Step 3: Write the failing integration test**

`web/src/db/queries/__tests__/whatsapp-credits-ledger.test.ts`. Pattern from `procedure-sessions.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { tenants, whatsappCredits, whatsappCreditLedger } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import {
  spendCredits,
  attachMetaMessageId,
  refundSpend,
  refundSpendByMetaMessageId,
  getOrCreateCurrentPeriod,
  type LedgerSpendInput,
} from '../whatsapp-credits'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-00000000c0de'
const ENTRY: LedgerSpendInput = {
  actorType: 'system', actorUserId: null, patientId: null, conversationId: null,
  contactName: 'Maria Silva', contactPhone: '5511999990000',
  itemKind: 'text', templateName: null, purposeKey: null, documentLabel: null,
}

async function setTotal(total: number) {
  const period = await getOrCreateCurrentPeriod(TENANT)
  await db.update(whatsappCredits).set({ creditsTotal: total, creditsUsed: 0 }).where(eq(whatsappCredits.id, period.id))
  return period.id
}

async function ledgerSum(periodId: string) {
  const [row] = await db.select({ s: sql<number>`coalesce(sum(amount), 0)::int` })
    .from(whatsappCreditLedger).where(eq(whatsappCreditLedger.creditPeriodId, periodId))
  return row.s
}

async function used(periodId: string) {
  const [row] = await db.select().from(whatsappCredits).where(eq(whatsappCredits.id, periodId))
  return row.creditsUsed
}

describeIntegration('whatsapp credit ledger (integration, requires test DB)', () => {
  beforeAll(async () => {
    // Insert a minimal tenant row; read `tenants` in schema.ts for the NOT NULL columns.
    await db.insert(tenants).values({ id: TENANT, name: 'Ledger Test', slug: 'ledger-test' } as never).onConflictDoNothing()
  })

  beforeEach(async () => {
    await db.delete(whatsappCreditLedger).where(eq(whatsappCreditLedger.tenantId, TENANT))
  })

  it('writes the counter and one spend line together', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 3, ENTRY)
    expect(res.allowed).toBe(true)
    expect(await used(periodId)).toBe(3)
    expect(await ledgerSum(periodId)).toBe(-3)
  })

  it('writes nothing when credits are exhausted', async () => {
    const periodId = await setTotal(1)
    const res = await spendCredits(TENANT, 3, ENTRY)
    expect(res.allowed).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
  })

  it('lets only one of two racing spends take the last credit', async () => {
    const periodId = await setTotal(1)
    const results = await Promise.all([spendCredits(TENANT, 1, ENTRY), spendCredits(TENANT, 1, ENTRY)])
    expect(results.filter((r) => r.allowed)).toHaveLength(1)
    expect(await used(periodId)).toBe(1)
    expect(await ledgerSum(periodId)).toBe(-1)
  })

  it('refunds a spend once, with its own line, even when asked twice', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 1, ENTRY)
    if (!res.allowed) throw new Error('expected allowed')
    expect(await refundSpend(res.spendId, 'send_failed')).toBe(true)
    expect(await refundSpend(res.spendId, 'send_failed')).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
    const lines = await db.select().from(whatsappCreditLedger).where(eq(whatsappCreditLedger.creditPeriodId, periodId))
    const refund = lines.find((l) => l.kind === 'refund')
    expect(refund).toMatchObject({ amount: 1, refundOf: res.spendId, refundReason: 'send_failed', contactName: 'Maria Silva' })
  })

  it('refunds by Meta message id for a delivery failure', async () => {
    const periodId = await setTotal(10)
    const res = await spendCredits(TENANT, 3, ENTRY)
    if (!res.allowed) throw new Error('expected allowed')
    await attachMetaMessageId(res.spendId, 'wamid.ledger-1')
    expect(await refundSpendByMetaMessageId('wamid.ledger-1')).toBe(true)
    expect(await refundSpendByMetaMessageId('wamid.ledger-1')).toBe(false)
    expect(await refundSpendByMetaMessageId('wamid.unknown')).toBe(false)
    expect(await used(periodId)).toBe(0)
    expect(await ledgerSum(periodId)).toBe(0)
  })
})
```

- [ ] **Step 4: Run it to see it fail**

```bash
pnpm test:db:up
DATABASE_URL=postgresql://test:test@localhost:5433/floraclin_test pnpm exec tsx -e "import('./e2e/helpers/test-db').then(m => m.prepareTestDatabase())"
DATABASE_URL=postgresql://test:test@localhost:5433/floraclin_test RUN_DB_TESTS=1 pnpm exec vitest run src/db/queries/__tests__/whatsapp-credits-ledger.test.ts
```

Expected: FAIL (imports `spendCredits` etc. do not exist). If `prepareTestDatabase` reports migration errors unrelated to 0037, note them and continue; the ledger table must exist afterwards (`psql postgresql://test:test@localhost:5433/floraclin_test -c '\d floraclin.whatsapp_credit_ledger'`).

- [ ] **Step 5: Implement the queries**

In `whatsapp-credits.ts`: change the schema import to `whatsappCredits, whatsappCreditLedger, tenantSubscriptions, plans`; drop `isNull` from drizzle imports if unused. Delete `ConsumeResult`, `consumeCredits`, `refundCredits`, `recordCharge`, `refundFailedCharge`. Add (keep `getOrCreateCurrentPeriod` and `getCreditUsage` as they are):

```ts
export type LedgerSpendInput = { /* exactly as in Shared Interfaces */ }

export type SpendResult =
  | { allowed: true; spendId: string; creditsUsed: number; creditsTotal: number }
  | { allowed: false; creditsUsed: number; creditsTotal: number }

export async function spendCredits(tenantId: string, cost: number, entry: LedgerSpendInput): Promise<SpendResult> {
  const credits = await getOrCreateCurrentPeriod(tenantId)
  const unlimited = credits.creditsTotal === UNLIMITED_CREDITS
  const denied = { allowed: false as const, creditsUsed: credits.creditsUsed, creditsTotal: credits.creditsTotal }
  if (!unlimited && credits.creditsUsed + cost > credits.creditsTotal) return denied

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(whatsappCredits)
      .set({ creditsUsed: sql`${whatsappCredits.creditsUsed} + ${cost}`, updatedAt: new Date() })
      .where(and(
        eq(whatsappCredits.id, credits.id),
        unlimited ? undefined : lte(sql`${whatsappCredits.creditsUsed} + ${cost}`, whatsappCredits.creditsTotal),
      ))
      .returning()
    if (!updated) return denied

    const [line] = await tx
      .insert(whatsappCreditLedger)
      .values({ tenantId, creditPeriodId: updated.id, kind: 'spend', amount: -cost, ...entry })
      .returning({ id: whatsappCreditLedger.id })

    return { allowed: true as const, spendId: line.id, creditsUsed: updated.creditsUsed, creditsTotal: updated.creditsTotal }
  })
}

export async function attachMetaMessageId(spendId: string, metaMessageId: string): Promise<void> {
  await db.update(whatsappCreditLedger).set({ metaMessageId }).where(eq(whatsappCreditLedger.id, spendId))
}

export async function refundSpend(spendId: string, reason: 'send_failed' | 'delivery_failed'): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [spend] = await tx.select().from(whatsappCreditLedger)
      .where(and(eq(whatsappCreditLedger.id, spendId), eq(whatsappCreditLedger.kind, 'spend')))
    if (!spend) return false

    const [refund] = await tx
      .insert(whatsappCreditLedger)
      .values({
        tenantId: spend.tenantId,
        creditPeriodId: spend.creditPeriodId,
        kind: 'refund',
        amount: -spend.amount,
        refundOf: spend.id,
        refundReason: reason,
        actorType: spend.actorType,
        actorUserId: spend.actorUserId,
        patientId: spend.patientId,
        conversationId: spend.conversationId,
        contactName: spend.contactName,
        contactPhone: spend.contactPhone,
        itemKind: spend.itemKind,
        templateName: spend.templateName,
        purposeKey: spend.purposeKey,
        documentLabel: spend.documentLabel,
      })
      .onConflictDoNothing()
      .returning({ id: whatsappCreditLedger.id })
    if (!refund) return false

    await tx
      .update(whatsappCredits)
      .set({ creditsUsed: sql`greatest(${whatsappCredits.creditsUsed} - ${-spend.amount}, 0)`, updatedAt: new Date() })
      .where(eq(whatsappCredits.id, spend.creditPeriodId))
    return true
  })
}

export async function refundSpendByMetaMessageId(metaMessageId: string): Promise<boolean> {
  const [spend] = await db.select({ id: whatsappCreditLedger.id }).from(whatsappCreditLedger)
    .where(and(eq(whatsappCreditLedger.metaMessageId, metaMessageId), eq(whatsappCreditLedger.kind, 'spend')))
  if (!spend) return false
  return refundSpend(spend.id, 'delivery_failed')
}
```

- [ ] **Step 6: Run the test, expect PASS**

Same command as Step 4 (re-run `prepareTestDatabase` only if the schema changed). Expected: 5 passed. Then `pnpm test:db:down`.

- [ ] **Step 7: Commit**

```bash
git add web/src/db/migrations/0037_whatsapp_credit_ledger.sql web/src/db/schema.ts web/src/db/queries/whatsapp-credits.ts web/src/db/queries/__tests__/whatsapp-credits-ledger.test.ts
git commit -m "Add the WhatsApp credit ledger table and write queries"
```

---

### Task 2: Ledger types and sentence builder

**Files:**
- Create: `web/src/lib/whatsapp-credit-ledger.ts`
- Test: `web/src/lib/__tests__/whatsapp-credit-ledger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in Shared Interfaces for this file, plus `describeLedgerEntry`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { describeLedgerEntry, type LedgerEntry } from '../whatsapp-credit-ledger'

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'l1', kind: 'spend', amount: -1, refundReason: null,
    actor: { type: 'user', name: 'Ana Souza' },
    recipientName: 'Maria Silva',
    item: { kind: 'text', label: null },
    createdAt: '2026-10-15T13:00:00.000Z',
    ...overrides,
  }
}

const text = (e: LedgerEntry) => describeLedgerEntry(e).map((p) => p.text).join('')
const strong = (e: LedgerEntry) => describeLedgerEntry(e).filter((p) => p.strong).map((p) => p.text)

describe('describeLedgerEntry', () => {
  it.each<[string, Partial<LedgerEntry>, string]>([
    ['user template', { item: { kind: 'template', label: 'Link de anamnese' } }, 'Ana Souza enviou Link de anamnese para Maria Silva'],
    ['user text', {}, 'Ana Souza enviou uma mensagem para Maria Silva'],
    ['user media', { item: { kind: 'media', label: null } }, 'Ana Souza enviou um arquivo para Maria Silva'],
    ['user document', { item: { kind: 'document', label: 'Atestado' } }, 'Ana Souza enviou o documento Atestado para Maria Silva'],
    ['removed user', { actor: { type: 'user', name: null } }, 'Usuário removido enviou uma mensagem para Maria Silva'],
    ['patient copy', { actor: { type: 'patient', name: 'Maria Silva' }, item: { kind: 'document', label: 'Termo de consentimento' } }, 'Maria Silva pediu uma cópia do Termo de consentimento'],
    ['system template', { actor: { type: 'system', name: null }, item: { kind: 'template', label: 'Lembrete de consulta' } }, 'Envio automático: Lembrete de consulta para Maria Silva'],
    ['system text', { actor: { type: 'system', name: null } }, 'Envio automático: uma mensagem para Maria Silva'],
    ['refund send_failed template', { kind: 'refund', amount: 1, refundReason: 'send_failed', item: { kind: 'template', label: 'Link de anamnese' } }, 'Estorno: o envio de Link de anamnese para Maria Silva falhou'],
    ['refund send_failed document', { kind: 'refund', amount: 1, refundReason: 'send_failed', item: { kind: 'document', label: 'Atestado' } }, 'Estorno: o envio do documento Atestado para Maria Silva falhou'],
    ['refund delivery_failed', { kind: 'refund', amount: 3, refundReason: 'delivery_failed', item: { kind: 'template', label: 'Aniversário' } }, 'Estorno: o WhatsApp não entregou Aniversário para Maria Silva'],
  ])('%s', (_name, overrides, expected) => {
    expect(text(entry(overrides))).toBe(expected)
  })

  it('marks the names, not the glue words, as strong', () => {
    expect(strong(entry({ item: { kind: 'document', label: 'Atestado' } }))).toEqual(['Ana Souza', 'Atestado', 'Maria Silva'])
  })

  it('falls back to "um documento" when a document has no label', () => {
    expect(text(entry({ item: { kind: 'document', label: null } }))).toBe('Ana Souza enviou um documento para Maria Silva')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../whatsapp-credit-ledger'`)

Run: `pnpm exec vitest run src/lib/__tests__/whatsapp-credit-ledger.test.ts`

- [ ] **Step 3: Implement**

`web/src/lib/whatsapp-credit-ledger.ts`: paste the types from Shared Interfaces, then:

```ts
type Part = SentencePart
const plain = (text: string): Part => ({ text, strong: false })
const bold = (text: string): Part => ({ text, strong: true })

// "enviou X", "não entregou X"
function itemObject(item: LedgerEntry['item']): Part[] {
  switch (item.kind) {
    case 'template': return [bold(item.label ?? 'template')]
    case 'text': return [plain('uma mensagem')]
    case 'media': return [plain('um arquivo')]
    case 'document': return item.label ? [plain('o documento '), bold(item.label)] : [plain('um documento')]
  }
}

// "o envio de X"
function itemAfterDe(item: LedgerEntry['item']): Part[] {
  switch (item.kind) {
    case 'template': return [plain('de '), bold(item.label ?? 'template')]
    case 'text': return [plain('de uma mensagem')]
    case 'media': return [plain('de um arquivo')]
    case 'document': return item.label ? [plain('do documento '), bold(item.label)] : [plain('de um documento')]
  }
}

export function describeLedgerEntry(entry: LedgerEntry): SentencePart[] {
  const to = [plain(' para '), bold(entry.recipientName)]

  if (entry.kind === 'refund') {
    if (entry.refundReason === 'delivery_failed') {
      return [plain('Estorno: o WhatsApp não entregou '), ...itemObject(entry.item), ...to]
    }
    return [plain('Estorno: o envio '), ...itemAfterDe(entry.item), ...to, plain(' falhou')]
  }

  switch (entry.actor.type) {
    case 'user':
      return [bold(entry.actor.name ?? 'Usuário removido'), plain(' enviou '), ...itemObject(entry.item), ...to]
    case 'patient':
      return [bold(entry.recipientName), plain(' pediu uma cópia do '), bold(entry.item.label ?? 'documento')]
    case 'system':
      return [plain('Envio automático: '), ...itemObject(entry.item), ...to]
  }
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/whatsapp-credit-ledger.ts web/src/lib/__tests__/whatsapp-credit-ledger.test.ts
git commit -m "Add credit ledger types and sentence builder"
```

---

### Task 3: sendWithCredits writes the ledger

**Files:**
- Modify: `web/src/lib/whatsapp.ts` (lines ~114-380: `sendWithCredits`, `sendTextMessage`, `sendTemplateMessage`, `sendMediaMessage`, `sendOrEnqueueDocument`)
- Modify: `web/src/db/queries/whatsapp.ts` (`createQueuedMessage`, ~line 939)
- Test: `web/src/lib/__tests__/whatsapp.test.ts` (the `credits on the shared number` describe, ~line 141, and the `sendMediaMessage` describe, ~line 78)

**Interfaces:**
- Consumes: Task 1 `spendCredits`, `attachMetaMessageId`, `refundSpend`, `LedgerSpendInput`; Task 2 `CreditContext`.
- Produces: the four send signatures in Shared Interfaces; `createQueuedMessage` `data.creditContext`.

- [ ] **Step 1: Update the tests first**

In `whatsapp.test.ts` replace the credit mocks:

```ts
const spendCreditsMock = vi.fn()
const attachMetaMessageIdMock = vi.fn(async () => undefined)
const refundSpendMock = vi.fn(async () => true)

vi.mock('@/db/queries/whatsapp-credits', () => ({
  spendCredits: spendCreditsMock,
  attachMetaMessageId: attachMetaMessageIdMock,
  refundSpend: refundSpendMock,
  getOrCreateCurrentPeriod: /* keep whatever the file already mocks for requireCredits */,
}))

const CREDIT = { actor: { type: 'user' as const, userId: 'user-1' }, recipient: { patientId: 'patient-1', name: 'Maria Silva' } }
```

Default `spendCreditsMock.mockResolvedValue({ allowed: true, spendId: 'spend-1', creditsUsed: 1, creditsTotal: 100 })`. Rewrite each existing assertion:
- `consumeCreditsMock).toHaveBeenCalledWith('tenant-1', cost)` becomes
  ```ts
  expect(spendCreditsMock).toHaveBeenCalledWith('tenant-1', cost, expect.objectContaining({
    actorType: 'user', actorUserId: 'user-1', patientId: 'patient-1', contactName: 'Maria Silva',
    contactPhone: '5511999990000', itemKind: 'template', templateName: <name used>, purposeKey: <purposeKey of the mocked template or null>,
  }))
  expect(attachMetaMessageIdMock).toHaveBeenCalledWith('spend-1', 'wamid.123')
  ```
- `refundCreditsMock).toHaveBeenCalledWith('period-1', 3)` becomes `expect(refundSpendMock).toHaveBeenCalledWith('spend-1', 'send_failed')` and `expect(attachMetaMessageIdMock).not.toHaveBeenCalled()`.
- `keeps the Meta error when the refund itself fails`: `refundSpendMock.mockRejectedValueOnce(new Error('db down'))`, still expects the Meta error.
- Every `sendTextMessage / sendTemplateMessage / sendMediaMessage` call in the file gets `CREDIT` as the 2nd argument.

Add two tests in the credits describe:

```ts
it('records a named document send as a document line', async () => {
  // mock fetch for a successful media send as the existing sendMediaMessage tests do
  await sendMediaMessage('tenant-1', { ...CREDIT, documentLabel: 'Atestado' }, '5511999990000', 'document', 'https://x/doc.pdf', 'Atestado', 'atestado.pdf')
  expect(spendCreditsMock).toHaveBeenCalledWith('tenant-1', 1, expect.objectContaining({ itemKind: 'document', documentLabel: 'Atestado' }))
})

it('still sends when attaching the message id fails', async () => {
  attachMetaMessageIdMock.mockRejectedValueOnce(new Error('db down'))
  const res = await sendTextMessage('tenant-1', CREDIT, '5511999990000', 'oi')
  expect(res.metaMessageId).toBe('wamid.123')
  expect(refundSpendMock).not.toHaveBeenCalled()
})
```

Keep the own-number test, asserting `spendCreditsMock` is not called.

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm exec vitest run src/lib/__tests__/whatsapp.test.ts`
Expected: failures on `spendCreditsMock` not called / argument mismatch.

- [ ] **Step 3: Implement in `whatsapp.ts`**

Imports: `import type { CreditContext, LedgerItemKind } from '@/lib/whatsapp-credit-ledger'`.

```ts
type ResolvedCharge = {
  cost: number
  item: { kind: LedgerItemKind; templateName: string | null; purposeKey: string | null; documentLabel: string | null }
}

// Every message on the shared number is charged to the tenant, including ones
// Meta may not bill (free-form, open-window utility): its rules keep changing.
async function sendWithCredits<T extends { metaMessageId: string }>(
  tenantId: string,
  credit: CreditContext,
  to: string,
  resolve: () => Promise<ResolvedCharge>,
  send: () => Promise<T>,
): Promise<T> {
  await requireSendAllowed(tenantId)
  if ((await getWhatsAppMode(tenantId)) !== 'floraclin') return send()

  const { spendCredits, attachMetaMessageId, refundSpend } = await import('@/db/queries/whatsapp-credits')
  const { cost, item } = await resolve()
  const charge = await spendCredits(tenantId, cost, {
    actorType: credit.actor.type,
    actorUserId: credit.actor.type === 'user' ? credit.actor.userId : null,
    patientId: credit.recipient.patientId,
    conversationId: credit.recipient.conversationId ?? null,
    contactName: credit.recipient.name,
    contactPhone: to,
    itemKind: item.kind,
    templateName: item.templateName,
    purposeKey: item.purposeKey,
    documentLabel: item.documentLabel,
  })
  if (!charge.allowed) {
    throw new CreditExhaustedError(charge.creditsUsed, charge.creditsTotal, cost)
  }

  let sent: T
  try {
    sent = await send()
  } catch (err) {
    await refundSpend(charge.spendId, 'send_failed').catch((refundErr) =>
      reportSideEffectFailure(refundErr, { area: 'whatsapp_credits', step: 'refund', extra: { tenantId, cost } }),
    )
    throw err
  }

  // The message is already out; a failed bookkeeping write must not make the
  // caller treat it as unsent and send it again.
  await attachMetaMessageId(charge.spendId, sent.metaMessageId).catch((err) =>
    reportSideEffectFailure(err, { area: 'whatsapp_credits', step: 'attach_message_id', extra: { tenantId } }),
  )
  return sent
}

function flatCharge(kind: LedgerItemKind, documentLabel: string | null = null) {
  return async (): Promise<ResolvedCharge> => ({
    cost: DEFAULT_CREDIT_COST,
    item: { kind, templateName: null, purposeKey: null, documentLabel },
  })
}
```

Delete `flatCost`. New send functions:

```ts
export async function sendTextMessage(tenantId: string, credit: CreditContext, to: string, body: string) {
  return sendWithCredits(tenantId, credit, to, flatCharge('text'), () => postTextMessage(tenantId, to, body))
}

export async function sendTemplateMessage(
  tenantId: string,
  credit: CreditContext,
  to: string,
  templateName: string,
  language: string,
  params?: Record<string, string>,
  buttonParams?: TemplateButtonParam[],
) {
  return sendWithCredits(
    tenantId,
    credit,
    to,
    async () => {
      const { getSendableTemplate } = await import('@/db/queries/whatsapp')
      const template = await getSendableTemplate(tenantId, templateName, language)
      if (!template) throw new WhatsAppTemplateNotFoundError(templateName, language)
      return {
        cost: templateCreditCost(template.category),
        item: { kind: 'template', templateName, purposeKey: template.purposeKey ?? null, documentLabel: null },
      }
    },
    () => postTemplateMessage(tenantId, to, templateName, language, params, buttonParams),
  )
}

export async function sendMediaMessage(
  tenantId: string,
  credit: CreditContext,
  to: string,
  mediaType: 'image' | 'document' | 'audio' | 'video',
  mediaUrl: string,
  caption?: string,
  filename?: string,
) {
  const charge = credit.documentLabel ? flatCharge('document', credit.documentLabel) : flatCharge('media')
  return sendWithCredits(tenantId, credit, to, charge, () =>
    postMediaMessage(tenantId, to, mediaType, mediaUrl, caption, filename),
  )
}
```

`sendOrEnqueueDocument(tenantId, credit: CreditContext & { documentLabel: string }, to, patientFirstName, mediaUrl, caption, filename, storagePath?)`:
- direct send: `sendMediaMessage(tenantId, credit, to, 'document', mediaUrl, caption, filename)`
- both resume-template sends: `sendTemplateMessage(tenantId, { actor: credit.actor, recipient: credit.recipient }, to, resumeTemplate.name, resumeTemplate.language, { '1': patientFirstName })` (no documentLabel: the resume template is a template line)
- both `createQueuedMessage` calls add `creditContext: credit`.

- [ ] **Step 4: Queue context in `db/queries/whatsapp.ts`**

```ts
import type { CreditContext } from '@/lib/whatsapp-credit-ledger'
// createQueuedMessage data gains:
    creditContext?: CreditContext | null
// and the insert values gain:
      creditContext: data.creditContext ?? null,
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm exec vitest run src/lib/__tests__/whatsapp.test.ts src/lib/__tests__/whatsapp-credit-ledger.test.ts`

Typecheck is expected to fail only at callers owned by Tasks 6 to 8. Check with `pnpm typecheck 2>&1 | grep -v "conversations\|anamnesis-link\|send-signing-link\|clinical-documents\|consent/\[id\]\|cron/whatsapp\|whatsapp-anamnesis\|webhooks/whatsapp"` and fix anything left in your own files.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/whatsapp.ts web/src/lib/__tests__/whatsapp.test.ts web/src/db/queries/whatsapp.ts
git commit -m "Write a ledger line for every WhatsApp credit spend and refund"
```

---

### Task 4: Ledger read query and API

**Files:**
- Create: `web/src/db/queries/whatsapp-credit-ledger.ts`
- Create: `web/src/app/api/whatsapp/credits/ledger/route.ts`
- Test: `web/src/app/api/whatsapp/credits/ledger/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 1 `whatsappCreditLedger`, `getOrCreateCurrentPeriod`; Task 2 `LedgerEntry`, `LedgerPeriod`, `LedgerPage`.
- Produces: `GET /api/whatsapp/credits/ledger` returning `LedgerPage`; `listCreditPeriods(tenantId)`, `listLedgerEntries(tenantId, periodId, cursor, limit)`, `encodeLedgerCursor`, `decodeLedgerCursor`.

- [ ] **Step 1: Read queries**

```ts
import { db } from '@/db/client'
import { whatsappCredits, whatsappCreditLedger, users, patients } from '@/db/schema'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { PURPOSE_LABELS } from '@/lib/whatsapp-blueprints'
import type { LedgerEntry, LedgerPeriod } from '@/lib/whatsapp-credit-ledger'

export type LedgerCursor = { createdAt: Date; id: string }
export const LEDGER_PAGE_SIZE = 50

export function encodeLedgerCursor(c: LedgerCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url')
}

export function decodeLedgerCursor(raw: string): LedgerCursor | null {
  const [iso, id] = Buffer.from(raw, 'base64url').toString().split('|')
  const createdAt = new Date(iso)
  if (!id || Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id }
}

export async function listCreditPeriods(tenantId: string): Promise<LedgerPeriod[]> {
  const rows = await db.select().from(whatsappCredits)
    .where(eq(whatsappCredits.tenantId, tenantId))
    .orderBy(desc(whatsappCredits.periodStart))
  return rows.map((r) => ({
    id: r.id, start: r.periodStart.toISOString(), end: r.periodEnd.toISOString(), used: r.creditsUsed, total: r.creditsTotal,
  }))
}

export async function listLedgerEntries(
  tenantId: string,
  periodId: string,
  cursor: LedgerCursor | null,
  limit = LEDGER_PAGE_SIZE,
): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const l = whatsappCreditLedger
  const rows = await db
    .select({ line: l, userName: users.fullName, patientName: patients.fullName })
    .from(l)
    .leftJoin(users, eq(users.id, l.actorUserId))
    .leftJoin(patients, eq(patients.id, l.patientId))
    .where(and(
      eq(l.tenantId, tenantId),
      eq(l.creditPeriodId, periodId),
      cursor ? or(lt(l.createdAt, cursor.createdAt), and(eq(l.createdAt, cursor.createdAt), lt(l.id, cursor.id))) : undefined,
    ))
    .orderBy(desc(l.createdAt), desc(l.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    entries: page.map(({ line, userName, patientName }) => {
      const recipientName = patientName ?? line.contactName ?? line.contactPhone
      const actorType = line.actorType as LedgerEntry['actor']['type']
      return {
        id: line.id,
        kind: line.kind as LedgerEntry['kind'],
        amount: line.amount,
        refundReason: (line.refundReason as LedgerEntry['refundReason']) ?? null,
        actor: { type: actorType, name: actorName(actorType, userName, recipientName) },
        recipientName,
        item: {
          kind: line.itemKind as LedgerEntry['item']['kind'],
          label: line.itemKind === 'template'
            ? (line.purposeKey && PURPOSE_LABELS[line.purposeKey]) || line.templateName
            : line.documentLabel,
        },
        createdAt: line.createdAt.toISOString(),
      }
    }),
    nextCursor: rows.length > limit && last ? encodeLedgerCursor({ createdAt: last.line.createdAt, id: last.line.id }) : null,
  }
}
```

with, above `listLedgerEntries`:

```ts
function actorName(type: LedgerEntry['actor']['type'], userName: string | null, recipientName: string): string | null {
  if (type === 'user') return userName
  if (type === 'patient') return recipientName
  return null
}
```

- [ ] **Step 2: Write the failing route test**

Mock `@/lib/auth` (`requireRole`), `@/db/queries/whatsapp-credits` (`getOrCreateCurrentPeriod`), and `@/db/queries/whatsapp-credit-ledger` (`listCreditPeriods`, `listLedgerEntries`; keep `decodeLedgerCursor` real via `vi.importActual`). Cases:

```ts
it('uses the current period when none is given', async () => {
  // getOrCreateCurrentPeriod -> { id: 'p2' }, listCreditPeriods -> [p2, p1]
  const res = await GET(new Request('http://x/api/whatsapp/credits/ledger'))
  expect(res.status).toBe(200)
  expect(listLedgerEntries).toHaveBeenCalledWith('tenant-1', 'p2', null)
  expect((await res.json()).periodId).toBe('p2')
})

it('returns 404 for a period of another tenant', async () => {
  const res = await GET(new Request('http://x/api/whatsapp/credits/ledger?periodId=00000000-0000-4000-8000-000000000999'))
  expect(res.status).toBe(404)
  expect(listLedgerEntries).not.toHaveBeenCalled()
})

it('returns 400 for a garbage cursor', async () => {
  const res = await GET(new Request('http://x/api/whatsapp/credits/ledger?cursor=%%%'))
  expect(res.status).toBe(400)
})

it('passes a decoded cursor through', async () => {
  const cursor = encodeLedgerCursor({ createdAt: new Date('2026-10-15T12:00:00.000Z'), id: 'l9' })
  await GET(new Request(`http://x/api/whatsapp/credits/ledger?cursor=${cursor}`))
  expect(listLedgerEntries).toHaveBeenCalledWith('tenant-1', 'p2', { createdAt: new Date('2026-10-15T12:00:00.000Z'), id: 'l9' })
})

it('is owner only', async () => {
  // requireRole mock throws the same error the real one throws for a wrong role; read src/lib/auth.ts requireRole
  // and src/lib/api-error.ts handleApiError to pick it, then assert the status handleApiError maps it to (403).
})
```

Run: `pnpm exec vitest run src/app/api/whatsapp/credits/ledger` → FAIL (route missing).

- [ ] **Step 3: Route**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getOrCreateCurrentPeriod } from '@/db/queries/whatsapp-credits'
import { decodeLedgerCursor, listCreditPeriods, listLedgerEntries } from '@/db/queries/whatsapp-credit-ledger'
import type { LedgerPage } from '@/lib/whatsapp-credit-ledger'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)

    const rawPeriod = searchParams.get('periodId')
    if (rawPeriod && !z.string().uuid().safeParse(rawPeriod).success) {
      return NextResponse.json({ error: 'Período inválido' }, { status: 400 })
    }
    const rawCursor = searchParams.get('cursor')
    const cursor = rawCursor ? decodeLedgerCursor(rawCursor) : null
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Cursor inválido' }, { status: 400 })
    }

    const periodId = rawPeriod ?? (await getOrCreateCurrentPeriod(ctx.tenantId)).id
    const periods = await listCreditPeriods(ctx.tenantId)
    if (!periods.some((p) => p.id === periodId)) {
      return NextResponse.json({ error: 'Período não encontrado' }, { status: 404 })
    }

    const { entries, nextCursor } = await listLedgerEntries(ctx.tenantId, periodId, cursor)
    const page: LedgerPage = { periods, periodId, entries, nextCursor }
    return NextResponse.json(page)
  } catch (error) {
    return handleApiError(error, request)
  }
}
```

Note the test for "current period" must make `getOrCreateCurrentPeriod` return an id that is in `listCreditPeriods`. `decodeLedgerCursor('%%%')` must return null: if `Buffer.from` does not throw and yields junk, the `id`/date checks reject it; verify in the test.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/db/queries/whatsapp-credit-ledger.ts web/src/app/api/whatsapp/credits/ledger
git commit -m "Add the owner credit ledger API"
```

---

### Task 5: History UI

**Files:**
- Create: `web/src/hooks/queries/use-whatsapp-credit-ledger.ts`
- Modify: `web/src/hooks/queries/query-keys.ts` (add a `whatsappCredits` group)
- Create: `web/src/components/settings/whatsapp-credit-history.tsx`
- Test: `web/src/components/settings/__tests__/whatsapp-credit-history.test.tsx`
- Modify: `web/src/components/settings/whatsapp-settings-form.tsx` ("Uso de créditos" section, ~lines 335-356)

**Interfaces:**
- Consumes: Task 2 types and `describeLedgerEntry`; the API contract `GET /api/whatsapp/credits/ledger?periodId&cursor` → `LedgerPage`.
- Produces: `useWhatsAppCreditLedger(periodId: string | null)`, `<WhatsAppCreditHistory open onOpenChange />`.

- [ ] **Step 1: Query key and hook**

`query-keys.ts`, add:

```ts
  whatsappCredits: {
    ledger: (periodId: string | null) => ['whatsapp-credits', 'ledger', periodId ?? 'current'] as const,
  },
```

`use-whatsapp-credit-ledger.ts`:

```ts
'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { LedgerPage } from '@/lib/whatsapp-credit-ledger'

async function fetchLedgerPage(periodId: string | null, cursor: string | null): Promise<LedgerPage> {
  const params = new URLSearchParams()
  if (periodId) params.set('periodId', periodId)
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`/api/whatsapp/credits/ledger?${params}`)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useWhatsAppCreditLedger(periodId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.whatsappCredits.ledger(periodId),
    queryFn: ({ pageParam }) => fetchLedgerPage(periodId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}
```

- [ ] **Step 2: Write the failing component test**

Read an existing component test under `src/components/settings/__tests__/` for the render helper and QueryClient wrapper pattern used in this repo, and copy it. Mock `global.fetch`:

```ts
const PAGE_1 = {
  periods: [{ id: 'p2', start: '2026-10-01T03:00:00.000Z', end: '2026-11-01T03:00:00.000Z', used: 4, total: 300 }],
  periodId: 'p2',
  entries: [
    { id: 'a', kind: 'spend', amount: -1, refundReason: null, actor: { type: 'user', name: 'Ana Souza' }, recipientName: 'Maria Silva', item: { kind: 'template', label: 'Link de anamnese' }, createdAt: '2026-10-15T13:05:00.000Z' },
    { id: 'b', kind: 'refund', amount: 1, refundReason: 'delivery_failed', actor: { type: 'user', name: 'Ana Souza' }, recipientName: 'Maria Silva', item: { kind: 'template', label: 'Link de anamnese' }, createdAt: '2026-10-15T13:10:00.000Z' },
  ],
  nextCursor: 'c1',
}
const PAGE_2 = { ...PAGE_1, entries: [{ ...PAGE_1.entries[0], id: 'c', recipientName: 'João Lima' }], nextCursor: null }

it('shows each line as a sentence with its amount', async () => {
  // fetch resolves PAGE_1
  render(<WhatsAppCreditHistory open onOpenChange={() => {}} />)
  expect(await screen.findByText('Maria Silva', { exact: false })).toBeInTheDocument()
  expect(screen.getByText(/enviou/)).toBeInTheDocument()
  expect(screen.getByText('-1')).toBeInTheDocument()
  expect(screen.getByText('+1')).toBeInTheDocument()
  expect(screen.getByText('10:05')).toBeInTheDocument() // 13:05Z is 10:05 BRT
})

it('loads the next page with the cursor', async () => {
  // fetch resolves PAGE_1 then PAGE_2
  render(...)
  await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
  expect(await screen.findByText('João Lima')).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls[1][0]).toContain('cursor=c1')
  expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
})

it('shows the empty state', async () => {
  // fetch resolves { ...PAGE_1, entries: [], nextCursor: null }
  render(...)
  expect(await screen.findByText('Nenhum crédito usado neste período')).toBeInTheDocument()
})
```

Run → FAIL (component missing).

- [ ] **Step 3: Component**

`whatsapp-credit-history.tsx` (`'use client'`). Read `components/ui/dialog.tsx`, `sheet.tsx`, `select.tsx` for their exported names before writing. Structure:

```tsx
export function WhatsAppCreditHistory({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const query = useWhatsAppCreditLedger(periodId, open)
  const pages = query.data?.pages ?? []
  const first = pages[0]
  const entries = useMemo(() => pages.flatMap((p) => p.entries), [pages])
  const days = useMemo(() => groupByBrDay(entries), [entries])
  const selected = first?.periods.find((p) => p.id === first.periodId)

  const body = (/* period Select (value = first?.periodId), "N de M créditos usados",
     day groups, "Carregar mais" (query.hasNextPage, disabled while isFetchingNextPage), empty state, loading skeleton, error text */)

  return isMobile
    ? <Sheet open={open} onOpenChange={onOpenChange}>{/* side="bottom", full height, title "Histórico de créditos" */}{body}</Sheet>
    : <Dialog open={open} onOpenChange={onOpenChange}>{/* max-w-2xl, title "Histórico de créditos" */}{body}</Dialog>
}
```

Helpers in the same file:

```ts
function groupByBrDay(entries: LedgerEntry[]) {
  const groups: { ymd: string; entries: LedgerEntry[] }[] = []
  for (const e of entries) {
    const ymd = toBrYmd(new Date(e.createdAt))
    const last = groups.at(-1)
    if (last?.ymd === ymd) last.entries.push(e)
    else groups.push({ ymd, entries: [e] })
  }
  return groups
}

const formatPeriod = (p: LedgerPeriod) =>
  `${formatInTimeZone(new Date(p.start), BR_TZ, 'dd/MM')} a ${formatInTimeZone(new Date(new Date(p.end).getTime() - 1), BR_TZ, 'dd/MM/yyyy')}`
```

Each line: `<time>` with `formatInTimeZone(new Date(e.createdAt), BR_TZ, 'HH:mm')`; the sentence from `describeLedgerEntry(e)` mapped to `<strong>` / text; amount `e.amount > 0 ? \`+${e.amount}\` : String(e.amount)` with `text-red-600` for negative and `text-emerald-600` for positive. Day heading: `formatInTimeZone(parseBrDate(ymd), BR_TZ, 'dd/MM')`. Layout: `flex items-start gap-3`, sentence `min-w-0 flex-1 break-words`, amount `shrink-0 tabular-nums`. Use existing color tokens from the settings form (`text-mid`, `border-[#E8ECEF]` already used there) rather than new arbitrary values.

Changing the period: `setPeriodId(value)`; the query key changes and paging restarts.

- [ ] **Step 4: Button in the settings form**

In `whatsapp-settings-form.tsx`, inside the "Uso de créditos" block, after `<WhatsAppCreditBar ... />`:

```tsx
<Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
  Ver histórico
</Button>
<WhatsAppCreditHistory open={historyOpen} onOpenChange={setHistoryOpen} />
```

with `const [historyOpen, setHistoryOpen] = useState(false)` near the other state. Read the file first and match the existing `Button` import and spacing.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm exec vitest run src/components/settings/__tests__/whatsapp-credit-history.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/queries/use-whatsapp-credit-ledger.ts web/src/hooks/queries/query-keys.ts web/src/components/settings/whatsapp-credit-history.tsx web/src/components/settings/__tests__/whatsapp-credit-history.test.tsx web/src/components/settings/whatsapp-settings-form.tsx
git commit -m "Show the WhatsApp credit history from Uso de créditos"
```

---

### Task 6: Inbox callers

**Files:**
- Modify: `web/src/app/api/whatsapp/conversations/[id]/messages/route.ts` (sends at ~134, ~162, ~213, ~270; queue at ~236)
- Modify: `web/src/app/api/whatsapp/conversations/route.ts` (~110)
- Modify: `web/src/app/api/whatsapp/conversations/[id]/messages/[messageId]/retry/route.ts` (~168)
- Modify: existing tests under those three folders' `__tests__` that assert send arguments.

**Interfaces:**
- Consumes: Task 3 signatures; `CreditContext` from `@/lib/whatsapp-credit-ledger`; `createQueuedMessage` `creditContext`.

- [ ] **Step 1: Update existing route tests first**

In each route's tests, change the expected `sendTemplateMessage` / `sendTextMessage` / `sendMediaMessage` calls to include the credit object as 2nd argument, for example:

```ts
expect(sendTextMessage).toHaveBeenCalledWith(
  'tenant-1',
  { actor: { type: 'user', userId: 'user-1' }, recipient: { patientId: <conversation.patientId>, conversationId: <conversation.id>, name: <conversation.profileName> } },
  <phone>, <body>,
)
```

For the queued-text path in `messages/route.ts`, assert `createQueuedMessage` gets `creditContext` with the same actor and recipient. Add this assertion if the test file has a queued case; if no test covers the queued path, add one case that sends text with a closed window and asserts `createQueuedMessage` receives `creditContext.actor = { type: 'user', userId: 'user-1' }`.

Run the tests → FAIL on argument mismatch.

- [ ] **Step 2: Implement**

`messages/route.ts`: after `conversation` is loaded, build once:

```ts
const credit: CreditContext = {
  actor: { type: 'user', userId: ctx.userId },
  recipient: { patientId: conversation.patientId ?? null, conversationId: conversation.id, name: conversation.profileName ?? null },
}
```

Pass `credit` as the 2nd argument to all four sends; add `creditContext: credit` to `createQueuedMessage`.

`conversations/route.ts`: `credit = { actor: { type: 'user', userId: ctx.userId }, recipient: { patientId: patient.id, conversationId: conversation.id, name: patient.fullName } }`.

`retry/route.ts`: `credit = { actor: { type: 'user', userId: ctx.userId }, recipient: { patientId: appointment.patientId ?? null, conversationId: message.conversationId, name: appointment.patientName ?? appointment.bookingName ?? null } }`. Read the `appointment` type for the exact field names.

- [ ] **Step 3: Run the tests of these routes, expect PASS**

`pnpm exec vitest run src/app/api/whatsapp/conversations`

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/whatsapp/conversations
git commit -m "Record the sending user for inbox WhatsApp credits"
```

---

### Task 7: Link and document callers

**Files:**
- Modify: `web/src/app/api/patients/[id]/anamnesis-link/send/route.ts` (~75)
- Modify: `web/src/app/api/consent/send-signing-link/send/route.ts` (~67)
- Modify: `web/src/app/api/clinical-documents/[id]/send-whatsapp/route.ts` (~80)
- Modify: `web/src/app/api/consent/[id]/send-whatsapp/route.ts` (~21-55 resolver, ~109 send)
- Modify: existing `__tests__` under those four route folders.

**Interfaces:**
- Consumes: Task 3 signatures.

- [ ] **Step 1: Update tests first**

- anamnesis-link and send-signing-link tests: expected `sendTemplateMessage` call gains, as 2nd argument, `{ actor: { type: 'user', userId: 'user-1' }, recipient: { patientId: PATIENT_ID, name: 'Maria Silva' } }`.
- If `consent/[id]/send-whatsapp` has no test file, create `web/src/app/api/consent/[id]/send-whatsapp/__tests__/route.test.ts` with two cases: a session user (mock `auth()` to return `{ user: { id: 'user-1' } }` and the membership query to return the tenant) sends with `actor: { type: 'user', userId: 'user-1' }`; a signing-token request (no session, `?token=abc`, `getRecentlyUsedSigningToken` returns `{ tenantId }`) sends with `actor: { type: 'patient' }`. Both assert `documentLabel` equals the acceptance `templateTitle`. Mock PDF render, storage upload, logo, `isSubscriptionActive`, and `getConsentAcceptanceWithContext` (fields: `patientId`, `patientName`, `patientPhone`, `templateTitle`, `tenantLogoUrl`).
- clinical-documents test (create the same way if missing): `sendOrEnqueueDocument` gets `{ actor: { type: 'user', userId: 'user-1' }, recipient: { patientId: doc.patientId, name: doc.patient.fullName }, documentLabel: doc.title }`.

Run → FAIL.

- [ ] **Step 2: Implement**

- anamnesis-link/send: `sendTemplateMessage(ctx.tenantId, { actor: { type: 'user', userId: ctx.userId }, recipient: { patientId: patient.id, name: patient.fullName } }, normalizedPhone, ...)`.
- send-signing-link/send: same shape with `parsed.data.patientId` / `patient.fullName`.
- clinical-documents: `sendOrEnqueueDocument(ctx.tenantId, { actor: { type: 'user', userId: ctx.userId }, recipient: { patientId: doc.patientId, name: doc.patient.fullName }, documentLabel: doc.title }, whatsappPhone, ...)`.
- consent/[id]/send-whatsapp: change the resolver to return who asked:

```ts
type Requester = { tenantId: string; userId: string | null }
async function resolveRequester(req: NextRequest, acceptanceId: string): Promise<Requester | null>
// path 1 returns { tenantId: row.tenantId, userId: session.user.id }
// path 2 returns { tenantId: row.tenantId, userId: null }
```

Update the caller (`const requester = await resolveRequester(req, id)`, `tenantId = requester.tenantId`) and send with:

```ts
{
  actor: requester.userId ? { type: 'user', userId: requester.userId } : { type: 'patient' },
  recipient: { patientId: acceptance.patientId, name: acceptance.patientName },
  documentLabel: acceptance.templateTitle,
}
```

- [ ] **Step 3: Run, expect PASS**

`pnpm exec vitest run src/app/api/patients src/app/api/consent src/app/api/clinical-documents`

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/patients/[id]/anamnesis-link/send web/src/app/api/consent web/src/app/api/clinical-documents
git commit -m "Record who sent links and documents in the credit ledger"
```

---

### Task 8: System callers and webhook

**Files:**
- Modify: `web/src/app/api/cron/whatsapp-automations/route.ts` (~207)
- Modify: `web/src/lib/whatsapp-anamnesis.ts` (~121)
- Modify: `web/src/app/api/webhooks/whatsapp/route.ts` (drain ~486-545, status refund ~578)
- Tests: `web/src/app/api/cron/whatsapp-automations/__tests__/route.test.ts`, `web/src/lib/__tests__/whatsapp-anamnesis.test.ts`, `web/src/app/api/webhooks/whatsapp/__tests__/shared-number-routing.test.ts` (and any other webhook test that mocks `refundFailedCharge` or asserts drain sends)

**Interfaces:**
- Consumes: Task 1 `refundSpendByMetaMessageId`; Task 3 signatures; `WhatsappQueuedMessage.creditContext`.

- [ ] **Step 1: Update tests first**

- Webhook test: replace the `refundFailedCharge` mock with `refundSpendByMetaMessageId: vi.fn(async () => true)`; the failed-status test expects `refundSpendByMetaMessageId` called with `'wamid.failed'`.
- Webhook drain tests: a queued row with `creditContext: { actor: { type: 'user', userId: 'user-1' }, recipient: { patientId: 'p1', name: 'Maria' } }` drains with that object as 2nd send argument; a queued row with `creditContext: null` drains with `{ actor: { type: 'system' }, recipient: { patientId: <conversation patientId or null>, conversationId, name: null } }`. If no drain test exists, add these two cases next to the existing queue/credit-exhausted drain test (it already mocks `getQueuedMessages`).
- Cron test: expected `sendTemplateMessage` 2nd argument `{ actor: { type: 'system' }, recipient: { patientId: appt.patientId ?? null, name: appt.patientName ?? appt.bookingName ?? null } }`.
- Anamnesis test: expected 2nd argument `{ actor: { type: 'system' }, recipient: { patientId, name: patient.fullName } }`.

Run → FAIL.

- [ ] **Step 2: Implement**

Cron and `whatsapp-anamnesis.ts`: add the system credit as described.

Webhook:

```ts
import { refundSpendByMetaMessageId } from '@/db/queries/whatsapp-credits'
import type { CreditContext } from '@/lib/whatsapp-credit-ledger'
...
if (mappedStatus === 'failed') {
  await refundSpendByMetaMessageId(metaMessageId).catch((err) =>
    reportWebhookFailure(err, 'refund_failed_charge', { tenantId, metaMessageId }),
  )
}
```

In `drainQueuedMessages`, per queued row:

```ts
// Rows queued before the ledger existed carry no context.
const credit = (qm.creditContext as CreditContext | null) ?? {
  actor: { type: 'system' },
  recipient: { patientId: null, conversationId, name: null },
}
```

and pass `credit` as the 2nd argument to `sendMediaMessage` / `sendTextMessage`. Remove the old `refundFailedCharge` import.

- [ ] **Step 3: Run, expect PASS**

`pnpm exec vitest run src/app/api/webhooks src/app/api/cron src/lib/__tests__/whatsapp-anamnesis.test.ts`

- [ ] **Step 4: Full gate**

From repo root: `pnpm ci:checks`. Expected: lint 0 errors, typecheck clean, all tests pass. Grep for leftovers: `git grep -n "refundFailedCharge\|recordCharge\|consumeCredits\|refundCredits\|whatsappCreditCharges" -- web/src` must return nothing.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/cron/whatsapp-automations web/src/lib/whatsapp-anamnesis.ts web/src/lib/__tests__/whatsapp-anamnesis.test.ts web/src/app/api/webhooks/whatsapp
git commit -m "Record automatic and queued WhatsApp sends in the credit ledger"
```

---

## Deployment note (for the human)

`0037_whatsapp_credit_ledger.sql` drops `whatsapp_credit_charges` after copying its rows. Hand-written migrations after 0018 are not in the drizzle journal; apply it to production the same way 0036 was applied, before the deploy goes live, or every paid send fails on the missing table.
