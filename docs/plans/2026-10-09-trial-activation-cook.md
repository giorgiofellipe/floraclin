# Trial Activation Implementation Plan

> For agentic workers: each task is self-contained. Only touch the files listed in your task. Run commands from `web/`.

**Goal:** Push new trial clinics to their first real action with WhatsApp plus email lifecycle messages, a dashboard checklist, and capture of owner replies.

**Architecture:** A pure message table (`lifecycle-messages.ts`) decides what is due from an activation snapshot (`activation.ts`). One sender (`lifecycle-sender.ts`) delivers a message per channel through a status-tracked row in `tenant_lifecycle_messages` (claim as `pending`, finish as `sent`, `failed` or `skipped`), so the daily cron and the welcome hooks never double-send and a crash mid-send is recovered. The WhatsApp webhook hands shared-number messages to `lifecycle-webhook.ts` first; a safe match is stored and posted to Discord instead of reaching patient routing.

**Tech Stack:** Next.js 16 App Router, Drizzle (postgres-js, `floraclin` schema), Zod 4, TanStack Query, Vitest + Testing Library, Resend v6, Meta Graph API v21.0.

**Spec:** `docs/superpowers/specs/2026-10-09-trial-activation-design.md`

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, copy, commits).
- Comments only where a competent reader would otherwise get it wrong. Default is no comment.
- Dates: never `new Date('YYYY-MM-DD')`. Use `@/lib/dates` helpers (`toBrYmd`, `parseBrDate`).
- Tests never hit a database or network. Mock `@/db/client`, Resend, `fetch`.
- Every test passes the test-audit authoring gate: it names the regression it catches, it is not a call-shape or copied-fixture test, and expected values never come from the code under test.
- No backward-compat shims. No new dependencies.
- Copy is pt-BR exactly as written in this plan.
- Kill switch: nothing is sent unless env `LIFECYCLE_ENABLED === 'true'`.
- Eligibility: only tenants with `settings.lifecycle_notice_at` set receive messages. Self-signup sets it (the signup pages show the notice line). Admin-created tenants never get it.
- Owner = earliest active `tenant_users` row with role `owner`. Only owners with `users.email_verified IS NOT NULL` receive messages.
- Real deep links in this app: new patient form opens on `/pacientes?novo=1`; new appointment opens on `/agenda?open=new`.

## Decisions taken while planning (differ from or sharpen the spec)

1. Send rows carry `status` (`pending`, `sent`, `failed`, `skipped`) and `recipient`. A key is done when both channels have a terminal row. A `pending` row older than 1 hour is reclaimable (crash recovery). Reply capture by phone uses only `sent` WhatsApp rows.
2. Message priority: welcome, then trial_ending, then trial_feedback, then the nudges. The cron sends only the first due message per clinic per run, so deadline messages are never starved by nudges.
3. `trial_ending` fires only when `daysLeft === 2` (copy says "2 dias"); `trial_feedback` when expired from trial and `daysLeft <= -2`. Both follow `current_period_end`, so an extended trial stays correct.
4. Opt-out link: GET renders a confirm button, POST opts out (mail scanners follow GET). The flag is written with an atomic JSONB merge.
5. WhatsApp opt-out: a captured lifecycle reply whose text is `PARAR`, `SAIR`, `STOP` or `CANCELAR` (trimmed, case and accent insensitive) opts the clinic out. MARKETING template footer becomes `Para não receber mais dicas, responda PARAR.` This replaces the spec's "use o link do e-mail" footer, which left WhatsApp-only owners without an exit.
6. Reply capture is conservative: a context reply needs the sender phone to equal the stored recipient; a contextless message is captured only when exactly one clinic sent a lifecycle WhatsApp to that phone in 30 days and the phone has no WhatsApp conversation with any clinic in 30 days. Capture errors are reported and fall through to normal routing.
7. Delivery status callbacks for lifecycle message ids are consumed by the lifecycle module (a Meta `failed` status marks the row failed) and never reach patient routing.
8. Google sign-up gets the welcome from `createClinicForOAuthUser`; password sign-up gets it on email confirmation. An email that maps to more than one eligible clinic is skipped at confirmation time (the cron covers it).
9. Checklist data rides on the existing `GET /api/dashboard` response (`activation` field). No new route or hook.
10. Admin history rides on the existing `GET /api/admin/tenants/[id]` response (`lifecycle` field).
11. No template name suffixes. Renaming a template means editing `templateName` in `lifecycle-messages.ts`, per the AGENTS.md template rules.

## Decisions taken after review (override the tasks below)

1. Eligibility and opt-out are columns, not settings keys: `tenants.lifecycle_notice_at` and `tenants.lifecycle_opted_out_at`. A full settings write (clinic settings form, `updateTenant`) can no longer erase them.
2. At most once delivery. A claim never takes over a pending row. A pending row older than 1 hour counts as done in `getCompletedLifecycleKeys`, so a crash after a send loses that message instead of sending it twice.
3. Only tenants with `status = 'active'` get messages.
4. Lifecycle emails set `replyTo: contato@floraclin.com.br`.
5. An exact opt-out keyword skips the recent-conversation guard on contextless replies.
6. Accepted as is: no phone verification, full reply text in Discord, welcome stays first in priority.

---

## Group A (parallel)

### Task 1: Schema and migration

**Files:**
- Modify: `web/src/db/schema.ts` (append after `tenantSubscriptions`)
- Create: `web/src/db/migrations/0032_trial_lifecycle.sql`

**Produces:** `tenantLifecycleMessages`, `tenantLifecycleReplies`.

