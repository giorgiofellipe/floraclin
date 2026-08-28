# Meta conversions from the CRM: design

**Status:** approved, ready for planning

## Problem

Clinics on FloraClin run Meta ads to fill their agenda. Nothing that happens
after the click ever gets back to Meta, so the ad optimizer is flying blind: it
knows a message was started, not whether that lead booked or paid.

Three concrete gaps in the code today:

1. `src/app/api/webhooks/whatsapp/route.ts:195` creates a prospect from an
   inbound message and discards the `referral` object Meta attaches to
   Click-to-WhatsApp messages. The `ctwa_clid` and the ad id arrive on every
   ad-originated conversation and are thrown away, so no CTWA lead can ever be
   attributed.
2. `src/app/api/book/[slug]/route.ts` creates an appointment and no prospect at
   all. Online bookings never enter the CRM, so a lead that arrives through the
   booking page is invisible to the funnel.
3. There is no Meta Pixel, no Conversions API client, and no attribution column
   anywhere in the schema.

The result: a clinic cannot tell which campaign produced revenue, and Meta
cannot optimize toward the clinics that convert.

## Scope

Tenant-facing. Every clinic connects its own Meta dataset and receives its own
conversions. FloraClin's own SaaS funnel (the `site/` package, trial signups) is
explicitly out of scope and would be a separate spec.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Whose ad account | Each clinic (tenant) | The clinic buys the ads and owns the patients. FloraClin is the processor moving the signal. |
| Entry points | CTWA, booking page, organic, manual | The first two carry a click id and get real attribution. The last two get correct source tagging so the report does not credit ads for walk-ins. |
| Funnel depth | Lead, Contact, Schedule, Purchase with BRL value | Meta optimizes toward revenue rather than lead count. The revenue join already exists through `prospects.convertedPatientId`. |
| Identifiers sent | Full advanced matching (hashed) | Best match rates, and the only way an offline stage move with no click id can attribute at all. Carries an LGPD cost, handled in Part 5. |
| Meta connection | OAuth and manual paste, both permanent | OAuth is the path a clinic owner can complete. Manual paste is the agency path and ships before App Review. |
| Delivery | Outbox row, inline send, cron sweeps failures | Durable and immediate. The cron is a retry path, not the primary one. |
| Reporting | Card attribution plus a marketing report | The events themselves are invisible. The clinic needs to see the funnel it paid for. |
| ROAS | Not in this spec | Needs ad spend from the Marketing API, which needs OAuth shipped first. Revisit after App Review. |

### Rejected alternatives

**Fire and forget inline.** Call the Conversions API in the route that changes
the stage and ignore the result. Roughly 200 lines, no new table, no cron.
Rejected because a Meta outage silently destroys conversions and there is no
answer when an agency asks whether a Purchase landed. Purchase events steer real
ad spend, so silent loss is the expensive kind of loss.

**Vercel Queues.** Durable delivery with native retries and less code than an
outbox. Rejected on two counts: it is public beta, and the event log is wanted
in Postgres regardless to power the diagnostics panel that support will actually
open.

**Click ids only, no hashed PII.** Cleanest LGPD posture, no consent flow. 
Rejected because offline stage moves (a lead that walks in and pays weeks later)
carry no click id, and those are exactly the conversions worth reporting.

## Part 1: Data model

Three new tables in `floraclinSchema`, all tenant-scoped, plus two columns.

### `lead_attributions`

