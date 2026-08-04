# Observability: Discord alerts

Two Discord channels, two different jobs:

- **floraclin-logs**: something is broken. Fed by Sentry's own Discord integration.
- **floraclin**: the business grew. Fed by `notifyDiscord` in `web/src/lib/discord.ts`.

## floraclin-logs (Sentry alert rule)

This is configuration in Sentry's UI, not code. There is no webhook receiver of
ours for Sentry to fail silently into — Sentry owns delivery, retries and
formatting. If this rule is ever deleted or the project migrates, recreate it
from this page; it is otherwise invisible to anyone who did not set it up.

**Steps (Sentry UI):**

1. Go to the FloraClin project in Sentry → **Alerts** → **Create Alert Rule**.
2. Alert type: **Issues**.
3. **Environment:** `production` only. Preview and local noise must never
   reach Discord.
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