```ts
export const tenantLifecycleMessages = floraclinSchema.table('tenant_lifecycle_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  messageKey: varchar('message_key', { length: 40 }).notNull(),
  channel: varchar('channel', { length: 10 }).notNull(),
  status: varchar('status', { length: 10 }).notNull(),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metaMessageId: varchar('meta_message_id', { length: 255 }),
  error: text('error'),
}, (table) => [
  uniqueIndex('uq_tenant_lifecycle_message').on(table.tenantId, table.messageKey, table.channel),
  index('idx_tenant_lifecycle_messages_meta_id').on(table.metaMessageId),
  index('idx_tenant_lifecycle_messages_recipient').on(table.recipient),
])

export const tenantLifecycleReplies = floraclinSchema.table('tenant_lifecycle_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  messageKey: varchar('message_key', { length: 40 }),
  body: text('body').notNull(),
  metaMessageId: varchar('meta_message_id', { length: 255 }).notNull().unique(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Migration:

```sql
CREATE TABLE "floraclin"."tenant_lifecycle_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40) NOT NULL,
  "channel" varchar(10) NOT NULL,
  "status" varchar(10) NOT NULL,
  "recipient" varchar(255) NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "meta_message_id" varchar(255),
  "error" text,
  CONSTRAINT "tenant_lifecycle_messages_channel_check" CHECK ("channel" IN ('whatsapp', 'email')),
  CONSTRAINT "tenant_lifecycle_messages_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped'))
);
CREATE UNIQUE INDEX "uq_tenant_lifecycle_message" ON "floraclin"."tenant_lifecycle_messages" ("tenant_id", "message_key", "channel");
CREATE INDEX "idx_tenant_lifecycle_messages_meta_id" ON "floraclin"."tenant_lifecycle_messages" ("meta_message_id");
CREATE INDEX "idx_tenant_lifecycle_messages_recipient" ON "floraclin"."tenant_lifecycle_messages" ("recipient");

CREATE TABLE "floraclin"."tenant_lifecycle_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40),
  "body" text NOT NULL,
  "meta_message_id" varchar(255) NOT NULL UNIQUE,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
```

Check that `index` and `uniqueIndex` are imported in schema.ts. No test. Verify: `pnpm typecheck`.

### Task 2: Activation state

**Files:**
- Create: `web/src/lib/activation.ts`
- Create: `web/src/lib/__tests__/activation.test.ts`

**Produces:**

```ts
import type { SubscriptionStatus } from '@/db/queries/subscriptions'

export interface ActivationState {
  onboardingDone: boolean
  hasPatient: boolean
  hasAppointment: boolean
  hasProcedureRecord: boolean
  hasWhatsappSend: boolean
  trialDay: number          // BR calendar days since current_period_start; 0 on signup day
  daysLeft: number          // BR calendar days until current_period_end; negative after it
  subscriptionStatus: SubscriptionStatus
  subscriptionSource: string
  optedOut: boolean         // tenants.settings.trial_messages_opt_out === true
}

export function brCalendarDaysBetween(from: Date, to: Date): number
export async function getActivationState(tenantId: string, now?: Date): Promise<ActivationState | null>
```

`brCalendarDaysBetween`: `Math.round((parseBrDate(toBrYmd(to)).getTime() - parseBrDate(toBrYmd(from)).getTime()) / 86_400_000)`. Brazil has no DST, so noon-to-noon is a whole number of days.

`getActivationState`: one `db.select` from `tenants` inner join `tenantSubscriptions` on tenant id, filtered by tenant id, selecting `tenants.settings`, `status`, `source`, `currentPeriodStart`, `currentPeriodEnd` and five boolean columns built as `sql<boolean>\`exists (select 1 from ${patients} where ${patients.tenantId} = ${tenants.id})\``:
- patients (any row, soft-deleted included)
- appointments
- procedure_records
- whatsapp_messages with `direction = 'outbound'`

`onboardingDone` = `settings.onboarding_completed === true`; `optedOut` = `settings.trial_messages_opt_out === true`. Return `null` when no row. Default `now = new Date()`.

Tests (only `brCalendarDaysBetween`; the query is exercised through consumers):
- Signup at 23:30 BRT, `now` at 00:30 BRT the next day: 1. Regression: someone swaps to `differenceInDays` on raw instants, which returns 0.
- Same BR day at 00:10 and 23:50: 0. Regression: UTC date math flips the day at 21:00 BRT.
- `to` before `from`: negative (used after expiry).
Build instants with `parseBrDate('2026-10-09', '23:30:00')`.

### Task 3: Channel senders

**Files:**
- Create: `web/src/lib/platform-whatsapp.ts`
- Create: `web/src/lib/__tests__/platform-whatsapp.test.ts`
- Modify: `web/src/lib/email.ts` (add `sendLifecycleEmail`)
- Create: `web/src/lib/__tests__/email-lifecycle.test.ts`

**Produces:**

```ts
// platform-whatsapp.ts
export async function sendPlatformTemplate(to: string, templateName: string, bodyParams: string[]): Promise<{ metaMessageId: string }>
export async function createPlatformTemplate(def: { name: string; category: 'UTILITY' | 'MARKETING'; language: string; components: unknown[] }): Promise<{ id: string; status: string }>
```

Both read `FLORACLIN_WA_PHONE_NUMBER_ID`, `FLORACLIN_WA_ACCESS_TOKEN`, `FLORACLIN_WA_BUSINESS_ACCOUNT_ID`; missing values throw `BusinessError('WHATSAPP_NOT_CONFIGURED', 'WhatsApp da FloraClin não configurado neste ambiente (FLORACLIN_WA_*).')` (import `BusinessError` from the module `@/lib/whatsapp` imports it from). Base URL `https://graph.facebook.com/v21.0`. Every fetch passes `signal: AbortSignal.timeout(10_000)` so one hung call cannot eat the daily cron. Send payload:

```json
{ "messaging_product": "whatsapp", "to": "<to>", "type": "template",
  "template": { "name": "<templateName>", "language": { "code": "pt_BR" },
    "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "<p1>" }] }] } }
```

Omit `components` when `bodyParams` is empty. Non-2xx throws `Error('Meta API error: <message> | code=<code>')` from `data.error`. A 2xx without `messages[0].id` throws `Error('Meta API error: missing message id')`. No tenant credit and no subscription gate: these are FloraClin's own messages to clinic owners.