One row per prospect, written once and never updated. First touch wins: a lead
who clicks an ad, goes quiet, then returns through an organic post keeps the ad
attribution. This matches how Meta attributes and stops the row from churning.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenantId` | uuid fk tenants | |
| `prospectId` | uuid fk prospects, unique | one attribution per lead |
| `channel` | varchar(20) | `ctwa`, `booking_page`, `manual`, `organic` |
| `ctwaClid` | text | CTWA click id, the CTWA match key |
| `fbclid` | text | booking page click id |
| `fbp` | text | `_fbp` browser cookie |
| `fbc` | text | derived `fb.1.<ts>.<fbclid>` |
| `adId` | varchar(64) | Meta `source_id` |
| `adsetId` | varchar(64) | resolved later via OAuth, nullable |
| `campaignId` | varchar(64) | resolved later via OAuth, nullable |
| `adHeadline` | text | shown on the Kanban card |
| `sourceUrl` | text | Meta `source_url` |
| `landingUrl` | text | booking page only |
| `clientIp` | varchar(64) | needed by CAPI for match quality |
| `userAgent` | text | needed by CAPI for match quality |
| `capturedAt` | timestamptz | |

Indexes: unique on `prospectId`, plus `(tenantId, adId)` and
`(tenantId, capturedAt)` for the report.

### `meta_conversion_events` (the outbox)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenantId` | uuid fk tenants | |
| `prospectId` | uuid fk prospects | nullable: a walk-in patient who was never a lead still produces a Purchase |
| `eventName` | varchar(30) | `Lead`, `Contact`, `Schedule`, `Purchase` |
| `eventId` | varchar(120) | deterministic, see below |
| `eventTime` | timestamptz | the real-world instant, not send time |
| `value` | decimal(10,2) | Purchase only |
| `currency` | varchar(3) | `BRL` |
| `payload` | jsonb | exactly what we POST, PII already hashed |
| `status` | varchar(10) | `pending`, `sent`, `failed`, `skipped` |
| `attempts` | integer default 0 | |
| `lastError` | text | |
| `fbTraceId` | varchar(64) | Meta's trace id, for support |
| `sentAt` | timestamptz | |
| `createdAt` | timestamptz | |

`eventId` is derived, never random:

- `lead:<prospectId>`
- `contact:<prospectId>`
- `schedule:<appointmentId>`, or `schedule:<prospectId>` when the stage was moved by hand with no appointment attached
- `purchase:<financialEntryId>`

A unique index on `(tenantId, eventId)` makes double firing impossible in the
database. Meta dedupes on the same key if a retry slips through anyway.

`skipped` is a first-class status, not a failure: no connection configured,
clinic disabled the integration, or the patient opted out. The diagnostics panel
has to be able to say why an event never went.

Indexes: unique `(tenantId, eventId)`, plus a partial index on
`(status, createdAt)` where `status = 'pending'` for the sweeper.

### `meta_connections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenantId` | uuid fk tenants, unique | one dataset per clinic |
| `datasetId` | varchar(64) | the pixel / dataset id |
| `accessToken` | text | see the note below |
| `businessId` | varchar(64) | OAuth path only |
| `connectionType` | varchar(10) | `oauth` or `manual` |
| `tokenExpiresAt` | timestamptz | null for a system user token |
| `testEventCode` | varchar(32) | used by "Testar conexão" |
| `advancedMatchingEnabled` | boolean default true | |
| `status` | varchar(20) | `active`, `invalid_token`, `disabled` |
| `lastVerifiedAt` | timestamptz | |
| `lastErrorAt` | timestamptz | |
| `lastError` | text | |

**Token at rest.** `calendar_connections` stores Google access and refresh
tokens as plain `text` today. This table follows that existing pattern rather
than introducing a one-off encryption scheme for a single table. Encrypting
tokens at rest is worth doing, but as one change covering both tables, tracked
separately from this work.

### Column additions

- `patients.marketingOptOut boolean not null default false`
- `prospects.marketingOptOut boolean not null default false`

## Part 2: Capture

### Click-to-WhatsApp

Meta attaches a `referral` object to the first inbound message of an
ad-originated conversation, carrying `ctwa_clid`, `source_id` (the ad id),
`source_type`, `source_url` and `headline`.

In `src/app/api/webhooks/whatsapp/route.ts`, at the prospect upsert around line
195, parse `messages[0].referral`. When `isNewProspect` is true, insert the
`lead_attributions` row in the same transaction as the prospect. When the
prospect already exists and has no attribution row, still write it: the first ad
click is the first touch we ever observed, even if the lead row predates it.

An existing attribution row is never overwritten.

### Booking page

