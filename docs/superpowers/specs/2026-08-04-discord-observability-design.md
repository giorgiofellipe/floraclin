# Discord observability: design

**Status:** approved, ready for planning

## Problem

FloraClin has Sentry wired (`@sentry/nextjs`, `src/instrumentation.ts` and
`src/instrumentation-client.ts`) but nobody is told when it fires, and there is no
signal at all when a clinic signs up or subscribes. Both facts are only
discoverable by going and looking.

Two Discord channels, two different jobs:

- **floraclin-logs**: something is broken.
- **floraclin**: the business grew.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Sentry scope | New issues plus regressions | One message per genuinely new problem. A deploy throwing 5.000 times is one alert. Regressions are included because a fix that did not hold is otherwise easy to miss. |
| Sentry delivery | Sentry's native Discord integration | No code in the repo, Sentry owns retries and keeping it working. The fixed message format is an accepted cost. |
| Business events | One small notifier module | Only the second channel needs code. |
| Personal data | Never posted | Clinic name, city, plan and an admin link. Not the owner's email or phone. |

## Credentials

The two webhook URLs are secrets: anyone holding one can post into the channel.

- They live in Vercel as `DISCORD_WEBHOOK_EVENTS`, **Production only**, so preview
  deploys and local runs cannot post into the real channel.
- They are never committed. No default value in code, no example in a `.env`
  file that contains the real URL.
- They were pasted into a chat transcript during design. If that transcript is
  ever shared or exported, regenerate both in Discord.

The floraclin-logs URL is entered into Sentry's UI, not stored in the repo at all.

## Part 1: floraclin-logs (configuration, no code)

A Sentry alert rule:

- Environment: production only. Preview and local noise never reaches Discord.
- Trigger: a new issue is created, or a resolved issue regresses.
- Action: send to the Discord integration, channel floraclin-logs.

This is deliberately not code. Sentry already owns delivery, retries and
formatting, and a receiver of our own would be one more thing that can fail
silently in exactly the moment we need it.

**It gets written into a runbook** at `docs/runbooks/observability.md`, because a
rule that exists only in a UI is invisible to everyone who did not create it, and
nobody will know to recreate it after an account change.

## Part 2: floraclin (the notifier)

### Module

`web/src/lib/discord.ts`, exposing one function:

```ts
export async function notifyDiscord(event: DiscordEvent): Promise<void>
```

`DiscordEvent` is a discriminated union, so adding an event forces the formatter
to handle it rather than silently posting nothing:

- `{ kind: 'clinic.created', tenantName, city, state, tenantId }`
- `{ kind: 'clinic.approved', tenantName, tenantId }`
- `{ kind: 'subscription.created', tenantName, planName, priceCents, tenantId }`

### Three properties that matter more than the formatting

**1. It can never break a signup.** Every call is wrapped so a throw cannot
escape, and dispatched with `after()` from `next/server` so a slow or unreachable
Discord never delays the response. A failed post is reported to Sentry and
otherwise ignored. Someone creating a clinic must not care that Discord exists.

**2. It is a no-op when unconfigured.** No `DISCORD_WEBHOOK_EVENTS` means the
function returns immediately, before building a payload or opening a socket.
This is what keeps local development and the test suite from posting into the
real channel, which is the usual way these integrations embarrass people.

**3. It posts no personal data.** Clinic name, city, plan, and a link to the
admin page for that tenant. Not the owner's name, email or phone. Anyone wanting
the rest clicks through, and the channel stays safe to screenshot or to widen
access to later. Patient data cannot appear, because none of these events touch
it.

### Call sites

All three already exist. The notifier is added to them, nothing is restructured.

| Event | Where | Note |
|---|---|---|
| `clinic.created` | `web/src/actions/signup.ts` | Creates the tenant and its owner together. |
| `clinic.approved` | `web/src/app/api/admin/tenants/[id]/approve/route.ts` | The moment a clinic becomes real, distinct from signing up. |
| `subscription.created` | `web/src/db/queries/subscriptions.ts` `createSubscription` | Fire from the caller, not inside the query module, so a query stays a query. |

`createSubscription` is called both by self-signup and by the Stripe path, and it
is idempotent (`onConflictDoNothing`, returning the existing row). The notifier
must fire only when a row was actually inserted, or a retried webhook posts a
duplicate announcement.

## Testing

- The payload builder is pure and unit tested per event kind: correct title,
  correct fields, and **no personal data present**, asserted explicitly rather
  than assumed.
- `notifyDiscord` is a no-op with no env var set: asserted by spying on `fetch`
  and expecting zero calls. This test is the guard that stops the suite ever
  posting to the real channel.
- A rejected `fetch` does not throw out of `notifyDiscord`.
- The subscription notifier does not fire when `createSubscription` returned an
  existing row.

No test performs a real network call.

## Out of scope

- Alerting on business thresholds (churn, failed payments, usage limits). This
  ships awareness, not analytics.
- A receiver of our own for Sentry. Revisit only if the native format proves
  insufficient in practice.
- Any second destination (email, Slack). One channel each, deliberately.