```ts
// email.ts
export async function sendLifecycleEmail(opts: {
  to: string
  subject: string
  body: string
  button: { label: string; url: string } | null
  optOutUrl: string | null
}): Promise<{ id: string }>
```

HTML follows `sendInviteEmail` (heading `FloraClin`, one paragraph with the escaped body, `#4A6B52` button when present). When `optOutUrl` is set, footer paragraph in `#7A7A7A` 13px: `Não quer mais receber dicas da FloraClin? <a href="...">Clique aqui</a>.` Resend v6 returns `{ data, error }` and does not throw on API errors: throw `new Error(error.message)` when `error` is set, else return `{ id: data.id }`.

Tests:
- platform-whatsapp: missing env throws `WHATSAPP_NOT_CONFIGURED` before any fetch. Graph error JSON surfaces Meta's message in the thrown error. A 2xx without a message id throws. Regression: a send recorded as `sent` with no id, so reply capture can never match.
- email: Resend returning `{ error }` makes it throw. Regression: a failed email recorded as sent. Body `<script>` is escaped. Opt-out footer present only with `optOutUrl`.

### Task 4: Opt-out, notice, eligibility flag

**Files:**
- Create: `web/src/lib/lifecycle-opt-out.ts`
- Create: `web/src/lib/__tests__/lifecycle-opt-out.test.ts`
- Create: `web/src/app/api/lifecycle/opt-out/route.ts`
- Create: `web/src/app/api/lifecycle/opt-out/__tests__/route.test.ts`
- Modify: `web/src/app/(auth)/signup/page.tsx`
- Modify: `web/src/app/(auth)/signup/clinic-details/page.tsx`
- Modify: `web/src/db/queries/admin-tenants.ts` (`insertSelfSignupTenantBase` only)

**Produces:**

```ts
export function lifecycleOptOutUrl(tenantId: string): string   // `${getAppUrl()}/api/lifecycle/opt-out?t=<id>&s=<sig>`
export function isValidLifecycleOptOut(tenantId: string, signature: string): boolean
export async function optOutTenantLifecycle(tenantId: string): Promise<boolean>   // true when a tenant row was updated
```

Signature: `createHmac('sha256', process.env.NEXTAUTH_SECRET).update(\`lifecycle-opt-out:${tenantId}\`).digest('hex')`. Throw when the secret is missing. Compare with `timingSafeEqual` after a length check. `getAppUrl` is in `@/lib/app-url`.

`optOutTenantLifecycle`: atomic merge, no read-modify-write:

```ts
const rows = await db.update(tenants)
  .set({ settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || '{"trial_messages_opt_out": true}'::jsonb`, updatedAt: new Date() })
  .where(eq(tenants.id, tenantId))
  .returning({ id: tenants.id })
return rows.length > 0
```

Route:
- `GET ?t=&s=`: invalid uuid (`z.uuid()`) or bad signature answers 400 with the HTML page `Link inválido.` Valid answers 200 with an HTML page: text `Deseja parar de receber dicas da FloraClin?` and a `<form method="post">` posting hidden `t` and `s` to the same path, button `Parar de receber`. GET never writes: corporate mail scanners and link previews follow GET links (same reason as `api/auth/confirm/route.ts`).
- `POST` (form-encoded `t`, `s`): same validation (400 page on failure); `optOutTenantLifecycle(t)`; false answers the 400 page; true answers 200 page `Pronto. Você não receberá mais dicas da FloraClin.`
- All pages are minimal HTML with `content-type: text/html; charset=utf-8`. No auth: `/api/` is outside middleware gating.

Notice line under the phone field on both signup pages, same style as nearby helper text: `Você receberá dicas da FloraClin por WhatsApp e e-mail durante o teste.`

`insertSelfSignupTenantBase`: insert `settings` too, as `jsonb_build_object('lifecycle_notice_at', now())`. This is the eligibility flag: only clinics that went through a signup page with the notice get lifecycle messages.

Tests:
- lib: a signature for tenant A does not validate tenant B; a truncated signature returns false without throwing. Regression: anyone can opt out any clinic.
- route: GET with a valid link never calls `optOutTenantLifecycle` and returns the form. Regression: a mail scanner opts every clinic out. POST with a valid link calls it; POST with a tampered signature answers 400 and never calls it.

### Task 5: Discord reply event

**Files:**
- Modify: `web/src/lib/discord.ts`
- Modify: `web/src/lib/__tests__/discord.test.ts`

Add `| { kind: 'lifecycle.reply'; tenantName: string; tenantId: string; messageKey: string | null; body: string }` to `DiscordEvent`. Payload: title `Resposta de clínica em teste`, color `COLOR_SUBSCRIPTION`, `description` = body truncated to 1000 chars plus `...` when longer, fields `Clínica` (inline), `Mensagem` (inline, messageKey or `sem contexto`), `Admin` (the admin link the other events build). Routed to `DISCORD_WEBHOOK_EVENTS` (default branch of `webhookForEvent`). Update point 3 of the `notifyDiscord` doc comment: events never carry contact data or patient data; `lifecycle.reply` carries the reply text a clinic owner chose to send FloraClin.

Test, as a row next to existing payload tests: a 5000-char body arrives as 1000 chars plus `...`. Regression: Discord rejects descriptions over 4096 chars and the reply never shows.

---

## Group B (depends on A)

### Task 6: Lifecycle message table

**Files:**
- Create: `web/src/lib/lifecycle-messages.ts`
- Create: `web/src/lib/__tests__/lifecycle-messages.test.ts`

**Consumes:** `ActivationState` (Task 2).
**Produces:**

```ts
export type LifecycleMessageKey =
  | 'trial_welcome' | 'trial_ending' | 'trial_feedback' | 'trial_setup_incomplete'
  | 'trial_first_patient' | 'trial_first_record' | 'trial_first_appointment'