Two changes to the `/c/[slug]` flow.

`src/app/c/[slug]/page.tsx` renders the tenant's Meta Pixel when a
`meta_connections` row exists and is active. The client reads `fbclid` from the
query string and the `_fbp` cookie, and posts both with the booking.

`src/app/api/book/[slug]/route.ts` gains the missing half of the funnel: it
creates a prospect at stage `agendado`, links the appointment to it, and writes
the attribution row with `channel = 'booking_page'`. `fbc` is built from
`fbclid` in Meta's documented `fb.1.<unix_ts>.<fbclid>` form.

This closes gap 2 from the Problem section: online bookings become CRM leads.

### Manual and organic

No click id exists for either. The add-prospect modal replaces the current
defaulted `source` with an explicit select. Organic WhatsApp conversations get
`channel = 'organic'`.

Both still emit events, matched on hashed contact data alone. They will match
less often than a click id, and that is correct: the report must not credit a
campaign for a walk-in.

## Part 3: Event pipeline

New module `src/lib/meta/`, four files with one job each:

- **`hashing.ts`** normalizes and SHA-256s the matching fields. Phone goes
  through the existing `toWhatsAppPhone` from `src/lib/phone.ts` so the
  canonical form introduced in #35 is the one that gets hashed. Email is
  lowercased and trimmed. Names are lowercased with accents stripped.
- **`capi-client.ts`** is the only file in the codebase that talks to
  `graph.facebook.com`. One exported function, `postEvents(connection, events)`,
  returning a trace id or a typed error. Everything above it is testable without
  a network.
- **`events.ts`** exports `enqueueMetaEvent()`, the single entry point the rest
  of the app calls.
- **`attribution.ts`** reads and writes `lead_attributions` and owns the
  first-touch rule.

### Delivery

`enqueueMetaEvent()` is called right after the mutating write succeeds, in the
same fire-after-write position the existing `logProspectActivity` calls already
occupy. It inserts the outbox row, then attempts one immediate POST. Success marks the row `sent`. Any
failure leaves it `pending` with the error recorded. The function never throws
into the caller: a conversion must never break a stage change.

A fourth cron, `/api/cron/meta-events`, sweeps `pending` rows older than one
minute, batched per tenant (CAPI accepts up to 1000 events per request). It
follows `subscription-expiry` exactly: `Bearer CRON_SECRET`, wrapped in
`Sentry.withMonitor` with `cronMonitorConfig`, declared in `web/vercel.json`.

**Why not a transaction.** The spec originally called for writing the outbox row
inside the caller's transaction. That is not achievable: nothing in
`src/db/queries/prospects.ts` uses `withTransaction`, and `convertProspect` is
not even atomic across its own two writes. Retrofitting transactions across six
call sites to protect an analytics side effect is the wrong trade.

The deterministic `event_id` gives a better guarantee than a transaction would.
Because every id is derived from durable state (`prospectId`, `appointmentId`,
`financialEntryId`), the cron can *reconcile*: query for prospects past a stage
with no corresponding `sent` row and enqueue the missing event. A crash between
the stage write and the outbox insert self-heals on the next sweep, which a
transaction would only have prevented, never repaired.

Reconciliation runs in the same cron as the retry sweep, scoped to the last 7
days so it stays cheap.

Schedule: every 5 minutes. The inline send covers the happy path, so the cron
exists only for outages, and a 5 minute beat is gentler on a Meta incident than
a 1 minute one. Backoff is driven by `attempts`; a row reaching 8 attempts flips
to `failed` and stops consuming budget.

### Emission points

| Event | Fires when | `event_id` | Value |
|---|---|---|---|
| `Lead` | prospect created, any channel | `lead:<prospectId>` | none |
| `Contact` | stage moves to `contatado` | `contact:<prospectId>` | none |
| `Schedule` | stage moves to `agendado`, or an appointment is created for a prospect's patient | `schedule:<appointmentId>`, falling back to `schedule:<prospectId>` | none |
| `Purchase` | first installment of a financial entry is paid | `purchase:<financialEntryId>` | `totalAmount`, BRL |

