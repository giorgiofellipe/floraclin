# Trial activation: lifecycle messages and first-steps checklist

**Date:** 2026-10-09
**Status:** approved in chat, spec written for review

## Goal

Raise trial-to-paid by getting new clinics to their first real action inside the 14-day trial. Ads now bring self-serve signups, and most of them verify the email and never come back. Today nothing reaches the owner after the confirmation email.

## Intent and agreed understanding

What the product does today:

- Trial is 14 days, no card. The only in-app nudge is the top banner with days left. An expired trial blocks writes.
- The onboarding wizard (clinic, procedure types, products, invites) gates every platform page. It stays as is; it is short and asks only for required data.
- Email goes through Resend and covers auth flows only. WhatsApp sends go through the FloraClin shared number (`whatsapp_mode = 'floraclin'`, env `FLORACLIN_WA_*`) or the clinic's own number.
- Production funnel on 2026-10-09: of three real signups that day, two verified the email and did nothing; one finished the wizard. One engaged trial (3 patients, 3 records) expired without paying.

Decisions taken:

- Target the activation leak first (signup to first action). Trial-end conversion gets one message (day 12) and one feedback message after expiry, nothing more in this spec.
- Channels: WhatsApp from the FloraClin number, email twin of every message, and an in-app checklist. Fully self-serve, no human touch.
- Owner replies to lifecycle WhatsApp messages are captured and posted to Discord.

## Scope

In scope:

1. Activation state computed from existing tables.
2. Seven lifecycle messages (WhatsApp template plus email) driven by one daily cron, with the welcome also sent synchronously on email confirmation.
3. Reply capture for owner replies on the shared number, posted to Discord and listed in the admin clinic list detail.
4. "Primeiros passos" checklist card on the dashboard, trial only.
5. Signup consent line and tokenized opt-out link.

Out of scope:

- Trial-end offers, soft landing after expiry, win-back sequences.
- Admin trial board or signup alerts beyond the existing email and Discord notices. The admin clinic detail only gains a read-only lifecycle section.
- Inbound "PARAR" keyword handling.
- Product analytics and Meta CAPI activation events.
- Any change to the onboarding wizard.

## Activation state

`web/src/lib/activation.ts`

```ts
export interface ActivationState {
  onboardingDone: boolean      // tenants.settings.onboarding_completed === true
  hasPatient: boolean          // count(patients where tenant_id) > 0
  hasAppointment: boolean      // count(appointments where tenant_id) > 0
  hasProcedureRecord: boolean  // count(procedure_records where tenant_id) > 0
  hasWhatsappSend: boolean     // count(whatsapp_messages where tenant_id and direction = 'outbound') > 0
  trialDay: number             // whole days since tenant_subscriptions.current_period_start, BR calendar
  subscriptionStatus: SubscriptionStatus
  optedOut: boolean            // tenants.lifecycle_opted_out_at is not null
}

export async function getActivationState(tenantId: string): Promise<ActivationState>
```

One round trip: a single `select` with five scalar subqueries plus the tenant and subscription rows. Soft-deleted patients count as present; the goal is "did they try it", not current inventory.

`trialDay` uses `toBrYmd` on both instants and `differenceInCalendarDays`, never `Date.now() - start` arithmetic. Day 0 is the signup day.

## Message sequence

`web/src/lib/lifecycle-messages.ts` holds the definitions as data. No copy lives anywhere else.

```ts
export interface LifecycleMessage {
  key: LifecycleMessageKey
  minDay: number
  shouldSend: (state: ActivationState) => boolean
  whatsapp: { templateName: string; category: 'UTILITY' | 'MARKETING' }
  email: { subject: string }
  bodyPtBr: string          // same text for the template body and the email
  buttonLabel: string
  buttonPath: string        // relative to NEXT_PUBLIC_APP_URL
}
```

| Key | Day | Fires when | Category | Button path |
|---|---|---|---|---|
| trial_welcome | 0 | status trialing | UTILITY | `/dashboard` |
| trial_setup_incomplete | 1 | trialing and not onboardingDone | MARKETING | `/onboarding` |
| trial_first_patient | 2 | trialing and not hasPatient | MARKETING | `/pacientes?new=true` |
| trial_first_record | 4 | trialing and not hasProcedureRecord | MARKETING | `/pacientes` |
| trial_first_appointment | 7 | trialing and (not hasAppointment or not hasWhatsappSend) | MARKETING | `/agenda` |
| trial_ending | 12 | trialing | UTILITY | `/configuracoes?tab=assinatura` |
| trial_feedback | 16 | status expired and source trial | MARKETING | none, text asks for a reply |

Rules:

