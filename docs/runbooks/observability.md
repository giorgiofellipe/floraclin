# Observability: Sentry and Discord alerts

Sentry is the error store; Discord is where the alerts land.

- **Sentry** (`bullcode/floraclin`) receives every unexpected server and client
  error. See "What reaches Sentry" below for what is wired up and what is
  deliberately not reported.
- Two Discord channels, two different jobs:

  - **floraclin-logs**: something is broken, or a daily heartbeat proving the
    cron is alive. Fed by Sentry's own Discord integration, and also by
    `notifyDiscord` in `web/src/lib/discord.ts` for the whatsapp-automations
    cron digest.
  - **floraclin**: the business grew. Fed by `notifyDiscord` in
    `web/src/lib/discord.ts`.

## What reaches Sentry

| Source | Wired by |
|---|---|
| Uncaught server errors (RSC, route handlers, server actions) | `onRequestError` in `web/src/instrumentation.ts` |
| Caught API route failures (the 500 branch) | `handleApiError` in `web/src/lib/api-error.ts` |
| Swallowed side effects: Google Calendar push sync and OAuth, WhatsApp webhook steps, Stripe signature checks, photo cleanup | `reportSideEffectFailure` in `web/src/lib/api-error.ts` |
| Client render errors inside the app | `error.tsx` in the `(auth)` and `(platform)` route groups |
| Client render errors in the root layout | `web/src/app/global-error.tsx` |
| Missed or failed `calendar-renew` / `subscription-expiry` runs | `Sentry.withMonitor` in each cron route |
| whatsapp-automations tenant failures | `Sentry.captureMessage` / `captureException` in that route, plus the Discord digest below |

Deliberately **not** reported: 401 (logged-out caller, which arrives as a
Next.js `redirect()` throw), 403 (`ForbiddenError` from `requireRole`), and the
400/404 branches each route checks before falling through to the helper. These
are expected outcomes, not bugs, and paging on them buries the real signal. A
route that maps a business failure to a 400 must do so *before* calling
`handleApiError`, or it becomes a reported 500.

Every 500 that goes through `handleApiError` carries an `eventId` in its JSON
body. Whoever hits the failure can read that id off the response and look it up
in Sentry directly, without correlating by timestamp. A handful of routes still
return a hand-built 500 for a "the update returned nothing" case; those have no
`eventId` and do not reach Sentry.

The `route` tag is masked: uuids, numeric ids and opaque tokens become `:id`.
That keeps `/api/anamnesis/token/<live-token>` out of Sentry and groups issues
by route instead of by row.

### Environment names

`Sentry.init` sets `environment` explicitly to `production` / `preview`. Do not
remove that line and fall back to the SDK default: it prefixes the value and
reports `vercel-production`, which the alert rule below (scoped to
`production`) would silently never match.

Server-side it reads `VERCEL_ENV` directly. Client-side it reads
`NEXT_PUBLIC_SENTRY_ENVIRONMENT`, which `next.config.ts` inlines from
`VERCEL_ENV` at build time. That indirection exists so the browser bundle does
not depend on Vercel's "Automatically expose System Environment Variables"
toggle: with the toggle off, `NEXT_PUBLIC_VERCEL_ENV` is undefined in the
client and every preview error would tag itself `production`.

### Tenant and user context

`getAuthContext` calls `Sentry.setUser({ id })` and tags the event with
`tenant_id` and `role`. Ids only. `sendDefaultPii` is off and no patient or
owner identity (name, e-mail, phone) is ever attached. Filter by `tenant_id`
in Sentry to see whether a bug hit one clinic or all of them.

### Cron monitors

`calendar-renew` and `subscription-expiry` wrap their work in
`Sentry.withMonitor`, which upserts the monitor on first check-in. The
schedules in those files mirror `vercel.json` and are declared in `Etc/UTC`,
because Vercel evaluates cron expressions in UTC. If a schedule changes in
`vercel.json`, change it in the route too or Sentry will report every run as
late.

`calendar-renew` fails its check-in only when *every* renewal failed. One
clinic with a revoked Google grant is that clinic's problem and would otherwise
turn the cron red every night until they reconnect; zero renewals out of N is
the integration being down, which is the alert worth having.

`whatsapp-automations` has no monitor on purpose: its daily Discord digest is
already a positive heartbeat (see below).

### Google Calendar failures we do not report

`reportCalendarFailure` in `web/src/lib/google-calendar.ts` drops `invalid_grant`
and 401/403 responses from Google before reporting. Those mean the clinic has to
reconnect, which the UI already tells them, and the calendar side effects fire on
every appointment write and every webhook: one disconnected clinic would produce
a Sentry event per operation until it reconnects. Everything else reports.

## floraclin-logs (Sentry alert rule)

This is configuration in Sentry's UI, not code. There is no webhook receiver of
ours for Sentry to fail silently into — Sentry owns delivery, retries and
formatting. If this rule is ever deleted or the project migrates, recreate it
from this page; it is otherwise invisible to anyone who did not set it up.