**Purchase fires once per financial entry, at first payment, carrying the full
entry value rather than the installment amount.**

No "is this the first payment" check is written. Every payment that moves an
entry off `pending` calls `enqueueMetaEvent` with `purchase:<financialEntryId>`,
and the insert uses `ON CONFLICT (tenant_id, event_id) DO NOTHING`. The unique
index is the once-only guarantee, so a six-installment plan calls enqueue six
times and produces exactly one event. Deriving "first payment" in application
code would be a second source of truth that can disagree with the data.

`recordPayment` and `bulkPayInstallments` both already run inside
`withTransaction`, so for Purchase (unlike the prospect stage events) the outbox
insert genuinely can join the caller's transaction. It should. A clinic selling a R$ 3.000
protocol in 6x shows Meta one R$ 3.000 sale. Six R$ 500 sales would inflate
purchase count and teach the optimizer the wrong bid.

Revenue reaches the ad through `financialEntries.patientId` to
`prospects.convertedPatientId` to `lead_attributions`. That chain already
exists; nothing new is needed to join it.

**Schedule fires at most once per lead.** Dragging a card to `agendado` and
then booking the appointment are two paths to the same fact. Before emitting,
check for an existing `Schedule` row for the prospect and skip if one is there.
The hand-moved fallback id exists only so a stage move with no appointment can
still be recorded; it must not produce a second event when the appointment
arrives later.

### Verified API contract

Checked against Meta's documentation on 2026-08-28. Implementation must not
deviate from these without rechecking:

- The webhook `referral` object carries `source_url`, `source_id`, `source_type`,
  `headline`, `body`, `media_type`, `image_url`, `video_url`, `thumbnail_url`
  and `ctwa_clid`. It appears inside `messages[0]`, only on the first inbound
  message of an ad-originated conversation.
- **`ctwa_clid` is never hashed.** Meta's parameter reference lists it under
  customer information with an explicit "Do not hash". Hashing it silently
  destroys the attribution.
- CTWA events require **both** `action_source: 'business_messaging'` and
  `messaging_channel: 'whatsapp'`. Sending one without the other is the most
  common reason events land in Events Manager but attribute to nothing.

**The click id expires before the sale does.** `ctwa_clid` is reported to carry
a 7 day post-click attribution window, and events tied to it outside that window
are discarded. An aesthetic clinic routinely closes a lead weeks after first
contact, so a large share of Purchase events will fall outside it.

This is the strongest argument for the advanced matching decision, and it makes
one rule non-negotiable: **every event sends advanced matching, including events
that also carry a click id.** The click id is an optimization when it is fresh,
never the only identifier. A Purchase that relies on `ctwa_clid` alone is a
Purchase that will be silently dropped a month after the ad ran.

Note that this window is documented by integration vendors rather than stated on
Meta's own parameter page. The design does not depend on the exact number: it
sends both identifiers always, which is correct whatever the window turns out
to be.

### action_source

Meta is strict here, and getting it wrong is the most common reason events land
but never attribute:

- CTWA leads: `business_messaging` with `messaging_channel: 'whatsapp'`
- Booking page events: `website`
- Stage moves made by staff in the CRM: `system_generated`

## Part 4: Connection

### OAuth

Extend the existing Meta app (already in use for WhatsApp, `META_APP_SECRET`)
with Facebook Login for Business.

- `/api/integrations/meta/connect` starts the flow.
- `/api/integrations/meta/callback` exchanges the code for a long-lived system
  user token and lists the business's datasets for the clinic to choose from.

This requires App Review for `business_management` and `ads_management`, which
is the long pole on calendar time for this work.

### Manual paste

A settings card under Configurações where a clinic or its agency pastes a
Dataset ID and an access token. A "Testar conexão" button fires a real
`PageView` against the dataset using `test_event_code` and reports what Meta
said, rather than just checking that the field is non-empty.

The manual path is not a stopgap waiting to be deleted. It stays as the agency
path, and it is what makes the feature shippable while App Review is pending.