- A message fires at most once per tenant per channel. The `tenant_lifecycle_messages` row is the lock.
- A message fires when `trialDay >= minDay` and `shouldSend(state)` is true at run time. A clinic that skipped day 2 and still has no patient on day 3 gets `trial_first_patient` on day 3. A clinic that added a patient on day 1 never gets it.
- `optedOut` suppresses every MARKETING message on both channels. UTILITY messages (welcome, trial_ending) still go out.
- Missing or invalid owner phone skips WhatsApp for that tenant and still sends the email.
- Owner phone is `tenants.phone` (collected at signup). Owner email is the user with role `owner` in `tenant_users`. If a tenant has several owners, the earliest `tenant_users.created_at` wins.
- First name for `{{1}}` is the first word of the owner's `full_name`.

### Copy (pt_BR)

Bodies never start or end with a variable (Meta rule, see AGENTS.md). MARKETING templates add the footer `Para não receber mais dicas, use o link do e-mail.`

| Key | Email subject | Body |
|---|---|---|
| trial_welcome | Sua conta na FloraClin está pronta | Olá, {{1}}! Sua conta na FloraClin está pronta. Comece pelo diagrama facial: cadastre um paciente e registre o primeiro procedimento em menos de 5 minutos. |
| trial_setup_incomplete | Faltam 3 minutos para liberar sua agenda | Olá, {{1}}! Faltam 3 minutos para terminar a configuração da sua clínica na FloraClin. Depois disso, a agenda e os pacientes ficam liberados. |
| trial_first_patient | Seu primeiro paciente na FloraClin | Olá, {{1}}! O primeiro passo na FloraClin é cadastrar um paciente. Leva 1 minuto e libera o diagrama facial, a agenda e o WhatsApp. |
| trial_first_record | Registre um procedimento no diagrama facial | Olá, {{1}}! Já registrou um procedimento no diagrama facial? Marque os pontos, o produto e a quantidade. O histórico do paciente fica pronto para a próxima sessão. |
| trial_first_appointment | Agenda com confirmação por WhatsApp | Olá, {{1}}! Agende o próximo atendimento na FloraClin e deixe a confirmação por WhatsApp com a gente. O paciente confirma com um toque. |
| trial_ending | Seu teste termina em 2 dias | Olá, {{1}}! Seu teste gratuito da FloraClin termina em 2 dias. Para manter a agenda, os pacientes e o WhatsApp funcionando, escolha um plano. |
| trial_feedback | O que faltou na FloraClin? | Olá, {{1}}! Seu teste na FloraClin terminou. O que faltou para você continuar? Responda esta mensagem, lemos cada resposta. |

Button labels: `Abrir FloraClin` for welcome, `Terminar configuração`, `Cadastrar paciente`, `Abrir pacientes`, `Abrir agenda`, `Ver planos`. The feedback template has no button.

Email layout reuses the inline style of `sendInviteEmail` in `web/src/lib/email.ts`: FloraClin heading, body paragraph, one green button, and a footer line with the opt-out link on MARKETING messages.

## Channels and compliance

- Signup page gets one line under the phone field: `Você receberá dicas da FloraClin por WhatsApp e e-mail durante o teste.` No checkbox. This is the opt-in record for Meta.
- Opt-out: `GET /api/lifecycle/opt-out?t=<tenantId>&s=<sig>` where `sig` is HMAC-SHA256 of the tenant id with `NEXTAUTH_SECRET`, hex. Valid signature sets `tenants.lifecycle_opted_out_at` and renders a plain page `Pronto. Você não receberá mais dicas da FloraClin.` Invalid signature returns 400. No login required.
- The six templates with a button and the feedback template are platform templates in the FloraClin WABA. They are created once by a script, `web/src/scripts/provision-lifecycle-templates.ts`, which calls the Meta template API with the bodies above and prints the status. They are not rows in `whatsapp_templates` and never appear in a clinic's template list. The cron does not check approval status; an unapproved template fails the send, the row records the error, and the email still goes out.

## Architecture

New units:

