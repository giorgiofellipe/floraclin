# Google Calendar Sync — Design Spec

## Goal

Two-way Google Calendar integration for FloraClin's agenda: push appointments to Google Calendar, pull external events to block availability, and expose an iCal feed for any calendar app.

## Architecture

Three independent subsystems sharing a common `calendar_connections` table:

1. **Push sync** — FloraClin → Google Calendar (per-practitioner + shared clinic calendar)
2. **Pull sync** — Google Calendar → FloraClin (blocked time slots via webhooks)
3. **iCal feed** — read-only `.ics` endpoint for universal calendar subscription

All sync is fire-and-forget: appointment CRUD never blocks on Google API calls.

## Data Model

### New columns on `appointments`

| Column | Type | Purpose |
|--------|------|---------|
| `googleEventId` | varchar(255) | Event ID on the practitioner's Google Calendar |
| `clinicGoogleEventId` | varchar(255) | Event ID on the shared clinic calendar |

### New table: `calendar_connections`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `tenantId` | uuid FK → tenants | Tenant isolation |
| `userId` | uuid FK → users (nullable) | Practitioner connection; null = clinic-level |
| `provider` | varchar(20) | Always `'google'` for now |
| `accessToken` | text | Google OAuth access token |
| `refreshToken` | text | Google OAuth refresh token |
| `tokenExpiresAt` | timestamptz | Access token expiry |
| `calendarId` | varchar(255) | Target Google Calendar (default `'primary'`) |
| `syncToken` | text | Google incremental sync token |
| `channelId` | varchar(255) | Push notification channel ID |
| `channelExpiry` | timestamptz | When the push channel expires |
| `feedToken` | varchar(64) | Random token for the iCal feed URL |
| `enabled` | boolean default true | Toggle sync without disconnecting |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

**Unique constraints (partial indexes):**
- `UNIQUE (tenant_id, user_id) WHERE user_id IS NOT NULL` — one connection per practitioner per tenant
- `UNIQUE (tenant_id) WHERE user_id IS NULL` — one clinic-level calendar per tenant

**Why not reuse the NextAuth `accounts` table?** NextAuth stores login tokens scoped to `openid email profile`. Calendar sync needs `calendar.events` scope — different consent, different tokens. Separate table, clean boundary.

### New table: `calendar_blocks`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `tenantId` | uuid FK → tenants | |
| `practitionerId` | uuid FK → users | Which practitioner is blocked |
| `connectionId` | uuid FK → calendar_connections | Source connection |
| `googleEventId` | varchar(255) | For dedup/updates |
| `date` | date | BR calendar day |
| `startTime` | time | |
| `endTime` | time | |
| `allDay` | boolean | All-day events block the full day |
| `status` | varchar(20) | `confirmed` / `tentative` / `cancelled` |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

**Index:** `(tenant_id, practitioner_id, date)` — same pattern as appointments.

## OAuth Flow

Separate from NextAuth login. Dedicated connect/callback routes.

1. User clicks "Conectar Google Calendar" in profile dialog (practitioner) or clinic settings (owner)
2. Frontend navigates to `GET /api/calendar/auth/connect?type=practitioner|clinic`
3. Server builds Google OAuth URL:
   - Scope: `https://www.googleapis.com/auth/calendar.events`
   - `access_type=offline` (refresh token)
   - `prompt=consent` (force consent screen)
   - `state` = signed JWT with `{ userId, tenantId, type }`
4. Google redirects to `GET /api/calendar/auth/callback`
5. Server exchanges auth code for tokens, creates/updates `calendar_connections` row, generates `feedToken`
6. Registers a push notification channel via `calendar.events.watch`
7. Runs initial sync (next 30 days of events → `calendar_blocks`)
8. Redirects back with success query param

**Token refresh:** `getGoogleCalendarClient(connectionId)` helper checks `tokenExpiresAt` before every API call. If expired, uses refresh token, updates row, returns ready client.

**Disconnect:** Delete `calendar_connections` row, stop the push channel (`calendar.channels.stop`), delete related `calendar_blocks`, clear `googleEventId`/`clinicGoogleEventId` from appointments. Optionally revoke the Google token.

Uses the same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars — no new Google project needed.

## Push Sync (FloraClin → Google)

### Trigger

Fire-and-forget async call after appointment mutations in the API routes:
- `POST /api/appointments` (create)
- `PATCH /api/appointments/[id]` (update date/time/practitioner/status)
- `PATCH /api/appointments/[id]/status` (status change)
- `DELETE /api/appointments/[id]` (soft delete)

### Logic: `syncAppointmentToGoogle(appointmentId)`

1. Load appointment with patient name and procedure type
2. For each target (practitioner calendar + clinic calendar):
   - **No existing event** (`googleEventId` is null): `calendar.events.insert` → store returned event ID
   - **Existing event**: `calendar.events.patch` → update
   - **Cancelled/deleted**: `calendar.events.delete` → clear event ID

### Google Calendar event format

```
Summary:    "Botox - Maria Silva" (procedure + patient)
            "Maria Silva" (patient only)
            "Agendamento" (walk-in, no patient)
Start/End:  appointment date + startTime/endTime, timezone America/Sao_Paulo
Description: "Agendamento FloraClin"
Status:     "confirmed" (status in confirmed/in_progress/completed)
            "tentative" (status = scheduled)
```