Connection health is stored on the row, so an expired token surfaces as a
warning in the UI instead of becoming silent data loss.

## Part 5: LGPD

Advanced matching means a hashed patient phone number travels alongside a
Purchase event for an aesthetic procedure. The clinic is the controller;
FloraClin is the processor. Five concrete obligations:

1. **Acknowledgement before activation.** A one-time text the clinic owner
   accepts before the connection goes active, stating that the clinic is the
   controller, that hashed contact data will be shared with Meta for ad
   measurement, and that the clinic is responsible for its patients' legal
   basis. Recorded in the existing `audit_logs` with user, timestamp and the
   version of the text accepted.
2. **Patient opt-out.** `marketingOptOut` on `patients` and `prospects`,
   surfaced as a checkbox on the patient record. When set, `enqueueMetaEvent`
   writes the row as `skipped` with the reason. The suppression is visible in
   the event log, which is the point: an audit needs evidence that the opt-out
   was honoured, not just an absence of rows.
3. **Privacy policy.** A section describing the sharing on
   `site/src/app/privacidade` and `site/src/app/lgpd`.
4. **Advanced matching toggle.** `advancedMatchingEnabled` on the connection,
   default on. A clinic that changes its mind drops to click-ids-only without
   disconnecting.
5. **Clinical data never leaves.** Events carry contact identifiers, an event
   name and a BRL amount. Never a procedure name, a diagnosis, a photo, or
   anything from the protected tables in `src/lib/compliance.ts`.

## Part 6: Reporting

### Kanban card

One muted line on the prospect card showing the campaign or ad headline that
produced the lead, plus the source badge. The card is already dense, so this is
a line, not a block.

### Marketing report

`/relatorios/marketing`, registered in `src/lib/reports/registry.ts` alongside
the six existing reports so it inherits date range, CSV export and column
plumbing.

Rows are ads (grouped by campaign where known). Columns: leads, contacted,
scheduled, converted, revenue, and the stage-to-stage conversion rates.

Date filtering goes through `startOfBrDay` and `endOfBrDay` per the project date
rules. "Leads em agosto" is a BR calendar window, and the report runs on UTC
hosts.

No ROAS: spend lives in the Marketing API, which needs OAuth shipped. Worth
revisiting immediately after App Review, since `ads_read` will already be
granted by then.

### Diagnostics

A panel on the integration settings card listing recent events with their
status and Meta's trace id. This is the screen support opens when an agency
claims their Purchases are missing.

## Part 7: Errors, observability, testing

Failures are typed, and only one category retries:

| Failure | Handling |
|---|---|
| Invalid or expired token | Flip connection `status`, warn in the UI, stop sending for that tenant |
| Rejected payload (4xx from Meta) | Mark `failed` immediately; retrying malformed data is pointless |
| Network error or 5xx | Leave `pending` for the sweeper |

Sentry gets a breadcrumb per send and an alert when a tenant's failure rate
crosses a threshold, following the error-reporting pattern from #37.

Tests use no network. `capi-client.ts` is the only file that fetches, so
everything above it runs against a fake. The cases that matter:

- `referral` parsing against real Meta webhook payload fixtures
- first-touch attribution surviving a second ad click
- `event_id` determinism blocking a double Purchase
- an installment plan producing exactly one Purchase at the full entry value
- opt-out producing a `skipped` row rather than no row
- BR date boundaries on the report

Vitest, matching the existing suite.

## Milestones

This is large. It grows in layers, each one shipping a product that works:

1. **CTWA capture, outbox, manual connection.** The smallest thing that is
   useful end to end: an ad click becomes an attributed lead, and Lead, Contact,
   Schedule and Purchase reach Meta. A clinic with an agency can use this on day
   one.
2. **Booking page.** Pixel, prospect creation on `/api/book/[slug]`, website
   attribution.
3. **Marketing report and card attribution.** The clinic sees the funnel.
4. **OAuth.** Removes the agency dependency once App Review clears.

Milestones 2, 3 and 4 each layer onto a working product. None of them requires
unwinding the previous one.