1. `web/src/lib/activation.ts`: `getActivationState`.
2. `web/src/lib/lifecycle-messages.ts`: definitions, `selectDueMessages(state, alreadySent: Set<key>)`, pure.
3. `web/src/lib/platform-whatsapp.ts`: `sendPlatformTemplate(to, templateName, bodyParams, buttonUrlSuffix?)`. Reads `FLORACLIN_WA_*` directly, posts to Graph API, returns `{ metaMessageId }`. No tenant credit, no `requireSendAllowed`, no template lookup. Throws `BusinessError('WHATSAPP_NOT_CONFIGURED', ...)` when env is missing.
4. `web/src/lib/lifecycle-sender.ts`: `deliverLifecycleMessage(tenantId, message, state)`. Resolves owner, sends WhatsApp and email, inserts one `tenant_lifecycle_messages` row per channel with outcome. This is the one function both the cron and the confirm route call.
5. `web/src/db/queries/lifecycle.ts`: inserts and lookups for `tenant_lifecycle_messages` and `tenant_lifecycle_replies`, `listTrialTenantsForLifecycle()` (status trialing, or expired with source trial and period end within the last 10 days).
6. `web/src/app/api/cron/trial-lifecycle/route.ts`: daily cron.
7. `web/src/app/api/activation/route.ts`: `GET`, owner or practitioner, returns `ActivationState` for the checklist.
8. `web/src/app/api/lifecycle/opt-out/route.ts`.
9. `web/src/components/dashboard/trial-checklist-card.tsx` and `web/src/hooks/queries/use-activation.ts`.
10. `web/src/app/api/admin/tenants/[id]/lifecycle/route.ts`: `GET`, `requirePlatformAdmin`, returns the tenant's lifecycle sends and replies, newest first.
11. `web/src/components/admin/tenant-lifecycle-section.tsx`: read-only section rendered inside `TenantDetail` in `admin-tenant-list.tsx` (the expanded row). Two short lists: sends (key, channel, date, error if any) and replies (date, key, body).

Touched units:

- `web/src/app/api/auth/confirm/route.ts`: after `consumeConfirmationToken` succeeds, call `deliverLifecycleMessage` for `trial_welcome` inside `after()` so the redirect is not delayed. Failure is reported to Sentry and left for the cron to retry.
- `web/src/app/api/webhooks/whatsapp/route.ts`: reply capture branch before `resolveSharedNumberTenant` (see below).
- `web/src/app/(platform)/dashboard/dashboard-page-client.tsx`: render the card above `QuickStats`.
- `web/src/app/(auth)/signup/page.tsx`: consent line.
- `web/src/db/schema.ts` and migration `0032_trial_lifecycle.sql`.
- `vercel.json`: add `{ "path": "/api/cron/trial-lifecycle", "schedule": "0 13 * * *" }` (10:00 BRT, Hobby plan allows once per day only; firing drifts up to 59 minutes).

## Data model

Migration `web/src/db/migrations/0032_trial_lifecycle.sql`, applied by hand before merge.

```sql
CREATE TABLE "floraclin"."tenant_lifecycle_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40) NOT NULL,
  "channel" varchar(10) NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "meta_message_id" varchar(255),
  "error" text,
  CONSTRAINT "tenant_lifecycle_messages_channel_check" CHECK ("channel" IN ('whatsapp', 'email')),
  CONSTRAINT "uq_tenant_lifecycle_message" UNIQUE ("tenant_id", "message_key", "channel")
);
CREATE INDEX "idx_tenant_lifecycle_messages_meta_id" ON "floraclin"."tenant_lifecycle_messages" ("meta_message_id");

CREATE TABLE "floraclin"."tenant_lifecycle_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "message_key" varchar(40),
  "body" text NOT NULL,
  "meta_message_id" varchar(255) NOT NULL UNIQUE,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
```

A row with `error` set counts as attempted and is never retried. The email twin covers a failed WhatsApp send and the WhatsApp twin covers a failed email. The only exception is the welcome: when the synchronous send on email confirmation fails, no row is written, so the cron sends it the next morning.

Tenants gain `lifecycle_notice_at` (eligibility) and `lifecycle_opted_out_at` columns, so a full settings write cannot erase them.

## Cron: `/api/cron/trial-lifecycle`

Same shape as `whatsapp-automations`: `CRON_SECRET` bearer check, `withCronMonitor('trial-lifecycle', '0 13 * * *', run)`, per-tenant outcomes in the JSON response.

```
for tenant in listTrialTenantsForLifecycle():
  state = getActivationState(tenant.id)
  sent  = keys with any row for this tenant (either channel, error or not)
  due   = selectDueMessages(state, sent)
  for message in due: deliverLifecycleMessage(tenant.id, message, state)
```

`selectDueMessages` returns due messages in `minDay` order and the cron delivers only the first one per tenant per run. A tenant first seen on day 2 with nothing done gets the welcome that morning, setup_incomplete the next, and so on. The sequence stretches but never stacks. The welcome sent on email confirmation does not count against the cron's one per day.

Tenants with `is_demo` in settings or `name LIKE 'TESTE%'` are skipped. The demo tenant is on `whatsapp_mode = 'own'` already; the name filter protects E2E tenants.

## Welcome on email confirmation

In `api/auth/confirm/route.ts`, after the token is consumed and the user row is marked verified, resolve the user's tenant and call `deliverLifecycleMessage(tenantId, WELCOME, state)` inside `after()`. The unique constraint makes the cron a no-op for that key when the synchronous send succeeded.

## Reply capture