### Error handling

Log failures to console, don't retry. If Google is down, the event syncs on the next appointment update. No queue, no retry logic.

## Pull Sync (Google → FloraClin)

### Push notifications (near real-time)

1. On connect: `calendar.events.watch` registers a webhook → `POST /api/calendar/webhook`
2. Google POSTs a notification when events change (no event details, just "something changed on calendar X")
3. Webhook verifies the channel, calls `calendar.events.list` with stored `syncToken` (incremental sync)
4. Upsert/delete `calendar_blocks` rows based on the delta
5. Store new `syncToken` for next sync

### Channel renewal (Vercel Cron)

Google webhook channels expire after ~7 days. A Vercel Cron job runs daily:
- Query `calendar_connections` where `channelExpiry < now + 2 days` and `enabled = true`
- Call `calendar.events.watch` with new channel
- Update `channelId` and `channelExpiry`

Cron path: `GET /api/cron/calendar-renew` (secured via `CRON_SECRET` env var).

### Filtering rules

- **Include:** Events with `status = confirmed` or `tentative` that overlap practitioner's working hours
- **Exclude:** Events with `transparency = transparent` (marked "free"), declined events, cancelled events
- **All-day busy events:** `allDay = true` in `calendar_blocks`, block the full day
- **FloraClin-originated events** (matching `googleEventId` on an appointment): skip — don't create a block for our own events

### Initial sync

On first connect: `calendar.events.list` for the next 30 days (no `syncToken`), populate `calendar_blocks`, store the returned `syncToken`.

### Availability integration

`getAvailableSlots()` already excludes booked appointment times. Add one more exclusion: left join `calendar_blocks` for the same practitioner + date range, exclude those time windows. All-day blocks exclude all slots for that date.

## iCal Feed

### Endpoint

`GET /api/calendar/feed/{feedToken}.ics`

No auth headers — the `feedToken` in the URL is the secret (standard pattern for calendar subscriptions).

### Response

- Content-Type: `text/calendar; charset=utf-8`
- `Cache-Control: no-cache`
- Standard `VCALENDAR` with `VEVENT` entries
- Time window: past 7 days + next 60 days
- Excludes cancelled/deleted appointments
- Practitioner feed: their appointments only
- Clinic feed: all appointments for the tenant

### Event format

```
UID:        {appointment.id}@floraclin.com.br
SUMMARY:    Botox - Maria Silva
DTSTART:    20260528T140000 (America/Sao_Paulo)
DTEND:      20260528T150000 (America/Sao_Paulo)
DESCRIPTION: Agendamento FloraClin
STATUS:     CONFIRMED | TENTATIVE
```

Stable `UID` from appointment ID so calendar apps detect updates on re-poll.

## UI

### Profile Dialog ("Meu Perfil") — practitioner connection

New "Google Calendar" section below existing profile fields. Only shown for `practitioner` and `owner` roles.

**Disconnected:**
- "Conectar Google Calendar" button with Google icon
- Helper text: "Sincronize seus agendamentos com o Google Calendar."

**Connected:**
- Connected Google email + green "Conectado" badge
- Toggle "Sincronizar automaticamente" (maps to `enabled`)
- "Link do calendário (iCal)" with copy button
- "Desconectar" button with confirmation dialog

### Configurações → Agendamento — clinic calendar

New "Calendário da clínica" card in scheduling settings. Owner role only.

- Same connected/disconnected pattern
- Helper text: "Todos os agendamentos de todos os profissionais serão sincronizados para este calendário."
- Same toggle, feed link, disconnect controls

### Agenda View (Day/Week)

- `calendar_blocks` render as grey bars in the time grid
- Label: "Indisponível"
- Muted styling (grey background, dashed border), no click action
- Same visual width as appointment cards
- Shown alongside regular appointments

## API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/calendar/auth/connect` | GET | Start Google OAuth flow |
| `/api/calendar/auth/callback` | GET | Handle OAuth callback |
| `/api/calendar/connections` | GET | List connections for tenant/user |
| `/api/calendar/connections/[id]` | PATCH | Toggle enabled, update settings |
| `/api/calendar/connections/[id]` | DELETE | Disconnect and clean up |
| `/api/calendar/webhook` | POST | Google push notification receiver |
| `/api/calendar/feed/[token].ics` | GET | iCal feed endpoint |
| `/api/cron/calendar-renew` | GET | Renew expiring webhook channels |

## Dependencies

- `googleapis` npm package (Google Calendar API client)
- `ical-generator` npm package (iCal feed generation)
- Vercel Cron (channel renewal)
- Existing: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` env vars

## Security

- Calendar tokens stored server-side only, never exposed to client
- Feed tokens are 32-byte random hex — unguessable
- OAuth `state` param is a signed JWT to prevent CSRF
- Webhook endpoint validates `X-Goog-Channel-ID` and `X-Goog-Resource-ID` against stored values
- Disconnect revokes Google token to prevent stale access
- `CRON_SECRET` header required on the cron endpoint

## Out of Scope

- Choosing which Google Calendar to sync to (always `primary` for practitioners)
- Syncing appointment notes/details to Google (privacy — just title + time)
- Outlook / Apple Calendar push sync (iCal feed covers read-only)
- Recurring appointments (FloraClin doesn't have them)
- Conflict resolution for two-way sync (we only block slots, never create FloraClin appointments from Google events)