**Steps (Sentry UI):**

1. Go to the FloraClin project in Sentry → **Alerts** → **Create Alert Rule**.
2. Alert type: **Issues**.
3. **Environment:** `production` only. Preview and local noise must never
   reach Discord. This is the value `Sentry.init` sets explicitly; see
   "Environment names" above.
4. **Trigger (WHEN):**
   - "A new issue is created"
   - OR "The issue changes state from resolved to unresolved" (regression)
5. **Action (THEN):** Send a notification to the **Discord** integration,
   channel `floraclin-logs`.
   - If the Discord integration is not yet installed: Settings → Integrations
     → Discord → connect the workspace → map it to the `floraclin-logs`
     channel using its webhook URL. The webhook URL itself is entered once
     into Sentry's UI and is never stored in this repo.
6. Save the rule. Give it a name that says what it does, e.g. "New issues +
   regressions → floraclin-logs (production)".

**To verify it's still wired up:** trigger a test error in production (or use
Sentry's "Send Test Notification" on the alert rule) and confirm a message
lands in `floraclin-logs`.

### whatsapp-automations digest (code-based)

The daily whatsapp-automations cron (`web/src/app/api/cron/whatsapp-automations/route.ts`)
also posts to `floraclin-logs`, via `notifyDiscord` with a
`whatsapp_automations.digest` event -- not through Sentry's integration.

It posts on **every run**, success or not. Silence in the channel is
ambiguous between "nothing to send today" and "the cron never ran", so the
digest turns the channel into a positive signal instead: expect exactly one
digest message per day. A message with an empty `failingTenants` list and a
green color is the routine, healthy case -- it is not noise, it is the proof
the job executed. Tenants with `send_failed`, `tenant_error` or
`credit_exhausted` outcomes are listed by name and turn the embed red.

Posting the digest can never fail the cron: `notifyDiscord` never throws by
contract, and the route additionally wraps the call in a try/catch that only
`console.error`s.

### Env var: `DISCORD_WEBHOOK_LOGS`

- Set in **Vercel → Project Settings → Environment Variables**, scoped to
  **Production only**, same as `DISCORD_WEBHOOK_EVENTS` below. Preview
  deploys and local `pnpm dev` must not have it set, or they will post into
  the real `floraclin-logs` channel.
- If it is unset, `notifyDiscord` returns immediately before building a
  payload or calling `fetch`, same guard as `DISCORD_WEBHOOK_EVENTS` -- this
  is what keeps local dev and the test suite silent.
- To get a new webhook URL: Discord channel `floraclin-logs` → Edit Channel
  → Integrations → Webhooks → New Webhook → copy URL. Paste it directly into
  Vercel; do not paste it into a chat transcript or commit it anywhere.
- If a webhook URL is ever exposed, regenerate it in Discord and update the
  Vercel env var, same as `DISCORD_WEBHOOK_EVENTS` below.

## floraclin (business events)

Code-based. `web/src/lib/discord.ts` exports `notifyDiscord(event)`, called
from the three places a clinic's story changes:

| Event | Fires from |
|---|---|
| `clinic.created` | `web/src/actions/signup.ts` (self-signup, both credential and Google OAuth paths) |
| `clinic.approved` | `web/src/app/api/admin/tenants/[id]/approve/route.ts` |
| `subscription.created` | Callers of `createSubscription` in `web/src/db/queries/subscriptions.ts`, guarded so it only fires when a row was actually inserted (not on an idempotent no-op) |

It never posts personal data: clinic name, city/state, plan, price and a link
to `/admin/clinicas`. Never the owner's name, email or phone, and patient data
cannot appear because none of the event payloads carry it.

### Env var: `DISCORD_WEBHOOK_EVENTS`

- Set in **Vercel → Project Settings → Environment Variables**, scoped to
  **Production only**. Preview deploys and local `pnpm dev` must not have it
  set, or they will post into the real `floraclin` channel.
- If it is unset, `notifyDiscord` returns immediately before building a
  payload or calling `fetch` — this is what keeps local dev and the test
  suite silent. Do not add a default or example value anywhere in the repo.
- To get a new webhook URL: Discord channel `floraclin` → Edit Channel →
  Integrations → Webhooks → New Webhook → copy URL. Paste it directly into
  Vercel; do not paste it into a chat transcript or commit it anywhere.
- If a webhook URL is ever exposed (chat export, screenshot, leaked log),
  regenerate it in Discord and update the Vercel env var. Anyone holding the
  URL can post into the channel.

### Local testing without posting to the real channel

Leave `DISCORD_WEBHOOK_EVENTS` unset locally. If you need to see a real
message land, point it at a scratch Discord channel's webhook temporarily —
never at `floraclin` or `floraclin-logs`.

## Out of scope

- Alerting on business thresholds (churn, failed payments, usage limits).
  This is awareness, not analytics.
- A receiver of our own for Sentry. Revisit only if the native Discord
  integration's fixed message format proves insufficient in practice.
- Any destination beyond these two channels (email, Slack, etc).