In the webhook shared-number branch, before `resolveSharedNumberTenant`:

1. If `msg.context?.id` matches `tenant_lifecycle_messages.meta_message_id`, the tenant and `message_key` come from that row.
2. Else, if `normalizeBrPhone(msg.from)` equals `normalizeBrPhone(tenants.phone)` for a tenant that has a WhatsApp lifecycle row in the last 30 days, that tenant wins. If more than one tenant matches, refuse and report `lifecycle_reply_ambiguous`, then fall through to the patient path. `message_key` is the most recent WhatsApp row for that tenant.
3. On a match: insert `tenant_lifecycle_replies` (text messages only; media replies store `[mídia]` as body), call `notifyDiscord({ kind: 'lifecycle.reply', tenantName, tenantId, messageKey, body })`, and `continue`. No conversation row, no patient routing, no classification.

`discord.ts` gets the new event kind and routes it to the same webhook as `clinic.created`. Replies are also listed in the admin clinic list detail (see Architecture, units 10 and 11).

The check runs on every shared-number message. It is one indexed lookup by message id plus one lookup by phone, both cheap.

## Checklist card

`TrialChecklistCard` renders when `subscriptionStatus === 'trialing'` and at least one of the five steps is open. Five rows, each a checkmark state, a label, and a link:

1. Concluir a configuração: `/onboarding` (always done when the card is visible, since the layout gates on it; shown checked for the sense of progress)
2. Cadastrar o primeiro paciente: `/pacientes?new=true`
3. Agendar o primeiro atendimento: `/agenda`
4. Registrar o primeiro procedimento no diagrama facial: `/pacientes`
5. Enviar a primeira mensagem no WhatsApp: `/whatsapp`

Header: `Primeiros passos` and `N de 5`. No dismiss button; it disappears on its own. Query key `['activation']`, invalidated by the same mutations that invalidate `queryKeys.dashboard` (patients, appointments, procedure records, WhatsApp sends already do this).

## Error handling

- WhatsApp send failure: row with `error`, email still sent, Sentry breadcrumb, cron outcome `whatsapp_failed`. No throw.
- Email send failure: row with `error`, Sentry capture, outcome `email_failed`.
- Missing `FLORACLIN_WA_*`: every WhatsApp row records `WHATSAPP_NOT_CONFIGURED`, emails still go. The cron response says so once per run.
- Confirm route: the welcome runs in `after()`; any failure is captured and never affects the redirect.
- Webhook reply capture: wrapped like the existing per-message try/catch, failure tagged `lifecycle_reply`.

## Testing

All tests mock the database and senders. Nothing hits Supabase.

- `lib/__tests__/lifecycle-messages.test.ts`: the day and state matrix for `selectDueMessages`, including opt-out suppressing MARKETING only, already-sent keys skipped, late first run returning several messages in order, feedback firing only for expired trials with source trial.
- `lib/__tests__/activation.test.ts`: `trialDay` across the BR midnight boundary using `parseBrDate`, each boolean from its count.
- `lib/__tests__/lifecycle-sender.test.ts`: both channels attempted, WhatsApp failure still sends email, rows written with outcome, missing phone skips WhatsApp.
- `api/cron/trial-lifecycle/__tests__/route.test.ts`: auth guard, per-tenant outcomes, demo and TESTE tenants skipped, a key with a failed row is not resent.
- `api/webhooks/whatsapp/__tests__`: reply with context id captured and patient routing not reached; reply by phone captured; ambiguous phone falls through; media reply stored as `[mídia]`.
- `api/lifecycle/opt-out/__tests__/route.test.ts`: valid signature flips the setting, invalid returns 400.
- `components/dashboard/__tests__/trial-checklist-card.test.tsx`: hidden when not trialing or all done, rows and links, count label.
- `api/admin/tenants/[id]/lifecycle/__tests__/route.test.ts`: platform admin only, returns sends and replies newest first.
- `scripts/provision-lifecycle-templates.ts` has no test; it is run by hand once.

Every bug regression test follows the `test-audit` gate and is seen failing before the fix.

## Rollout

1. Apply migration 0032 by hand.
2. Run the template provisioning script against the FloraClin WABA and wait for Meta approval (1 to 2 days). Marketing templates sometimes get rejected on first pass; the script accepts a `--suffix` to resubmit under a new name, since Meta blocks reusing a deleted name for 30 days.
3. Deploy. Until templates are approved, WhatsApp rows record the Meta error and emails carry the sequence alone.
4. Watch the Discord channel for replies and the cron response in Vercel logs for the first week.

## Open questions

None blocking. One thing to confirm during implementation: the exact Graph API payload for a URL button with a static URL on a platform template. The `/whatsapp` page path for step 5 exists under `(platform)`.