export interface LifecycleMessage {
  key: LifecycleMessageKey
  templateName: string
  category: 'UTILITY' | 'MARKETING'
  emailSubject: string
  body: string                    // contains {{1}} once, for the owner's first name
  button: { label: string; path: string } | null
  isDue: (state: ActivationState) => boolean
}

export const LIFECYCLE_MESSAGES: readonly LifecycleMessage[]   // priority order below
export const LIFECYCLE_WELCOME: LifecycleMessage
export const OPT_OUT_FOOTER = 'Para não receber mais dicas, responda PARAR.'
export function selectDueMessages(state: ActivationState, completedKeys: ReadonlySet<string>): LifecycleMessage[]
export function renderLifecycleBody(message: LifecycleMessage, firstName: string): string
export function ownerFirstName(fullName: string | null | undefined): string
```

`templateName` equals `key`. Entries in this exact priority order (`trialing` means `subscriptionStatus === 'trialing'`):

1. `trial_welcome`, UTILITY, due when trialing. Subject `Sua conta na FloraClin está pronta`. Body `Olá, {{1}}! Sua conta na FloraClin está pronta. Comece pelo diagrama facial: cadastre um paciente e registre o primeiro procedimento em menos de 5 minutos.` Button `Abrir FloraClin`, `/dashboard`.
2. `trial_ending`, UTILITY, due when trialing and `daysLeft === 2`. Subject `Seu teste termina em 2 dias`. Body `Olá, {{1}}! Seu teste gratuito da FloraClin termina em 2 dias. Para manter a agenda, os pacientes e o WhatsApp funcionando, escolha um plano.` Button `Ver planos`, `/configuracoes?tab=assinatura`.
3. `trial_feedback`, MARKETING, due when `subscriptionStatus === 'expired'`, `subscriptionSource === 'trial'` and `daysLeft <= -2`. Subject `O que faltou na FloraClin?`. Body `Olá, {{1}}! Seu teste na FloraClin terminou. O que faltou para você continuar? Responda esta mensagem, lemos cada resposta.` No button.
4. `trial_setup_incomplete`, MARKETING, due when trialing, `trialDay >= 1`, not onboardingDone. Subject `Faltam 3 minutos para liberar sua agenda`. Body `Olá, {{1}}! Faltam 3 minutos para terminar a configuração da sua clínica na FloraClin. Depois disso, a agenda e os pacientes ficam liberados.` Button `Terminar configuração`, `/onboarding`.
5. `trial_first_patient`, MARKETING, due when trialing, `trialDay >= 2`, not hasPatient. Subject `Seu primeiro paciente na FloraClin`. Body `Olá, {{1}}! O primeiro passo na FloraClin é cadastrar um paciente. Leva 1 minuto e libera o diagrama facial, a agenda e o WhatsApp.` Button `Cadastrar paciente`, `/pacientes?novo=1`.
6. `trial_first_record`, MARKETING, due when trialing, `trialDay >= 4`, not hasProcedureRecord. Subject `Registre um procedimento no diagrama facial`. Body `Olá, {{1}}! Já registrou um procedimento no diagrama facial? Marque os pontos, o produto e a quantidade. O histórico do paciente fica pronto para a próxima sessão.` Button `Abrir pacientes`, `/pacientes`.
7. `trial_first_appointment`, MARKETING, due when trialing, `trialDay >= 7`, and (not hasAppointment or not hasWhatsappSend). Subject `Agenda com confirmação por WhatsApp`. Body `Olá, {{1}}! Agende o próximo atendimento na FloraClin e deixe a confirmação por WhatsApp com a gente. O paciente confirma com um toque.` Button `Abrir agenda`, `/agenda?open=new`.

`selectDueMessages` keeps priority order and drops keys in `completedKeys`, messages whose `isDue` is false, and MARKETING messages when `state.optedOut`.

`renderLifecycleBody` replaces `{{1}}` with the first name. `ownerFirstName` returns the first whitespace-separated word, or `tudo bem` when empty, so the body reads `Olá, tudo bem!` instead of `Olá, !`.

Tests (one `it.each` table over hand-written states from a `baseState()` factory; expected key lists written by hand):
- Day 0 trialing, nothing done, nothing completed: `['trial_welcome']`.
- Day 3, welcome completed, no onboarding, no patient: `['trial_setup_incomplete', 'trial_first_patient']`.
- Day 3, onboarding done, patient present, welcome completed: `[]`.
- Day 12, daysLeft 2, welcome completed, nothing done: `trial_ending` comes first. Regression: nudges starve the deadline message.
- Opted out, day 5, daysLeft 2, welcome completed, nothing done: `['trial_ending']` only. Regression: opt-out suppresses UTILITY, or nothing.
- Extended trial: day 13, daysLeft 9: no `trial_ending`.
- Expired, source trial, daysLeft -2: `['trial_feedback']`; source `gift`: `[]`; status `active`: `[]`.
- Every body contains exactly one `{{1}}` and neither starts nor ends with it (Meta rejects such templates). Guards future copy edits against the AGENTS.md rule.

### Task 7: Lifecycle queries

**Files:**
- Create: `web/src/db/queries/lifecycle.ts`

**Consumes:** Task 1 tables.
**Produces:**

```ts
export type LifecycleChannel = 'whatsapp' | 'email'
export type LifecycleSendStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface LifecycleRecipient {
  tenantId: string
  tenantName: string
  tenantPhone: string | null
  ownerName: string
  ownerEmail: string
}

export async function findLifecycleRecipients(filter?: { tenantId?: string; ownerEmail?: string }): Promise<LifecycleRecipient[]>
export async function getCompletedLifecycleKeys(tenantId: string): Promise<Set<string>>
export async function claimLifecycleSend(row: { tenantId: string; messageKey: string; channel: LifecycleChannel; recipient: string }): Promise<string | null>
export async function finishLifecycleSend(id: string, result: { status: 'sent' | 'failed'; metaMessageId?: string; error?: string }): Promise<void>
export async function recordSkippedLifecycleSend(row: { tenantId: string; messageKey: string; channel: LifecycleChannel; recipient: string; reason: string }): Promise<void>
export async function findLifecycleSendByMetaId(metaMessageId: string): Promise<{ tenantId: string; tenantName: string; messageKey: string; recipient: string } | null>
export async function findRecentLifecycleTenantsByPhone(phone: string, since: Date): Promise<{ tenantId: string; tenantName: string; messageKey: string }[]>
export async function hasRecentConversationForPhone(phone: string, since: Date): Promise<boolean>
export async function markLifecycleSendFailedByMetaId(metaMessageId: string, error: string): Promise<boolean>
export async function insertLifecycleReply(row: { tenantId: string; messageKey: string | null; body: string; metaMessageId: string }): Promise<boolean>
export async function getLifecycleHistory(tenantId: string): Promise<{
  sends: { messageKey: string; channel: string; status: string; claimedAt: string; error: string | null }[]
  replies: { messageKey: string | null; body: string; receivedAt: string }[]
}>
```

`findLifecycleRecipients` uses `db.execute(sql\`...\`)` (follow `rowsFromExecuteResult` in `admin-tenants.ts` for the result shape) with a lateral owner pick. Use the literal `floraclin.` prefix like `insertSelfSignupTenantBase` does:

```sql
select t.id as tenant_id, t.name as tenant_name, t.phone as tenant_phone,
       o.full_name as owner_name, o.email as owner_email
from floraclin.tenants t
join floraclin.tenant_subscriptions s on s.tenant_id = t.id
join lateral (
  select u.full_name, u.email, u.email_verified
  from floraclin.tenant_users tu join floraclin.users u on u.id = tu.user_id
  where tu.tenant_id = t.id and tu.role = 'owner' and tu.is_active
  order by tu.created_at asc limit 1
) o on true
where jsonb_exists(t.settings, 'lifecycle_notice_at')
  and t.deleted_at is null
  and o.email_verified is not null
  and (s.status = 'trialing'
       or (s.status = 'expired' and s.source = 'trial' and s.current_period_end > now() - interval '10 days'))
  [and t.id = ${tenantId}]
  [and lower(o.email) = lower(${ownerEmail})]
order by t.created_at asc
```

Optional clauses via `sql` fragments (`sql.empty()` when absent). `jsonb_exists` stands in for the `?` operator, which would clash with placeholder syntax. Map rows to camelCase.

`getCompletedLifecycleKeys`: keys that have rows for both channels with a terminal status (`sent`, `failed`, `skipped`):

```sql
select message_key from floraclin.tenant_lifecycle_messages
where tenant_id = $1 and status <> 'pending'
group by message_key having count(distinct channel) = 2
```

`claimLifecycleSend`: insert `status = 'pending'`, or take over a stale pending row; return the id, or null when another caller holds it or it already finished:

```sql
insert into floraclin.tenant_lifecycle_messages (tenant_id, message_key, channel, status, recipient)
values ($1, $2, $3, 'pending', $4)
on conflict (tenant_id, message_key, channel) do update
  set claimed_at = now(), recipient = excluded.recipient
  where tenant_lifecycle_messages.status = 'pending'
    and tenant_lifecycle_messages.claimed_at < now() - interval '1 hour'
returning id
```

`finishLifecycleSend`: set `status`, `completed_at = now()`, `meta_message_id`, `error` by id.

`recordSkippedLifecycleSend`: insert `status = 'skipped'`, `completed_at = now()`, `error = reason`, `on conflict do nothing`.

`findLifecycleSendByMetaId`: `channel = 'whatsapp'`, join tenants for the name, return `recipient`.

`findRecentLifecycleTenantsByPhone`: `channel = 'whatsapp'`, `status = 'sent'`, `recipient = phone`, `claimed_at >= since`, joined to tenants; one row per tenant with its most recent `message_key` (`selectDistinctOn([tenantLifecycleMessages.tenantId])` ordered by tenant id, `claimed_at` desc).

`hasRecentConversationForPhone`: exists a `whatsapp_conversations` row with `phone_number = phone` and `last_message_at >= since`, any tenant.

`markLifecycleSendFailedByMetaId`: set `status = 'failed'`, `error` where `meta_message_id = $1`; true when a row matched.

`insertLifecycleReply`: `on conflict (meta_message_id) do nothing returning id`; true when inserted.

`getLifecycleHistory`: both lists newest first, 50 each, timestamps as ISO strings.

No unit test file: these are thin queries, and asserting their SQL text would be a string-grep test. Their invariants (lock, takeover, completion rule, matching) are verified by hand against a database during rollout (see Rollout). Verify: `pnpm typecheck`.

### Task 8: Checklist on the dashboard

**Files:**
- Modify: `web/src/app/api/dashboard/route.ts`
- Modify: `web/src/app/api/dashboard/__tests__/route.test.ts`
- Create: `web/src/components/dashboard/trial-checklist-card.tsx`
- Create: `web/src/components/dashboard/__tests__/trial-checklist-card.test.tsx`
- Modify: `web/src/app/(platform)/dashboard/dashboard-page-client.tsx`

**Consumes:** `getActivationState`, `ActivationState` (Task 2).

Route: add `getActivationState(ctx.tenantId).catch(() => null)` to the existing `Promise.all` and return it as `activation`. In the route test, mock `@/lib/activation` so existing cases keep passing; add one case that the response carries `activation` from the mock and a rejected activation yields `activation: null` without failing the dashboard. Regression: an activation query error takes down the whole dashboard.

Card: `TrialChecklistCard({ activation }: { activation: ActivationState | null | undefined })`. Renders null when `activation` is null/undefined, when `subscriptionStatus !== 'trialing'`, or when all five steps are done. Otherwise a card in the dashboard's existing card style (copy border, radius and padding from `pending-reschedule-card.tsx`) with header `Primeiros passos` and `{done} de 5` on the right, then five rows:

| label | done when | href |
|---|---|---|
| Concluir a configuração | onboardingDone | `/onboarding` |
| Cadastrar o primeiro paciente | hasPatient | `/pacientes?novo=1` |
| Agendar o primeiro atendimento | hasAppointment | `/agenda?open=new` |
| Registrar o primeiro procedimento no diagrama facial | hasProcedureRecord | `/pacientes` |
| Enviar a primeira mensagem no WhatsApp | hasWhatsappSend | `/whatsapp` |

Done rows: lucide `CheckCircle2` in `text-sage`, muted label, no link. Open rows: lucide `Circle`, label as `next/link`. `data-testid="trial-checklist"` on the root.

Dashboard client: render `<TrialChecklistCard activation={data.activation} />` right above `<PendingRescheduleCard ... />`.

Tests (pure props, no fetch):
- Trialing, onboarding and patient done: shows `2 de 5`; the patient row has no link; the appointment row links to `/agenda?open=new`.
- All five done: renders nothing. Regression: a finished clinic keeps a stale nag.
- Status `active`: renders nothing. Regression: paying clinics see trial UI.

---

## Group C (depends on B)

### Task 9: Lifecycle sender and welcome hook

**Files:**
- Create: `web/src/lib/lifecycle-sender.ts`
- Create: `web/src/lib/__tests__/lifecycle-sender.test.ts`

**Consumes:** Tasks 2, 3, 4, 6, 7.
**Produces:**

```ts
export type ChannelOutcome = 'sent' | 'failed' | 'skipped' | 'already_claimed'
export interface DeliveryOutcome { whatsapp: ChannelOutcome; email: ChannelOutcome }

export function isLifecycleEnabled(): boolean   // process.env.LIFECYCLE_ENABLED === 'true'
export async function deliverLifecycleMessage(recipient: LifecycleRecipient, message: LifecycleMessage): Promise<DeliveryOutcome>
export function scheduleLifecycleWelcome(target: { tenantId: string } | { ownerEmail: string }): void
```

`deliverLifecycleMessage`:
1. `firstName = ownerFirstName(recipient.ownerName)`, `body = renderLifecycleBody(message, firstName)`.
2. WhatsApp: `phone = recipient.tenantPhone ? normalizeBrPhone(recipient.tenantPhone) : ''`. When `!/^55\d{10,11}$/.test(phone)`: `recordSkippedLifecycleSend({ ..., channel: 'whatsapp', recipient: phone || 'none', reason: 'invalid_phone' })`, outcome `skipped`. Else `id = await claimLifecycleSend({ ..., channel: 'whatsapp', recipient: phone })`; null is `already_claimed`. Then `sendPlatformTemplate(phone, message.templateName, [firstName])`; success: `finishLifecycleSend(id, { status: 'sent', metaMessageId })`, `sent`. Throw: `finishLifecycleSend(id, { status: 'failed', error: String(err.message ?? err) })`, `reportSideEffectFailure(err, { area: 'lifecycle', step: 'whatsapp', extra: { tenantId, key } })`, `failed`.
3. Email: same claim, send, finish flow with `recipient: ownerEmail` and `sendLifecycleEmail({ to: ownerEmail, subject: message.emailSubject, body, button: message.button ? { label: message.button.label, url: getAppUrl() + message.button.path } : null, optOutUrl: message.category === 'MARKETING' ? lifecycleOptOutUrl(recipient.tenantId) : null })`.
4. Channels are independent: a WhatsApp failure never skips the email.

`scheduleLifecycleWelcome` runs its work inside `after()` from `next/server`, wrapped in try/catch that calls `reportSideEffectFailure(err, { area: 'lifecycle', step: 'welcome' })` and never throws:
1. Return when `!isLifecycleEnabled()`.
2. `recipients = await findLifecycleRecipients(target)`; return unless exactly one. (One email can own several clinics; the cron covers that case.)
3. `state = await getActivationState(recipient.tenantId)`; return unless `state && LIFECYCLE_WELCOME.isDue(state)`.
4. `deliverLifecycleMessage(recipient, LIFECYCLE_WELCOME)`.

Tests (mock `@/db/queries/lifecycle`, `@/lib/platform-whatsapp`, `@/lib/email`, `@/lib/observability`, `@/lib/activation`; mock `next/server` `after` to call the callback and keep its promise so the test can await it):
- WhatsApp send throws: email still sent; WhatsApp row finished as `failed` with the error. Regression: one channel failure drops the other.
- `claimLifecycleSend` returns null for both: no send call. Regression: cron and welcome race double-send.
- Phone `(11) 1234`: WhatsApp `skipped` with a skipped row, no WhatsApp claim, email sent. Regression: the key never completes because one channel has no row.
- MARKETING message passes an opt-out URL to the email; UTILITY passes null.
- `scheduleLifecycleWelcome` with `LIFECYCLE_ENABLED` unset never queries recipients. Regression: the kill switch does not hold.
- Two recipients for one email: nothing sent.

### Task 10: Webhook lifecycle handling

**Files:**
- Create: `web/src/lib/lifecycle-webhook.ts`
- Create: `web/src/lib/__tests__/lifecycle-webhook.test.ts`

**Consumes:** Tasks 4 (`optOutTenantLifecycle`), 5 (Discord kind), 7.
**Produces:**

```ts
export interface InboundForCapture {
  id: string
  from: string
  type: string
  text?: { body: string }
  button?: { text?: string }
  context?: { id?: string }
}
export async function captureLifecycleReply(msg: InboundForCapture): Promise<boolean>
export async function handleLifecycleStatus(status: { id: string; status: string; errors?: { title?: string; message?: string }[] }): Promise<boolean>
```

`captureLifecycleReply`:
1. `phone = normalizeBrPhone(msg.from)`.
2. If `msg.context?.id`: `send = await findLifecycleSendByMetaId(msg.context.id)`. Found and `send.recipient === phone`: match. Found with a different recipient: `reportSideEffectFailure(new Error('lifecycle reply phone mismatch'), { area: 'lifecycle', step: 'reply_mismatch', extra: { tenantId } })`, return false. Not found: continue to step 3 (the reply can race the id write, and a context pointing at a patient message is also handled by step 3's conversation check).
3. Contextless or unknown context: `since = new Date(Date.now() - 30 * 86_400_000)`. `candidates = await findRecentLifecycleTenantsByPhone(phone, since)`. Not exactly one: return false (more than one also reports `reply_ambiguous`). Then `if (await hasRecentConversationForPhone(phone, since)) return false`: a phone that talks to a clinic belongs to normal routing.
4. `body = msg.type === 'text' ? msg.text?.body ?? '' : msg.type === 'button' ? msg.button?.text ?? '' : '[mídia]'`.
5. `inserted = await insertLifecycleReply({ tenantId, messageKey, body, metaMessageId: msg.id })`. When inserted: if `normalize(body)` is one of `parar`, `sair`, `stop`, `cancelar` (trim, lowercase, strip accents with `normalize('NFD').replace(/[̀-ͯ]/g, '')`), call `optOutTenantLifecycle(tenantId)`; then `notifyDiscord({ kind: 'lifecycle.reply', tenantName, tenantId, messageKey, body })`.
6. Return true (also when not inserted: a Meta retry of a stored reply must still stay out of patient routing).

`handleLifecycleStatus`: when `status.status === 'failed'`, `markLifecycleSendFailedByMetaId(status.id, firstErrorText || 'failed')` and return its result; otherwise return whether the id is a lifecycle send (`findLifecycleSendByMetaId(status.id) !== null`). True means the caller skips patient status handling.

Tests (mock the queries module, `@/lib/discord`, `@/lib/observability`, `@/lib/lifecycle-opt-out`):
- Context id of a lifecycle send with matching phone: stored with that key, posted to Discord.
- Context id of a lifecycle send with another phone: false, nothing stored. Regression: a forwarded or spoofed reply attributed to the wrong clinic.
- No context, one candidate, no conversation: stored. Same but the phone has a recent clinic conversation: false. Regression: an owner who is also a patient loses a message to their clinic.
- Two candidates: false and ambiguity reported.
- Reply `Parar ` opts the tenant out. A normal reply does not.
- Duplicate webhook (`insertLifecycleReply` false): true, no Discord post, no opt-out call.
- Image message stores `[mídia]`.
- `handleLifecycleStatus` with `failed` marks the row; `delivered` on a non-lifecycle id returns false.

### Task 11: Admin lifecycle section

**Files:**
- Modify: `web/src/app/api/admin/tenants/[id]/route.ts` (GET only)
- Create: `web/src/components/admin/tenant-lifecycle-section.tsx`
- Modify: `web/src/components/admin/admin-tenant-list.tsx` (render the section at the end of `TenantDetail`)
- Create: `web/src/components/admin/__tests__/tenant-lifecycle-section.test.tsx`

GET returns `{ ...tenant, lifecycle: await getLifecycleHistory(id) }`.

Section props: `{ lifecycle?: Awaited<ReturnType<typeof getLifecycleHistory>> }` (import the type only). Renders nothing when `lifecycle` is undefined or both lists are empty. Otherwise two blocks with the `TenantDetail` label style (`text-[10px] uppercase tracking-[0.15em] text-mid font-medium`): `Mensagens de teste` rows show key, channel, status, `dd/MM HH:mm` (date-fns `format` on the ISO instant), and the error in red when present; `Respostas` rows show date, key (or `sem contexto`) and the body with `whitespace-pre-wrap`.

Tests: one render with a fixture holding a failed send and a reply (both texts visible); an empty lifecycle renders nothing. Add a `lifecycle` field to the `admin-tenant-suspend.test.tsx` fixture only if that suite fails without it.

### Task 12: Template provisioning script

**Files:**
- Create: `web/src/scripts/provision-lifecycle-templates.ts`

**Consumes:** `LIFECYCLE_MESSAGES`, `OPT_OUT_FOOTER`, `createPlatformTemplate`.

Header comment with the run command, following `send-announcement-email.ts`:
`cd web && npx tsx --tsconfig tsconfig.json src/scripts/provision-lifecycle-templates.ts [--only=<key>] [--dry-run]`

Loads `.env.local` then `.env` with dotenv before the dynamic imports. For each message (filtered by `--only`), components:

```ts
[
  { type: 'BODY', text: message.body, example: { body_text: [['Ana']] } },
  ...(message.category === 'MARKETING' ? [{ type: 'FOOTER', text: OPT_OUT_FOOTER }] : []),
  ...(message.button ? [{ type: 'BUTTONS', buttons: [{ type: 'URL', text: message.button.label, url: `${appUrl}${message.button.path}` }] }] : []),
]
```

`appUrl` = `process.env.NEXT_PUBLIC_APP_URL`, required. Name = `message.templateName`, language `pt_BR`. `--dry-run` prints the JSON. Otherwise calls `createPlatformTemplate` and prints `name: status` or the error, continuing on failure. No test (manual one-off script).

---

## Group D (depends on C)

### Task 13: Daily cron

**Files:**
- Create: `web/src/app/api/cron/trial-lifecycle/route.ts`
- Create: `web/src/app/api/cron/trial-lifecycle/__tests__/route.test.ts`
- Modify: `web/vercel.json`: add `{ "path": "/api/cron/trial-lifecycle", "schedule": "0 13 * * *" }`

Shape follows `cron/subscription-expiry/route.ts`: `CRON_SECRET` bearer check (401), `withCronMonitor('trial-lifecycle', '0 13 * * *', run)`, `handleApiError` on throw, `export const maxDuration = 300`.

```ts
type Outcome =
  | { tenantId: string; result: 'nothing_due' }
  | { tenantId: string; result: 'delivered'; key: string; whatsapp: ChannelOutcome; email: ChannelOutcome }
  | { tenantId: string; result: 'tenant_error' }

async function run() {
  if (!isLifecycleEnabled()) return { ok: true, disabled: true }
  const recipients = await findLifecycleRecipients()
  const outcomes: Outcome[] = []
  for (const recipient of recipients) {
    try {
      const state = await getActivationState(recipient.tenantId)
      const due = state ? selectDueMessages(state, await getCompletedLifecycleKeys(recipient.tenantId)) : []
      if (due.length === 0) { outcomes.push({ tenantId: recipient.tenantId, result: 'nothing_due' }); continue }
      const delivery = await deliverLifecycleMessage(recipient, due[0])
      outcomes.push({ tenantId: recipient.tenantId, result: 'delivered', key: due[0].key, ...delivery })
    } catch (err) {
      reportSideEffectFailure(err, { area: 'lifecycle', step: 'cron_tenant', extra: { tenantId: recipient.tenantId } })
      outcomes.push({ tenantId: recipient.tenantId, result: 'tenant_error' })
    }
  }
  console.log('[trial-lifecycle]', JSON.stringify({ processed: recipients.length, outcomes: outcomes.filter((o) => o.result !== 'nothing_due') }))
  return { ok: true, processed: recipients.length, outcomes }
}
```

Only `due[0]` is sent: at most one cron message per clinic per day. Vercel discards the response body, so the `console.log` summary is the operational record.

Tests (mock `@/db/queries/lifecycle`, `@/lib/activation`, `@/lib/observability`, `@sentry/nextjs` like `whatsapp-automations/__tests__/route.test.ts`, and from `@/lib/lifecycle-sender` mock `deliverLifecycleMessage` while keeping `isLifecycleEnabled` real with env set per test; use the real `selectDueMessages`):
- Missing or wrong bearer: 401, no recipient query.
- `LIFECYCLE_ENABLED` unset: `{ disabled: true }`, no recipient query.
- A clinic with two due messages gets only the first delivered. Regression: owners get bursts.
- One clinic throwing does not stop the next one; its outcome is `tenant_error`.

### Task 14: Welcome hooks

**Files:**
- Modify: `web/src/app/api/auth/confirm/route.ts` (POST)
- Modify: `web/src/app/api/auth/confirm/__tests__/route.test.ts`
- Modify: `web/src/actions/signup.ts` (`createClinicForOAuthUser` only)
- Modify: `web/src/actions/__tests__/oauth-clinic-details-loop.test.ts`
- Modify: `web/src/actions/__tests__/signup.test.ts` (only add the module mock if the suite fails without it)

Confirm POST: after `markEmailVerified(verifiedEmail)`, call `scheduleLifecycleWelcome({ ownerEmail: verifiedEmail })`.

OAuth: inside the `if (created)` block after the subscription is created, call `scheduleLifecycleWelcome({ tenantId: tenant.id })`.

Password `signUp` sends nothing: the owner has not confirmed the email yet.

Tests: mock `@/lib/lifecycle-sender` in each touched suite. Confirm route: a successful POST calls `scheduleLifecycleWelcome` with the verified email; an invalid token does not. OAuth: a first-time clinic creation calls it with the new tenant id; the `existingMembership` retry does not. Regression: welcome never sent, or sent again for an existing clinic.

### Task 15: Webhook integration

**Files:**
- Modify: `web/src/app/api/webhooks/whatsapp/route.ts`
- Modify: `web/src/app/api/webhooks/whatsapp/__tests__/shared-number-routing.test.ts`
- Modify: `web/src/app/api/webhooks/whatsapp/__tests__/confirmation-reply.test.ts`
- Modify: `web/src/app/api/webhooks/whatsapp/__tests__/ctwa-attribution.test.ts`

Shared-number messages loop, first thing inside the existing `try`, before `resolveSharedNumberTenant`:

```ts
let captured = false
try {
  captured = await captureLifecycleReply(msg)
} catch (err) {
  reportWebhookFailure(err, 'lifecycle_reply')
}
if (captured) continue
```

Shared-number statuses loop, before resolving the tenant for a status:

```ts
let lifecycleStatus = false
try {
  lifecycleStatus = await handleLifecycleStatus(status)
} catch (err) {
  reportWebhookFailure(err, 'lifecycle_status')
}
if (lifecycleStatus) continue
```

Check `reportWebhookFailure`'s signature in the file and match it. Clinic-owned numbers are untouched.

Tests: add `vi.mock('@/lib/lifecycle-webhook', () => ({ captureLifecycleReply: vi.fn().mockResolvedValue(false), handleLifecycleStatus: vi.fn().mockResolvedValue(false) }))` to all three suites so existing behavior is unchanged. In `shared-number-routing.test.ts` add:
- `captureLifecycleReply` resolves true: no message is stored and no tenant resolution runs. Regression: owner feedback becomes a prospect in a clinic inbox.
- `captureLifecycleReply` rejects: the message still routes to its clinic as before. Regression: a lifecycle bug drops patient messages.

---

## Verification after each group

```bash
cd web && pnpm typecheck && pnpm test:run
```

After Group D: `pnpm lint`, then `pnpm ci:checks` from the repo root.

## Rollout (human steps, not tasks)

1. Apply `0032_trial_lifecycle.sql` by hand (after PR #60's 0031).
2. Verify the queries by hand against a local or staging database: claim twice returns one id; a pending row older than 1 hour is not reclaimed and counts as done; a key with one finished channel is not completed; the recipients query returns only flagged, verified, trialing tenants.
3. Optional: mark existing trial clinics as eligible with `update floraclin.tenants set lifecycle_notice_at = now() where id in (...)`.
4. Run the provisioning script; wait for Meta approval.
5. Set `LIFECYCLE_ENABLED=true` in Vercel production and deploy.
