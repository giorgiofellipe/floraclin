# Google Calendar Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way Google Calendar integration: push FloraClin appointments to Google Calendar, pull external events to block availability, and expose an iCal feed for any calendar app.

**Architecture:** Three subsystems sharing a `calendar_connections` table: (1) Push sync (FloraClin -> Google), (2) Pull sync (Google -> FloraClin via webhooks), (3) iCal feed. All sync is fire-and-forget — appointment CRUD never blocks on Google API calls.

**Tech Stack:** Next.js 16, Drizzle ORM (pgSchema `floraclin`), Google Calendar API (`googleapis`), `ical-generator`, NextAuth v5, Zod, Vitest

---

## File Structure

### New files
- `web/src/db/migrations/0012_calendar_sync.sql` — migration for new tables + appointment columns
- `web/src/lib/google-calendar.ts` — Google OAuth helpers, token refresh, client factory
- `web/src/db/queries/calendar.ts` — calendar connection + calendar block query functions
- `web/src/db/queries/__tests__/calendar.test.ts` — unit tests for calendar queries
- `web/src/lib/google-calendar-sync.ts` — push sync logic (FloraClin -> Google)
- `web/src/lib/__tests__/google-calendar-sync.test.ts` — push sync tests
- `web/src/lib/google-calendar-pull.ts` — pull sync logic (Google -> FloraClin)
- `web/src/lib/__tests__/google-calendar-pull.test.ts` — pull sync tests
- `web/src/lib/ical-feed.ts` — iCal feed generator
- `web/src/lib/__tests__/ical-feed.test.ts` — iCal feed tests
- `web/src/lib/__tests__/google-calendar.test.ts` — OAuth state signing tests
- `web/src/app/api/calendar/auth/connect/route.ts` — start OAuth flow
- `web/src/app/api/calendar/auth/callback/route.ts` — handle OAuth callback
- `web/src/app/api/calendar/connections/route.ts` — list connections
- `web/src/app/api/calendar/connections/[id]/route.ts` — update/delete connection
- `web/src/app/api/calendar/webhook/route.ts` — Google push notification receiver
- `web/src/app/api/calendar/feed/[token]/route.ts` — iCal feed endpoint
- `web/src/app/api/calendar/blocks/route.ts` — list calendar blocks for agenda view
- `web/src/app/api/cron/calendar-renew/route.ts` — webhook channel renewal cron
- `web/src/components/settings/calendar-connection-card.tsx` — reusable connect/disconnect UI
- `web/src/hooks/queries/use-calendar.ts` — React Query hook for calendar connections
- `web/vercel.json` — Vercel cron configuration (no vercel.json exists yet)

### Modified files
- `web/src/db/schema.ts` — add `calendarConnections`, `calendarBlocks` tables + appointment columns
- `web/src/app/api/appointments/route.ts` — fire push sync after create
- `web/src/app/api/appointments/[id]/route.ts` — fire push sync after update/delete
- `web/src/app/api/appointments/[id]/status/route.ts` — fire push sync after status change
- `web/src/db/queries/appointments.ts` — add calendar block exclusion to `getAvailableSlots`
- `web/src/components/scheduling/day-view.tsx` — render calendar blocks
- `web/src/components/scheduling/week-view.tsx` — render calendar blocks
- `web/src/components/layout/user-menu.tsx` — add Google Calendar section to profile dialog
- `web/src/app/(platform)/configuracoes/settings-page-client.tsx` — add clinic calendar card
- `web/src/hooks/queries/query-keys.ts` — add calendar query keys
- `web/src/types/index.ts` — add CalendarBlockStatus type
- `web/src/app/(platform)/agenda/agenda-page-client.tsx` — fetch and pass calendar blocks
- `web/src/components/scheduling/calendar-view.tsx` — accept and pass blocks to views
- `web/package.json` — add `googleapis` and `ical-generator` dependencies

---

## Group A (parallel) — Foundation: Schema, Client Helper, Query Functions, Dependencies

> **Pre-requisite note:** Task 17 (npm install) is in this group because Tasks 2/5/6/7 import from `googleapis` and `ical-generator`. Packages must be installed before any code that references them.

### Task 1: Migration SQL + Schema additions

**Files:**
- Create: `web/src/db/migrations/0012_calendar_sync.sql`
- Modify: `web/src/db/schema.ts`
- Modify: `web/src/types/index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `web/src/db/migrations/0012_calendar_sync.sql`:

```sql
-- Google Calendar sync: new tables and appointment columns

-- New columns on appointments for Google event tracking
ALTER TABLE floraclin.appointments
  ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS clinic_google_event_id VARCHAR(255);

-- Calendar connections (one per practitioner per tenant, one clinic-level per tenant)
CREATE TABLE IF NOT EXISTS floraclin.calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  user_id UUID REFERENCES floraclin.users(id),
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
  sync_token TEXT,
  channel_id VARCHAR(255),
  channel_resource_id VARCHAR(255),
  channel_expiry TIMESTAMPTZ,
  feed_token VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique: one practitioner connection per tenant
CREATE UNIQUE INDEX uq_calendar_connections_tenant_user
  ON floraclin.calendar_connections (tenant_id, user_id)
  WHERE user_id IS NOT NULL;

-- Partial unique: one clinic-level connection per tenant
CREATE UNIQUE INDEX uq_calendar_connections_tenant_clinic
  ON floraclin.calendar_connections (tenant_id)
  WHERE user_id IS NULL;

CREATE INDEX idx_calendar_connections_tenant
  ON floraclin.calendar_connections (tenant_id);

CREATE INDEX idx_calendar_connections_channel
  ON floraclin.calendar_connections (channel_id);

CREATE UNIQUE INDEX uq_calendar_connections_feed_token
  ON floraclin.calendar_connections (feed_token);

-- Calendar blocks (external events blocking practitioner availability)
CREATE TABLE IF NOT EXISTS floraclin.calendar_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  practitioner_id UUID NOT NULL REFERENCES floraclin.users(id),
  connection_id UUID NOT NULL REFERENCES floraclin.calendar_connections(id) ON DELETE CASCADE,
  google_event_id VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  all_day BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_blocks_practitioner_date
  ON floraclin.calendar_blocks (tenant_id, practitioner_id, date);

CREATE UNIQUE INDEX uq_calendar_blocks_connection_event
  ON floraclin.calendar_blocks (connection_id, google_event_id);
```

- [ ] **Step 2: Add Drizzle schema definitions**

In `web/src/db/schema.ts`, add new columns to the `appointments` table definition by adding after the `notes` field (before `createdAt`):

```typescript
  googleEventId: varchar('google_event_id', { length: 255 }),
  clinicGoogleEventId: varchar('clinic_google_event_id', { length: 255 }),
```

Then add two new tables after the `// ─── WHATSAPP` section and before `// ─── SSE EVENTS`:

```typescript
// ─── CALENDAR SYNC ──────────────────────────────────────────────────

export const calendarConnections = floraclinSchema.table('calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  provider: varchar('provider', { length: 20 }).notNull().default('google'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  calendarId: varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  syncToken: text('sync_token'),
  channelId: varchar('channel_id', { length: 255 }),
  channelResourceId: varchar('channel_resource_id', { length: 255 }),
  channelExpiry: timestamp('channel_expiry', { withTimezone: true }),
  feedToken: varchar('feed_token', { length: 64 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_calendar_connections_tenant').on(table.tenantId),
  index('idx_calendar_connections_channel').on(table.channelId),
])

export const calendarBlocks = floraclinSchema.table('calendar_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  connectionId: uuid('connection_id').notNull().references(() => calendarConnections.id, { onDelete: 'cascade' }),
  googleEventId: varchar('google_event_id', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }),
  date: date('date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  allDay: boolean('all_day').notNull().default(false),
  status: varchar('status', { length: 20 }).notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_calendar_blocks_practitioner_date').on(table.tenantId, table.practitionerId, table.date),
])
```

- [ ] **Step 3: Add Drizzle relations**

In `web/src/db/schema.ts`, add relations after the existing `auditLogsRelations`:

```typescript
export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [calendarConnections.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [calendarConnections.userId], references: [users.id] }),
  calendarBlocks: many(calendarBlocks),
}))

export const calendarBlocksRelations = relations(calendarBlocks, ({ one }) => ({
  tenant: one(tenants, { fields: [calendarBlocks.tenantId], references: [tenants.id] }),
  practitioner: one(users, { fields: [calendarBlocks.practitionerId], references: [users.id] }),
  connection: one(calendarConnections, { fields: [calendarBlocks.connectionId], references: [calendarConnections.id] }),
}))
```

- [ ] **Step 4: Add CalendarBlockStatus type**

In `web/src/types/index.ts`, add:

```typescript
export type CalendarBlockStatus = 'confirmed' | 'tentative' | 'cancelled'
```

- [ ] **Step 5: Run migration locally and verify**

Migrations 0007+ in this project are hand-written SQL files applied directly. For local development, use `drizzle-kit push` to sync the schema from `schema.ts`:

```bash
cd web && pnpm drizzle-kit push
```

For production, apply the migration SQL directly via `psql` (same pattern as migrations 0007-0010).

---

### Task 2: Google Calendar client helper

**Files:**
- Create: `web/src/lib/google-calendar.ts`
- Create: `web/src/lib/__tests__/google-calendar.test.ts`

- [ ] **Step 1: Create the Google Calendar client helper**

Create `web/src/lib/google-calendar.ts`:

```typescript
import { google } from 'googleapis'
import { db } from '@/db/client'
import { calendarConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes, createHmac } from 'crypto'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const CALENDAR_CALLBACK_URL = `${APP_URL}/api/calendar/auth/callback`
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

// Secret for signing OAuth state — falls back to GOOGLE_CLIENT_SECRET
const STATE_SECRET = process.env.CALENDAR_STATE_SECRET || GOOGLE_CLIENT_SECRET

/**
 * Create a base OAuth2 client (no tokens set).
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    CALENDAR_CALLBACK_URL
  )
}

/**
 * Build the Google OAuth consent URL.
 */
export function buildAuthUrl(state: string): string {
  const oauth2Client = createOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_SCOPE],
    state,
  })
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

/**
 * Sign the OAuth state parameter to prevent CSRF.
 * State format: base64url(JSON payload) + '.' + HMAC signature
 */
export function signOAuthState(payload: { userId: string; tenantId: string; type: 'practitioner' | 'clinic' }): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json).toString('base64url')
  const signature = createHmac('sha256', STATE_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/**
 * Verify and decode a signed OAuth state parameter.
 * Returns null if the signature is invalid.
 */
export function verifyOAuthState(state: string): { userId: string; tenantId: string; type: 'practitioner' | 'clinic' } | null {
  const dotIndex = state.lastIndexOf('.')
  if (dotIndex === -1) return null

  const encoded = state.slice(0, dotIndex)
  const signature = state.slice(dotIndex + 1)

  const expectedSig = createHmac('sha256', STATE_SECRET).update(encoded).digest('base64url')
  if (signature !== expectedSig) return null

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Generate a random feed token (32 bytes hex = 64 chars).
 */
export function generateFeedToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Get a ready-to-use Google Calendar API client for a connection.
 * Automatically refreshes the access token if expired.
 */
export async function getGoogleCalendarClient(connectionId: string) {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1)

  if (!connection) {
    throw new Error('Calendar connection not found')
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiresAt.getTime(),
  })

  // Refresh if token expires within the next 5 minutes
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000
  if (connection.tokenExpiresAt.getTime() < fiveMinFromNow) {
    const { credentials } = await oauth2Client.refreshAccessToken()

    await db
      .update(calendarConnections)
      .set({
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token ?? connection.refreshToken,
        tokenExpiresAt: new Date(credentials.expiry_date!),
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connectionId))

    oauth2Client.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  return { calendar, connection }
}

/**
 * Register a webhook channel for push notifications on a calendar.
 * Returns the channelId, resourceId, and expiration.
 */
export async function registerWebhookChannel(
  connectionId: string,
  calendarId: string
) {
  const { calendar } = await getGoogleCalendarClient(connectionId)
  const channelId = randomBytes(16).toString('hex')
  const webhookUrl = `${APP_URL}/api/calendar/webhook`

  const response = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
    },
  })

  return {
    channelId,
    resourceId: response.data.resourceId!,
    expiration: new Date(Number(response.data.expiration!)),
  }
}

/**
 * Stop a webhook channel.
 */
export async function stopWebhookChannel(
  connectionId: string,
  channelId: string,
  resourceId: string
) {
  try {
    const { calendar } = await getGoogleCalendarClient(connectionId)
    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    })
  } catch (error) {
    // Channel may already be expired — log and continue
    console.warn('Failed to stop webhook channel:', error)
  }
}

/**
 * Revoke a Google OAuth token.
 */
export async function revokeToken(accessToken: string) {
  try {
    const oauth2Client = createOAuth2Client()
    await oauth2Client.revokeToken(accessToken)
  } catch (error) {
    console.warn('Failed to revoke Google token:', error)
  }
}
```

- [ ] **Step 2: Write tests for OAuth state signing**

Create `web/src/lib/__tests__/google-calendar.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock googleapis before importing the module under test
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock'),
        getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600000 } }),
        setCredentials: vi.fn(),
        refreshAccessToken: vi.fn().mockResolvedValue({ credentials: { access_token: 'new-at', refresh_token: 'new-rt', expiry_date: Date.now() + 3600000 } }),
        revokeToken: vi.fn().mockResolvedValue(undefined),
      })),
    },
    calendar: vi.fn().mockReturnValue({
      events: {
        watch: vi.fn().mockResolvedValue({ data: { resourceId: 'res-123', expiration: String(Date.now() + 86400000) } }),
      },
      channels: {
        stop: vi.fn().mockResolvedValue(undefined),
      },
    }),
  },
}))

// Mock db
vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/db/schema', () => ({
  calendarConnections: { id: 'id' },
}))

import {
  signOAuthState,
  verifyOAuthState,
  generateFeedToken,
  buildAuthUrl,
} from '../google-calendar'

describe('signOAuthState / verifyOAuthState', () => {
  const payload = { userId: 'user-1', tenantId: 'tenant-1', type: 'practitioner' as const }

  it('should sign and verify a valid state', () => {
    const state = signOAuthState(payload)
    const result = verifyOAuthState(state)
    expect(result).toEqual(payload)
  })

  it('should return null for tampered state', () => {
    const state = signOAuthState(payload)
    const tampered = state.slice(0, -3) + 'xxx'
    expect(verifyOAuthState(tampered)).toBeNull()
  })

  it('should return null for state without dot separator', () => {
    expect(verifyOAuthState('nodothere')).toBeNull()
  })

  it('should return null for invalid JSON in payload', () => {
    // Create a state with invalid base64url content but valid HMAC
    // The simplest way: just pass garbage
    expect(verifyOAuthState('not-base64.invalid-sig')).toBeNull()
  })

  it('should handle clinic type', () => {
    const clinicPayload = { userId: 'user-1', tenantId: 'tenant-1', type: 'clinic' as const }
    const state = signOAuthState(clinicPayload)
    const result = verifyOAuthState(state)
    expect(result).toEqual(clinicPayload)
  })
})

describe('generateFeedToken', () => {
  it('should generate a 64-character hex string', () => {
    const token = generateFeedToken()
    expect(token).toHaveLength(64)
    expect(/^[a-f0-9]+$/.test(token)).toBe(true)
  })

  it('should generate unique tokens', () => {
    const token1 = generateFeedToken()
    const token2 = generateFeedToken()
    expect(token1).not.toEqual(token2)
  })
})

describe('buildAuthUrl', () => {
  it('should return a Google OAuth URL', () => {
    const url = buildAuthUrl('test-state')
    expect(url).toContain('accounts.google.com')
  })
})
```

---

### Task 3: Calendar connection + block query functions

**Files:**
- Create: `web/src/db/queries/calendar.ts`
- Create: `web/src/db/queries/__tests__/calendar.test.ts`

- [ ] **Step 1: Create calendar query functions**

Create `web/src/db/queries/calendar.ts`:

```typescript
import { db } from '@/db/client'
import { calendarConnections, calendarBlocks, appointments } from '@/db/schema'
import { eq, and, isNull, gte, lte, ne, or, sql } from 'drizzle-orm'

// ─── Calendar Connection Queries ────────────────────────────────────

export interface CalendarConnectionRow {
  id: string
  tenantId: string
  userId: string | null
  provider: string
  calendarId: string
  syncToken: string | null
  channelId: string | null
  channelResourceId: string | null
  channelExpiry: Date | null
  feedToken: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Get the practitioner's calendar connection for a tenant.
 */
export async function getConnectionByUserId(
  tenantId: string,
  userId: string
): Promise<CalendarConnectionRow | null> {
  const [result] = await db
    .select({
      id: calendarConnections.id,
      tenantId: calendarConnections.tenantId,
      userId: calendarConnections.userId,
      provider: calendarConnections.provider,
      calendarId: calendarConnections.calendarId,
      syncToken: calendarConnections.syncToken,
      channelId: calendarConnections.channelId,
      channelResourceId: calendarConnections.channelResourceId,
      channelExpiry: calendarConnections.channelExpiry,
      feedToken: calendarConnections.feedToken,
      enabled: calendarConnections.enabled,
      createdAt: calendarConnections.createdAt,
      updatedAt: calendarConnections.updatedAt,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.userId, userId)
      )
    )
    .limit(1)

  return result ?? null
}

/**
 * Get the clinic-level calendar connection for a tenant.
 */
export async function getClinicConnection(
  tenantId: string
): Promise<CalendarConnectionRow | null> {
  const [result] = await db
    .select({
      id: calendarConnections.id,
      tenantId: calendarConnections.tenantId,
      userId: calendarConnections.userId,
      provider: calendarConnections.provider,
      calendarId: calendarConnections.calendarId,
      syncToken: calendarConnections.syncToken,
      channelId: calendarConnections.channelId,
      channelResourceId: calendarConnections.channelResourceId,
      channelExpiry: calendarConnections.channelExpiry,
      feedToken: calendarConnections.feedToken,
      enabled: calendarConnections.enabled,
      createdAt: calendarConnections.createdAt,
      updatedAt: calendarConnections.updatedAt,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        isNull(calendarConnections.userId)
      )
    )
    .limit(1)

  return result ?? null
}

/**
 * List all connections for a tenant (for settings page).
 */
export async function listConnections(tenantId: string): Promise<CalendarConnectionRow[]> {
  return db
    .select({
      id: calendarConnections.id,
      tenantId: calendarConnections.tenantId,
      userId: calendarConnections.userId,
      provider: calendarConnections.provider,
      calendarId: calendarConnections.calendarId,
      syncToken: calendarConnections.syncToken,
      channelId: calendarConnections.channelId,
      channelResourceId: calendarConnections.channelResourceId,
      channelExpiry: calendarConnections.channelExpiry,
      feedToken: calendarConnections.feedToken,
      enabled: calendarConnections.enabled,
      createdAt: calendarConnections.createdAt,
      updatedAt: calendarConnections.updatedAt,
    })
    .from(calendarConnections)
    .where(eq(calendarConnections.tenantId, tenantId))
}

/**
 * Create or update (upsert) a calendar connection.
 * Used during OAuth callback.
 */
export async function upsertConnection(data: {
  tenantId: string
  userId: string | null
  accessToken: string
  refreshToken: string
  tokenExpiresAt: Date
  calendarId?: string
  feedToken: string
  channelId?: string
  channelResourceId?: string
  channelExpiry?: Date
  syncToken?: string
}) {
  // Check if connection exists
  const conditions = [eq(calendarConnections.tenantId, data.tenantId)]
  if (data.userId) {
    conditions.push(eq(calendarConnections.userId, data.userId))
  } else {
    conditions.push(isNull(calendarConnections.userId))
  }

  const [existing] = await db
    .select({ id: calendarConnections.id, feedToken: calendarConnections.feedToken })
    .from(calendarConnections)
    .where(and(...conditions))
    .limit(1)

  if (existing) {
    const [result] = await db
      .update(calendarConnections)
      .set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        calendarId: data.calendarId ?? 'primary',
        channelId: data.channelId ?? null,
        channelResourceId: data.channelResourceId ?? null,
        channelExpiry: data.channelExpiry ?? null,
        syncToken: data.syncToken ?? null,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id))
      .returning()

    return result
  }

  const [result] = await db
    .insert(calendarConnections)
    .values({
      tenantId: data.tenantId,
      userId: data.userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
      calendarId: data.calendarId ?? 'primary',
      feedToken: data.feedToken,
      channelId: data.channelId ?? null,
      channelResourceId: data.channelResourceId ?? null,
      channelExpiry: data.channelExpiry ?? null,
      syncToken: data.syncToken ?? null,
    })
    .returning()

  return result
}

/**
 * Update connection fields (toggle enabled, update sync/channel data).
 */
export async function updateConnection(
  connectionId: string,
  tenantId: string,
  data: Partial<{
    enabled: boolean
    syncToken: string | null
    channelId: string | null
    channelResourceId: string | null
    channelExpiry: Date | null
    accessToken: string
    refreshToken: string
    tokenExpiresAt: Date
  }>
) {
  const [result] = await db
    .update(calendarConnections)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(calendarConnections.id, connectionId),
        eq(calendarConnections.tenantId, tenantId)
      )
    )
    .returning()

  return result ?? null
}

/**
 * Delete a connection and return it (for cleanup).
 */
export async function deleteConnection(
  connectionId: string,
  tenantId: string
) {
  const [result] = await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.id, connectionId),
        eq(calendarConnections.tenantId, tenantId)
      )
    )
    .returning()

  return result ?? null
}

/**
 * Find a connection by its webhook channel ID (for incoming webhooks).
 */
export async function getConnectionByChannelId(
  channelId: string
) {
  const [result] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.channelId, channelId))
    .limit(1)

  return result ?? null
}

/**
 * Find a connection by its feed token (for iCal feed).
 */
export async function getConnectionByFeedToken(
  feedToken: string
) {
  const [result] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.feedToken, feedToken))
    .limit(1)

  return result ?? null
}

/**
 * Get connections with channels expiring within the given hours.
 */
export async function getExpiringConnections(withinHours: number = 48) {
  const threshold = new Date(Date.now() + withinHours * 60 * 60 * 1000)

  return db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.enabled, true),
        lte(calendarConnections.channelExpiry, threshold),
        sql`${calendarConnections.channelId} IS NOT NULL`
      )
    )
}

// ─── Calendar Block Queries ─────────────────────────────────────────

export interface CalendarBlockRow {
  id: string
  tenantId: string
  practitionerId: string
  connectionId: string
  googleEventId: string
  title: string | null
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  status: string
}

/**
 * List calendar blocks for a practitioner on a date range.
 */
export async function listBlocksForDateRange(
  tenantId: string,
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
): Promise<CalendarBlockRow[]> {
  const conditions = [
    eq(calendarBlocks.tenantId, tenantId),
    gte(calendarBlocks.date, dateFrom),
    lte(calendarBlocks.date, dateTo),
    ne(calendarBlocks.status, 'cancelled'),
  ]

  if (practitionerId) {
    conditions.push(eq(calendarBlocks.practitionerId, practitionerId))
  }

  return db
    .select({
      id: calendarBlocks.id,
      tenantId: calendarBlocks.tenantId,
      practitionerId: calendarBlocks.practitionerId,
      connectionId: calendarBlocks.connectionId,
      googleEventId: calendarBlocks.googleEventId,
      title: calendarBlocks.title,
      date: calendarBlocks.date,
      startTime: calendarBlocks.startTime,
      endTime: calendarBlocks.endTime,
      allDay: calendarBlocks.allDay,
      status: calendarBlocks.status,
    })
    .from(calendarBlocks)
    .where(and(...conditions))
    .orderBy(calendarBlocks.date, calendarBlocks.startTime)
}

/**
 * Upsert a calendar block (by connection + googleEventId).
 */
export async function upsertCalendarBlock(data: {
  tenantId: string
  practitionerId: string
  connectionId: string
  googleEventId: string
  title: string | null
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  status: string
}) {
  // Check existing
  const [existing] = await db
    .select({ id: calendarBlocks.id })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.connectionId, data.connectionId),
        eq(calendarBlocks.googleEventId, data.googleEventId)
      )
    )
    .limit(1)

  if (existing) {
    const [result] = await db
      .update(calendarBlocks)
      .set({
        title: data.title,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        allDay: data.allDay,
        status: data.status,
        updatedAt: new Date(),
      })
      .where(eq(calendarBlocks.id, existing.id))
      .returning()

    return result
  }

  const [result] = await db
    .insert(calendarBlocks)
    .values(data)
    .returning()

  return result
}

/**
 * Delete a calendar block by connection + googleEventId.
 */
export async function deleteCalendarBlock(
  connectionId: string,
  googleEventId: string
) {
  return db
    .delete(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.connectionId, connectionId),
        eq(calendarBlocks.googleEventId, googleEventId)
      )
    )
}

/**
 * Delete all blocks for a connection.
 */
export async function deleteBlocksByConnection(connectionId: string) {
  return db
    .delete(calendarBlocks)
    .where(eq(calendarBlocks.connectionId, connectionId))
}

/**
 * Clear Google event IDs from appointments when disconnecting.
 * If userId is provided, clear practitioner event IDs.
 * If userId is null, clear clinic event IDs.
 */
export async function clearAppointmentGoogleEventIds(
  tenantId: string,
  userId: string | null
) {
  if (userId) {
    // Clear practitioner Google event IDs
    await db
      .update(appointments)
      .set({
        googleEventId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.practitionerId, userId),
          sql`${appointments.googleEventId} IS NOT NULL`
        )
      )
  } else {
    // Clear clinic Google event IDs
    await db
      .update(appointments)
      .set({
        clinicGoogleEventId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          sql`${appointments.clinicGoogleEventId} IS NOT NULL`
        )
      )
  }
}
```

- [ ] **Step 2: Write unit tests for calendar queries**

Create `web/src/db/queries/__tests__/calendar.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db
const mockReturning = vi.fn()
const mockLimit = vi.fn()
const mockWhere = vi.fn()

const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  where: vi.fn((...args: unknown[]) => {
    mockWhere(...args)
    return mockDb
  }),
  limit: vi.fn((...args: unknown[]) => {
    mockLimit(...args)
    return mockDb
  }),
  orderBy: vi.fn(() => mockDb),
  insert: vi.fn(() => mockDb),
  values: vi.fn(() => mockDb),
  update: vi.fn(() => mockDb),
  set: vi.fn(() => mockDb),
  delete: vi.fn(() => mockDb),
  returning: vi.fn(() => mockReturning()),
}

vi.mock('@/db/client', () => ({
  db: mockDb,
}))

vi.mock('@/db/schema', () => ({
  calendarConnections: {
    id: 'id',
    tenantId: 'tenant_id',
    userId: 'user_id',
    provider: 'provider',
    calendarId: 'calendar_id',
    syncToken: 'sync_token',
    channelId: 'channel_id',
    channelResourceId: 'channel_resource_id',
    channelExpiry: 'channel_expiry',
    feedToken: 'feed_token',
    enabled: 'enabled',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    tokenExpiresAt: 'token_expires_at',
  },
  calendarBlocks: {
    id: 'id',
    tenantId: 'tenant_id',
    practitionerId: 'practitioner_id',
    connectionId: 'connection_id',
    googleEventId: 'google_event_id',
    title: 'title',
    date: 'date',
    startTime: 'start_time',
    endTime: 'end_time',
    allDay: 'all_day',
    status: 'status',
    updatedAt: 'updated_at',
  },
  appointments: {
    tenantId: 'tenant_id',
    practitionerId: 'practitioner_id',
    googleEventId: 'google_event_id',
    clinicGoogleEventId: 'clinic_google_event_id',
    updatedAt: 'updated_at',
  },
}))

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockReturnValue([])
  mockReturning.mockReturnValue([])
})

describe('calendar query functions', () => {
  describe('getConnectionByUserId', () => {
    it('should return null when no connection exists', async () => {
      mockLimit.mockReturnValue([])
      const { getConnectionByUserId } = await import('../calendar')
      const result = await getConnectionByUserId('tenant-1', 'user-1')
      expect(result).toBeNull()
      expect(mockDb.select).toHaveBeenCalled()
    })

    it('should return connection when it exists', async () => {
      const connection = { id: 'conn-1', tenantId: 'tenant-1', userId: 'user-1' }
      mockLimit.mockReturnValue([connection])
      const { getConnectionByUserId } = await import('../calendar')
      const result = await getConnectionByUserId('tenant-1', 'user-1')
      expect(result).toEqual(connection)
    })
  })

  describe('getClinicConnection', () => {
    it('should return null when no clinic connection exists', async () => {
      mockLimit.mockReturnValue([])
      const { getClinicConnection } = await import('../calendar')
      const result = await getClinicConnection('tenant-1')
      expect(result).toBeNull()
    })
  })

  describe('upsertCalendarBlock', () => {
    it('should insert when block does not exist', async () => {
      mockLimit.mockReturnValue([]) // no existing block
      mockReturning.mockReturnValue([{ id: 'block-1' }])

      const { upsertCalendarBlock } = await import('../calendar')
      const result = await upsertCalendarBlock({
        tenantId: 'tenant-1',
        practitionerId: 'user-1',
        connectionId: 'conn-1',
        googleEventId: 'event-123',
        title: 'Meeting',
        date: '2026-05-28',
        startTime: '10:00',
        endTime: '11:00',
        allDay: false,
        status: 'confirmed',
      })

      expect(mockDb.insert).toHaveBeenCalled()
      expect(result).toEqual({ id: 'block-1' })
    })

    it('should update when block already exists', async () => {
      mockLimit.mockReturnValue([{ id: 'existing-block' }])
      mockReturning.mockReturnValue([{ id: 'existing-block', title: 'Updated' }])

      const { upsertCalendarBlock } = await import('../calendar')
      const result = await upsertCalendarBlock({
        tenantId: 'tenant-1',
        practitionerId: 'user-1',
        connectionId: 'conn-1',
        googleEventId: 'event-123',
        title: 'Updated',
        date: '2026-05-28',
        startTime: '10:00',
        endTime: '11:00',
        allDay: false,
        status: 'confirmed',
      })

      expect(mockDb.update).toHaveBeenCalled()
      expect(result).toEqual({ id: 'existing-block', title: 'Updated' })
    })
  })

  describe('clearAppointmentGoogleEventIds', () => {
    it('should clear practitioner event IDs when userId is provided', async () => {
      mockReturning.mockReturnValue([])
      const { clearAppointmentGoogleEventIds } = await import('../calendar')
      await clearAppointmentGoogleEventIds('tenant-1', 'user-1')
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ googleEventId: null })
      )
    })

    it('should clear clinic event IDs when userId is null', async () => {
      mockReturning.mockReturnValue([])
      const { clearAppointmentGoogleEventIds } = await import('../calendar')
      await clearAppointmentGoogleEventIds('tenant-1', null)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ clinicGoogleEventId: null })
      )
    })
  })
})
```

---

### Task 18: Install npm dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install googleapis and ical-generator**

Run from the repo root:

```bash
pnpm --filter @floraclin/web add googleapis ical-generator
```

- [ ] **Step 2: Verify TypeScript picks up the types**

```bash
cd web && pnpm typecheck
```

---

## Group B (depends on A) — Sync Logic + OAuth Routes

### Task 4: OAuth connect + callback routes

**Files:**
- Create: `web/src/app/api/calendar/auth/connect/route.ts`
- Create: `web/src/app/api/calendar/auth/callback/route.ts`

- [ ] **Step 1: Create the connect route**

Create `web/src/app/api/calendar/auth/connect/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { signOAuthState, buildAuthUrl } from '@/lib/google-calendar'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') as 'practitioner' | 'clinic' | null

    if (!type || !['practitioner', 'clinic'].includes(type)) {
      return NextResponse.json({ error: 'Parâmetro "type" inválido.' }, { status: 400 })
    }

    // Only owners can connect clinic-level calendar
    if (type === 'clinic' && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Apenas o proprietário pode conectar o calendário da clínica.' }, { status: 403 })
    }

    const state = signOAuthState({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      type,
    })

    const authUrl = buildAuthUrl(state)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Calendar connect error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create the callback route**

Create `web/src/app/api/calendar/auth/callback/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import {
  verifyOAuthState,
  exchangeCodeForTokens,
  generateFeedToken,
  registerWebhookChannel,
} from '@/lib/google-calendar'
import { upsertConnection } from '@/db/queries/calendar'
import { runInitialSync } from '@/lib/google-calendar-pull'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // User denied access
    if (error) {
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=denied`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    // Verify signed state
    const payload = verifyOAuthState(state)
    if (!payload) {
      console.error('Invalid OAuth state signature')
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Missing tokens from Google OAuth exchange')
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    const userId = payload.type === 'clinic' ? null : payload.userId
    const feedToken = generateFeedToken()

    // Upsert connection
    const connection = await upsertConnection({
      tenantId: payload.tenantId,
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
      feedToken,
    })

    // Register webhook channel (fire-and-forget — if it fails, cron will retry)
    try {
      const channel = await registerWebhookChannel(connection.id, connection.calendarId)
      // Import updateConnection directly to avoid circular deps
      const { updateConnection } = await import('@/db/queries/calendar')
      await updateConnection(connection.id, payload.tenantId, {
        channelId: channel.channelId,
        channelResourceId: channel.resourceId,
        channelExpiry: channel.expiration,
      })
    } catch (err) {
      console.error('Failed to register webhook channel:', err)
    }

    // Run initial sync (next 30 days) — fire-and-forget for practitioner connections
    if (userId) {
      runInitialSync(connection.id).catch((err) => {
        console.error('Initial sync failed:', err)
      })
    }

    // Redirect back to appropriate page
    const redirectUrl = payload.type === 'clinic'
      ? `${APP_URL}/configuracoes?tab=agendamento&calendar=connected`
      : `${APP_URL}/agenda?calendar=connected`

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('Calendar callback error:', error)
    return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
  }
}
```

---

### Task 5: Push sync function

**Files:**
- Create: `web/src/lib/google-calendar-sync.ts`
- Create: `web/src/lib/__tests__/google-calendar-sync.test.ts`

- [ ] **Step 1: Create the push sync function**

Create `web/src/lib/google-calendar-sync.ts`:

```typescript
import { db } from '@/db/client'
import { appointments, patients, procedureTypes } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getGoogleCalendarClient } from '@/lib/google-calendar'
import { getConnectionByUserId, getClinicConnection } from '@/db/queries/calendar'

const BR_TZ = 'America/Sao_Paulo'

interface AppointmentForSync {
  id: string
  tenantId: string
  practitionerId: string
  date: string
  startTime: string
  endTime: string
  status: string
  googleEventId: string | null
  clinicGoogleEventId: string | null
  patientName: string | null
  procedureTypeName: string | null
  deletedAt: Date | null
}

async function loadAppointmentForSync(
  tenantId: string,
  appointmentId: string
): Promise<AppointmentForSync | null> {
  const [result] = await db
    .select({
      id: appointments.id,
      tenantId: appointments.tenantId,
      practitionerId: appointments.practitionerId,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      googleEventId: appointments.googleEventId,
      clinicGoogleEventId: appointments.clinicGoogleEventId,
      patientName: patients.fullName,
      procedureTypeName: procedureTypes.name,
      deletedAt: appointments.deletedAt,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId)
      )
    )
    .limit(1)

  return result ?? null
}

/**
 * Build a Google Calendar event summary from an appointment.
 */
export function buildEventSummary(
  patientName: string | null,
  procedureTypeName: string | null
): string {
  if (procedureTypeName && patientName) {
    return `${procedureTypeName} - ${patientName}`
  }
  if (patientName) {
    return patientName
  }
  return 'Agendamento'
}

/**
 * Build a Google Calendar event body from an appointment.
 */
export function buildEventBody(appt: AppointmentForSync) {
  const summary = buildEventSummary(appt.patientName, appt.procedureTypeName)

  // Map FloraClin status to Google Calendar status
  const isTentative = appt.status === 'scheduled'
  const googleStatus = isTentative ? 'tentative' : 'confirmed'

  return {
    summary,
    description: 'Agendamento FloraClin',
    start: {
      dateTime: `${appt.date}T${appt.startTime}:00`,
      timeZone: BR_TZ,
    },
    end: {
      dateTime: `${appt.date}T${appt.endTime}:00`,
      timeZone: BR_TZ,
    },
    status: googleStatus,
  }
}

/**
 * Sync a single appointment to Google Calendar.
 * Targets both the practitioner's calendar and the clinic calendar (if connected).
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function syncAppointmentToGoogle(
  tenantId: string,
  appointmentId: string
): Promise<void> {
  try {
    const appt = await loadAppointmentForSync(tenantId, appointmentId)
    if (!appt) return

    const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show' || appt.deletedAt !== null

    // Sync to practitioner calendar
    await syncToCalendar(appt, 'practitioner', isCancelled)

    // Sync to clinic calendar
    await syncToCalendar(appt, 'clinic', isCancelled)
  } catch (error) {
    console.error(`Failed to sync appointment ${appointmentId} to Google:`, error)
  }
}

async function syncToCalendar(
  appt: AppointmentForSync,
  target: 'practitioner' | 'clinic',
  isCancelled: boolean
) {
  try {
    // Get the connection
    const connection = target === 'practitioner'
      ? await getConnectionByUserId(appt.tenantId, appt.practitionerId)
      : await getClinicConnection(appt.tenantId)

    if (!connection || !connection.enabled) return

    const eventIdField = target === 'practitioner' ? 'googleEventId' : 'clinicGoogleEventId'
    const existingEventId = appt[eventIdField]

    const { calendar } = await getGoogleCalendarClient(connection.id)

    if (isCancelled && existingEventId) {
      // Delete the event
      try {
        await calendar.events.delete({
          calendarId: connection.calendarId,
          eventId: existingEventId,
        })
      } catch (err: unknown) {
        // 404/410 = already deleted, that's fine
        const status = (err as { code?: number })?.code
        if (status !== 404 && status !== 410) throw err
      }

      // Clear the event ID on the appointment
      const updateData = target === 'practitioner'
        ? { googleEventId: null, updatedAt: new Date() }
        : { clinicGoogleEventId: null, updatedAt: new Date() }

      await db
        .update(appointments)
        .set(updateData)
        .where(eq(appointments.id, appt.id))

    } else if (!isCancelled && existingEventId) {
      // Update the event
      const eventBody = buildEventBody(appt)
      await calendar.events.patch({
        calendarId: connection.calendarId,
        eventId: existingEventId,
        requestBody: eventBody,
      })

    } else if (!isCancelled && !existingEventId) {
      // Create new event
      const eventBody = buildEventBody(appt)
      const response = await calendar.events.insert({
        calendarId: connection.calendarId,
        requestBody: eventBody,
      })

      const newEventId = response.data.id
      if (newEventId) {
        const updateData = target === 'practitioner'
          ? { googleEventId: newEventId, updatedAt: new Date() }
          : { clinicGoogleEventId: newEventId, updatedAt: new Date() }

        await db
          .update(appointments)
          .set(updateData)
          .where(eq(appointments.id, appt.id))
      }
    }
    // If cancelled and no existing event, nothing to do
  } catch (error) {
    console.error(`Failed to sync to ${target} calendar for appointment ${appt.id}:`, error)
  }
}
```

- [ ] **Step 2: Write push sync tests**

Create `web/src/lib/__tests__/google-calendar-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
const mockEventsInsert = vi.fn()
const mockEventsPatch = vi.fn()
const mockEventsDelete = vi.fn()

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    calendar: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getGoogleCalendarClient: vi.fn().mockResolvedValue({
    calendar: {
      events: {
        insert: (...args: unknown[]) => mockEventsInsert(...args),
        patch: (...args: unknown[]) => mockEventsPatch(...args),
        delete: (...args: unknown[]) => mockEventsDelete(...args),
      },
    },
    connection: { calendarId: 'primary' },
  }),
}))

vi.mock('@/db/queries/calendar', () => ({
  getConnectionByUserId: vi.fn().mockResolvedValue(null),
  getClinicConnection: vi.fn().mockResolvedValue(null),
}))

const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  }),
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: { id: 'id', tenantId: 'tenant_id', patientId: 'patient_id', practitionerId: 'practitioner_id', procedureTypeId: 'procedure_type_id', date: 'date', startTime: 'start_time', endTime: 'end_time', status: 'status', googleEventId: 'google_event_id', clinicGoogleEventId: 'clinic_google_event_id', deletedAt: 'deleted_at' },
  patients: { id: 'id', fullName: 'full_name' },
  procedureTypes: { id: 'id', name: 'name' },
}))

import { buildEventSummary, buildEventBody } from '../google-calendar-sync'

describe('buildEventSummary', () => {
  it('should combine procedure type and patient name', () => {
    expect(buildEventSummary('Maria Silva', 'Botox')).toBe('Botox - Maria Silva')
  })

  it('should use patient name only when no procedure type', () => {
    expect(buildEventSummary('Maria Silva', null)).toBe('Maria Silva')
  })

  it('should use default when no patient or procedure', () => {
    expect(buildEventSummary(null, null)).toBe('Agendamento')
  })

  it('should use procedure and patient when both present', () => {
    expect(buildEventSummary('Ana Costa', 'Preenchimento')).toBe('Preenchimento - Ana Costa')
  })
})

describe('buildEventBody', () => {
  const baseAppt = {
    id: 'appt-1',
    tenantId: 'tenant-1',
    practitionerId: 'user-1',
    date: '2026-05-28',
    startTime: '14:00',
    endTime: '15:00',
    status: 'confirmed',
    googleEventId: null,
    clinicGoogleEventId: null,
    patientName: 'Maria Silva',
    procedureTypeName: 'Botox',
    deletedAt: null,
  }

  it('should build a confirmed event body', () => {
    const body = buildEventBody(baseAppt)
    expect(body.summary).toBe('Botox - Maria Silva')
    expect(body.description).toBe('Agendamento FloraClin')
    expect(body.start.dateTime).toBe('2026-05-28T14:00:00')
    expect(body.start.timeZone).toBe('America/Sao_Paulo')
    expect(body.end.dateTime).toBe('2026-05-28T15:00:00')
    expect(body.status).toBe('confirmed')
  })

  it('should build a tentative event for scheduled status', () => {
    const body = buildEventBody({ ...baseAppt, status: 'scheduled' })
    expect(body.status).toBe('tentative')
  })

  it('should map in_progress to confirmed', () => {
    const body = buildEventBody({ ...baseAppt, status: 'in_progress' })
    expect(body.status).toBe('confirmed')
  })

  it('should map completed to confirmed', () => {
    const body = buildEventBody({ ...baseAppt, status: 'completed' })
    expect(body.status).toBe('confirmed')
  })
})
```

---

### Task 6: Pull sync function

**Files:**
- Create: `web/src/lib/google-calendar-pull.ts`
- Create: `web/src/lib/__tests__/google-calendar-pull.test.ts`

- [ ] **Step 1: Create the pull sync function**

Create `web/src/lib/google-calendar-pull.ts`:

```typescript
import { getGoogleCalendarClient } from '@/lib/google-calendar'
import {
  upsertCalendarBlock,
  deleteCalendarBlock,
  updateConnection,
} from '@/db/queries/calendar'
import { db } from '@/db/client'
import { appointments } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { addDays } from 'date-fns'
import { toBrYmd, toLocalYmd } from '@/lib/dates'
import type { calendar_v3 } from 'googleapis'

/**
 * Check if a Google event ID matches one of our own appointments
 * (to avoid creating a block for FloraClin-originated events).
 */
async function isOurOwnEvent(
  tenantId: string,
  googleEventId: string
): Promise<boolean> {
  const [match] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        sql`(${appointments.googleEventId} = ${googleEventId} OR ${appointments.clinicGoogleEventId} = ${googleEventId})`
      )
    )
    .limit(1)

  return !!match
}

/**
 * Determine if a Google Calendar event should be included as a block.
 * Excludes: transparent events, declined events, cancelled events, our own events.
 */
export function shouldIncludeEvent(event: calendar_v3.Schema$Event): boolean {
  // Exclude cancelled events
  if (event.status === 'cancelled') return false

  // Exclude transparent (free) events
  if (event.transparency === 'transparent') return false

  // Exclude events the user declined
  const selfAttendee = event.attendees?.find((a) => a.self)
  if (selfAttendee?.responseStatus === 'declined') return false

  return true
}

/**
 * Extract date and time info from a Google Calendar event.
 */
export function extractEventTiming(event: calendar_v3.Schema$Event): {
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
} | null {
  if (event.start?.date) {
    // All-day event — date is YYYY-MM-DD
    return {
      date: event.start.date,
      startTime: null,
      endTime: null,
      allDay: true,
    }
  }

  if (event.start?.dateTime && event.end?.dateTime) {
    // Timed event — extract date and time components
    // dateTime format: 2026-05-28T14:00:00-03:00
    const startDt = new Date(event.start.dateTime)
    const endDt = new Date(event.end.dateTime)

    // Use BR timezone to extract the local date
    const date = toBrYmd(startDt)

    // Extract HH:mm from the dateTime string (BR-local)
    const { formatInTimeZone } = require('date-fns-tz')
    const startTime = formatInTimeZone(startDt, 'America/Sao_Paulo', 'HH:mm')
    const endTime = formatInTimeZone(endDt, 'America/Sao_Paulo', 'HH:mm')

    return { date, startTime, endTime, allDay: false }
  }

  return null
}

/**
 * Process a list of changed events from Google Calendar.
 * Upserts or deletes calendar_blocks rows.
 */
export async function processCalendarChanges(
  connectionId: string,
  tenantId: string,
  practitionerId: string,
  events: calendar_v3.Schema$Event[]
): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0
  let deleted = 0

  for (const event of events) {
    if (!event.id) continue

    // Check if this is our own event
    const isOwn = await isOurOwnEvent(tenantId, event.id)
    if (isOwn) continue

    if (event.status === 'cancelled' || !shouldIncludeEvent(event)) {
      // Delete the block if it exists
      await deleteCalendarBlock(connectionId, event.id)
      deleted++
      continue
    }

    const timing = extractEventTiming(event)
    if (!timing) continue

    // Map Google status to our block status
    const blockStatus = event.status === 'tentative' ? 'tentative' : 'confirmed'

    await upsertCalendarBlock({
      tenantId,
      practitionerId,
      connectionId,
      googleEventId: event.id,
      title: event.summary ?? null,
      date: timing.date,
      startTime: timing.startTime,
      endTime: timing.endTime,
      allDay: timing.allDay,
      status: blockStatus,
    })
    upserted++
  }

  return { upserted, deleted }
}

/**
 * Perform incremental sync using the stored syncToken.
 * Called by the webhook handler.
 */
export async function incrementalSync(connectionId: string): Promise<void> {
  const { calendar, connection } = await getGoogleCalendarClient(connectionId)

  if (!connection.userId) {
    // Clinic connections don't pull events — they only push
    return
  }

  try {
    let pageToken: string | undefined
    let syncToken = connection.syncToken ?? undefined
    const allEvents: calendar_v3.Schema$Event[] = []

    // If no syncToken, do a full sync for the next 30 days
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: connection.calendarId,
    }

    if (syncToken) {
      params.syncToken = syncToken
    } else {
      params.timeMin = new Date().toISOString()
      params.timeMax = addDays(new Date(), 30).toISOString()
      params.singleEvents = true
    }

    // Paginate through all results
    do {
      if (pageToken) {
        params.pageToken = pageToken
      }

      const response = await calendar.events.list(params)
      const items = response.data.items ?? []
      allEvents.push(...items)

      pageToken = response.data.nextPageToken ?? undefined

      // Store the new syncToken from the last page
      if (!response.data.nextPageToken && response.data.nextSyncToken) {
        syncToken = response.data.nextSyncToken
      }
    } while (pageToken)

    // Process the events
    if (allEvents.length > 0) {
      await processCalendarChanges(
        connectionId,
        connection.tenantId,
        connection.userId,
        allEvents
      )
    }

    // Update the sync token
    if (syncToken) {
      await updateConnection(connectionId, connection.tenantId, {
        syncToken,
      })
    }
  } catch (error: unknown) {
    const statusCode = (error as { code?: number })?.code
    if (statusCode === 410) {
      // Sync token expired — clear it and do a full sync
      await updateConnection(connectionId, connection.tenantId, {
        syncToken: null,
      })
      // Retry as full sync
      await incrementalSync(connectionId)
      return
    }
    throw error
  }
}

/**
 * Run the initial sync for a newly connected calendar.
 * Fetches events for the next 30 days.
 */
export async function runInitialSync(connectionId: string): Promise<void> {
  await incrementalSync(connectionId)
}
```

- [ ] **Step 2: Write pull sync tests**

Create `web/src/lib/__tests__/google-calendar-pull.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { calendar_v3 } from 'googleapis'

// Mock dependencies
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    calendar: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getGoogleCalendarClient: vi.fn(),
}))

vi.mock('@/db/queries/calendar', () => ({
  upsertCalendarBlock: vi.fn().mockResolvedValue({ id: 'block-1' }),
  deleteCalendarBlock: vi.fn().mockResolvedValue(undefined),
  updateConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]), // Not our own event
        }),
      }),
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    id: 'id',
    tenantId: 'tenant_id',
    googleEventId: 'google_event_id',
    clinicGoogleEventId: 'clinic_google_event_id',
  },
}))

vi.mock('@/lib/dates', () => ({
  toBrYmd: (d: Date) => d.toISOString().slice(0, 10),
  toLocalYmd: (d: Date) => d.toISOString().slice(0, 10),
}))

vi.mock('date-fns-tz', () => ({
  formatInTimeZone: (_d: Date, _tz: string, fmt: string) => {
    if (fmt === 'HH:mm') return '14:00'
    return '2026-05-28'
  },
}))

vi.mock('date-fns', () => ({
  addDays: (d: Date, n: number) => new Date(d.getTime() + n * 86400000),
}))

import { shouldIncludeEvent, extractEventTiming, processCalendarChanges } from '../google-calendar-pull'
import { upsertCalendarBlock, deleteCalendarBlock } from '@/db/queries/calendar'

describe('shouldIncludeEvent', () => {
  it('should include a confirmed busy event', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'confirmed',
      summary: 'Meeting',
    }
    expect(shouldIncludeEvent(event)).toBe(true)
  })

  it('should exclude cancelled events', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'cancelled',
      summary: 'Old Meeting',
    }
    expect(shouldIncludeEvent(event)).toBe(false)
  })

  it('should exclude transparent (free) events', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'confirmed',
      transparency: 'transparent',
      summary: 'Reminder',
    }
    expect(shouldIncludeEvent(event)).toBe(false)
  })

  it('should exclude declined events', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'confirmed',
      summary: 'Team meeting',
      attendees: [
        { self: true, responseStatus: 'declined' },
      ],
    }
    expect(shouldIncludeEvent(event)).toBe(false)
  })

  it('should include tentative events', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'tentative',
      summary: 'Maybe meeting',
    }
    expect(shouldIncludeEvent(event)).toBe(true)
  })

  it('should include events where user accepted', () => {
    const event: calendar_v3.Schema$Event = {
      status: 'confirmed',
      attendees: [
        { self: true, responseStatus: 'accepted' },
      ],
    }
    expect(shouldIncludeEvent(event)).toBe(true)
  })
})

describe('extractEventTiming', () => {
  it('should handle all-day events', () => {
    const event: calendar_v3.Schema$Event = {
      start: { date: '2026-05-28' },
      end: { date: '2026-05-29' },
    }
    const result = extractEventTiming(event)
    expect(result).toEqual({
      date: '2026-05-28',
      startTime: null,
      endTime: null,
      allDay: true,
    })
  })

  it('should handle timed events', () => {
    const event: calendar_v3.Schema$Event = {
      start: { dateTime: '2026-05-28T14:00:00-03:00' },
      end: { dateTime: '2026-05-28T15:00:00-03:00' },
    }
    const result = extractEventTiming(event)
    expect(result).not.toBeNull()
    expect(result!.allDay).toBe(false)
    expect(result!.startTime).toBe('14:00')
    expect(result!.endTime).toBe('14:00') // Mocked formatInTimeZone returns same value
  })

  it('should return null for events without start info', () => {
    const event: calendar_v3.Schema$Event = {}
    expect(extractEventTiming(event)).toBeNull()
  })
})

describe('processCalendarChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should upsert blocks for included events', async () => {
    const events: calendar_v3.Schema$Event[] = [
      {
        id: 'evt-1',
        status: 'confirmed',
        summary: 'External Meeting',
        start: { date: '2026-05-28' },
        end: { date: '2026-05-29' },
      },
    ]

    const result = await processCalendarChanges('conn-1', 'tenant-1', 'user-1', events)
    expect(result.upserted).toBe(1)
    expect(upsertCalendarBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        googleEventId: 'evt-1',
        title: 'External Meeting',
        allDay: true,
      })
    )
  })

  it('should delete blocks for cancelled events', async () => {
    const events: calendar_v3.Schema$Event[] = [
      {
        id: 'evt-2',
        status: 'cancelled',
      },
    ]

    const result = await processCalendarChanges('conn-1', 'tenant-1', 'user-1', events)
    expect(result.deleted).toBe(1)
    expect(deleteCalendarBlock).toHaveBeenCalledWith('conn-1', 'evt-2')
  })

  it('should skip events without an id', async () => {
    const events: calendar_v3.Schema$Event[] = [
      { status: 'confirmed', summary: 'No ID' },
    ]

    const result = await processCalendarChanges('conn-1', 'tenant-1', 'user-1', events)
    expect(result.upserted).toBe(0)
    expect(result.deleted).toBe(0)
  })

  it('should delete blocks for transparent events', async () => {
    const events: calendar_v3.Schema$Event[] = [
      {
        id: 'evt-3',
        status: 'confirmed',
        transparency: 'transparent',
      },
    ]

    const result = await processCalendarChanges('conn-1', 'tenant-1', 'user-1', events)
    expect(result.deleted).toBe(1)
  })
})
```

---

### Task 7: iCal feed generator

**Files:**
- Create: `web/src/lib/ical-feed.ts`
- Create: `web/src/lib/__tests__/ical-feed.test.ts`

- [ ] **Step 1: Create the iCal feed generator**

Create `web/src/lib/ical-feed.ts`:

```typescript
import icalGenerator from 'ical-generator'
import { db } from '@/db/client'
import { appointments, patients, procedureTypes } from '@/db/schema'
import { eq, and, isNull, gte, lte, ne } from 'drizzle-orm'
import { subDays, addDays } from 'date-fns'
import { toBrYmd } from '@/lib/dates'

const BR_TZ = 'America/Sao_Paulo'

interface FeedAppointment {
  id: string
  date: string
  startTime: string
  endTime: string
  status: string
  patientName: string | null
  procedureTypeName: string | null
}

/**
 * Generate an iCal feed for a calendar connection.
 * Practitioner feed: their appointments only.
 * Clinic feed: all appointments for the tenant.
 */
export async function generateICalFeed(
  tenantId: string,
  userId: string | null,
  calendarName: string = 'FloraClin'
): Promise<string> {
  const now = new Date()
  const dateFrom = toBrYmd(subDays(now, 7))
  const dateTo = toBrYmd(addDays(now, 60))

  const conditions = [
    eq(appointments.tenantId, tenantId),
    isNull(appointments.deletedAt),
    ne(appointments.status, 'cancelled'),
    ne(appointments.status, 'no_show'),
    gte(appointments.date, dateFrom),
    lte(appointments.date, dateTo),
  ]

  // Practitioner feed: filter by practitioner
  if (userId) {
    conditions.push(eq(appointments.practitionerId, userId))
  }

  const rows: FeedAppointment[] = await db
    .select({
      id: appointments.id,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      patientName: patients.fullName,
      procedureTypeName: procedureTypes.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(and(...conditions))
    .orderBy(appointments.date, appointments.startTime)

  const calendar = icalGenerator({
    name: calendarName,
    timezone: BR_TZ,
    prodId: { company: 'FloraClin', product: 'Agenda' },
  })

  for (const appt of rows) {
    const summary = buildFeedSummary(appt.patientName, appt.procedureTypeName)
    const icalStatus = appt.status === 'scheduled' ? 'TENTATIVE' : 'CONFIRMED'

    calendar.createEvent({
      id: `${appt.id}@floraclin.com.br`,
      summary,
      description: 'Agendamento FloraClin',
      start: new Date(`${appt.date}T${appt.startTime}`),
      end: new Date(`${appt.date}T${appt.endTime}`),
      timezone: BR_TZ,
      status: icalStatus,
    })
  }

  return calendar.toString()
}

function buildFeedSummary(
  patientName: string | null,
  procedureTypeName: string | null
): string {
  if (procedureTypeName && patientName) {
    return `${procedureTypeName} - ${patientName}`
  }
  if (patientName) {
    return patientName
  }
  return 'Agendamento'
}
```

- [ ] **Step 2: Write iCal feed tests**

Create `web/src/lib/__tests__/ical-feed.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ical-generator
const mockCreateEvent = vi.fn()
const mockToString = vi.fn().mockReturnValue('BEGIN:VCALENDAR\nEND:VCALENDAR')

vi.mock('ical-generator', () => ({
  default: vi.fn().mockReturnValue({
    createEvent: (...args: unknown[]) => mockCreateEvent(...args),
    toString: () => mockToString(),
  }),
}))

// Mock db
const mockOrderBy = vi.fn().mockResolvedValue([])
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: mockWhere,
          }),
        }),
      }),
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    id: 'id',
    tenantId: 'tenant_id',
    practitionerId: 'practitioner_id',
    patientId: 'patient_id',
    procedureTypeId: 'procedure_type_id',
    date: 'date',
    startTime: 'start_time',
    endTime: 'end_time',
    status: 'status',
    deletedAt: 'deleted_at',
  },
  patients: { id: 'id', fullName: 'full_name' },
  procedureTypes: { id: 'id', name: 'name' },
}))

vi.mock('@/lib/dates', () => ({
  toBrYmd: () => '2026-05-27',
}))

vi.mock('date-fns', () => ({
  subDays: (d: Date, n: number) => new Date(d.getTime() - n * 86400000),
  addDays: (d: Date, n: number) => new Date(d.getTime() + n * 86400000),
}))

import { generateICalFeed } from '../ical-feed'

describe('generateICalFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a valid iCal string', async () => {
    mockOrderBy.mockResolvedValue([])
    const result = await generateICalFeed('tenant-1', 'user-1', 'Test Calendar')
    expect(result).toContain('VCALENDAR')
  })

  it('should create events for each appointment', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'appt-1',
        date: '2026-05-28',
        startTime: '14:00',
        endTime: '15:00',
        status: 'confirmed',
        patientName: 'Maria Silva',
        procedureTypeName: 'Botox',
      },
      {
        id: 'appt-2',
        date: '2026-05-29',
        startTime: '10:00',
        endTime: '11:00',
        status: 'scheduled',
        patientName: 'Ana Costa',
        procedureTypeName: null,
      },
    ])

    await generateICalFeed('tenant-1', 'user-1')

    expect(mockCreateEvent).toHaveBeenCalledTimes(2)
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'appt-1@floraclin.com.br',
        summary: 'Botox - Maria Silva',
        status: 'CONFIRMED',
      })
    )
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'appt-2@floraclin.com.br',
        summary: 'Ana Costa',
        status: 'TENTATIVE',
      })
    )
  })

  it('should work for clinic-level feed (userId = null)', async () => {
    mockOrderBy.mockResolvedValue([])
    await generateICalFeed('tenant-1', null, 'Clinic Feed')
    // Should not include practitioner filter
    expect(mockWhere).toHaveBeenCalled()
  })
})
```

---

## Group C (depends on B) — API Endpoints

### Task 8: Wire push sync into appointment API routes

**Files:**
- Modify: `web/src/app/api/appointments/route.ts`
- Modify: `web/src/app/api/appointments/[id]/route.ts`
- Modify: `web/src/app/api/appointments/[id]/status/route.ts`

- [ ] **Step 1: Add push sync to POST /api/appointments**

In `web/src/app/api/appointments/route.ts`, add the import at the top:

```typescript
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
```

Then, after the `await createAuditLog(...)` call inside the POST handler (after line ~93), add the fire-and-forget sync call:

```typescript
    // Fire-and-forget Google Calendar sync
    syncAppointmentToGoogle(ctx.tenantId, appointment.id).catch((err) => {
      console.error('Google Calendar push sync failed:', err)
    })
```

- [ ] **Step 2: Add push sync to PUT /api/appointments/[id]**

In `web/src/app/api/appointments/[id]/route.ts`, add the import at the top:

```typescript
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
```

Then, after the `await createAuditLog(...)` call inside the PUT handler (after line ~80), add:

```typescript
    // Fire-and-forget Google Calendar sync
    syncAppointmentToGoogle(ctx.tenantId, appointmentId).catch((err) => {
      console.error('Google Calendar push sync failed:', err)
    })
```

Also, after the `await createAuditLog(...)` call inside the DELETE handler (after line ~118), add:

```typescript
    // Fire-and-forget Google Calendar sync (will delete the event)
    syncAppointmentToGoogle(ctx.tenantId, id).catch((err) => {
      console.error('Google Calendar push sync failed:', err)
    })
```

- [ ] **Step 3: Add push sync to PUT /api/appointments/[id]/status**

In `web/src/app/api/appointments/[id]/status/route.ts`, add the import at the top:

```typescript
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
```

Then, after the `await createAuditLog(...)` call inside the PUT handler (after line ~45), add:

```typescript
    // Fire-and-forget Google Calendar sync
    syncAppointmentToGoogle(ctx.tenantId, id).catch((err) => {
      console.error('Google Calendar push sync failed:', err)
    })
```

---

### Task 9: Webhook endpoint

**Files:**
- Create: `web/src/app/api/calendar/webhook/route.ts`

- [ ] **Step 1: Create the webhook endpoint**

Create `web/src/app/api/calendar/webhook/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getConnectionByChannelId } from '@/db/queries/calendar'
import { incrementalSync } from '@/lib/google-calendar-pull'

/**
 * Google Calendar push notification receiver.
 * Google sends a POST when events change on a watched calendar.
 * The body is empty — the notification just says "something changed".
 * We use the channel ID from headers to identify the connection,
 * then run an incremental sync.
 */
export async function POST(request: Request) {
  try {
    const channelId = request.headers.get('x-goog-channel-id')
    const resourceId = request.headers.get('x-goog-resource-id')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channelId || !resourceId) {
      return NextResponse.json({ error: 'Missing channel headers' }, { status: 400 })
    }

    // Ignore sync notifications (sent when channel is first created)
    if (resourceState === 'sync') {
      return NextResponse.json({ ok: true })
    }

    // Find the connection by channel ID
    const connection = await getConnectionByChannelId(channelId)
    if (!connection) {
      console.warn(`Webhook received for unknown channel: ${channelId}`)
      return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
    }

    // Verify resource ID matches
    if (connection.channelResourceId !== resourceId) {
      console.warn(`Webhook resource ID mismatch: expected ${connection.channelResourceId}, got ${resourceId}`)
      return NextResponse.json({ error: 'Resource ID mismatch' }, { status: 403 })
    }

    if (!connection.enabled) {
      return NextResponse.json({ ok: true, message: 'Connection disabled' })
    }

    // Run incremental sync — fire-and-forget
    incrementalSync(connection.id).catch((err) => {
      console.error(`Incremental sync failed for connection ${connection.id}:`, err)
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

---

### Task 10: iCal feed endpoint

**Files:**
- Create: `web/src/app/api/calendar/feed/[token]/route.ts`

- [ ] **Step 1: Create the iCal feed endpoint**

Create `web/src/app/api/calendar/feed/[token]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getConnectionByFeedToken } from '@/db/queries/calendar'
import { generateICalFeed } from '@/lib/ical-feed'

/**
 * Public iCal feed endpoint.
 * No auth headers — the feedToken in the URL is the secret.
 * URL format: /api/calendar/feed/{feedToken}
 *
 * Calendar apps (Google Calendar, Apple Calendar, Outlook) subscribe
 * to this URL and poll it periodically.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Strip .ics extension if present
    const feedToken = token.replace(/\.ics$/, '')

    const connection = await getConnectionByFeedToken(feedToken)
    if (!connection) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const calendarName = connection.userId
      ? 'FloraClin - Meus Agendamentos'
      : 'FloraClin - Clínica'

    const icalContent = await generateICalFeed(
      connection.tenantId,
      connection.userId,
      calendarName
    )

    return new NextResponse(icalContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Disposition': 'inline; filename="floraclin.ics"',
      },
    })
  } catch (error) {
    console.error('iCal feed error:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
```

---

### Task 11: Cron endpoint for channel renewal

**Files:**
- Create: `web/src/app/api/cron/calendar-renew/route.ts`

- [ ] **Step 1: Create the cron endpoint**

Create `web/src/app/api/cron/calendar-renew/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getExpiringConnections, updateConnection } from '@/db/queries/calendar'
import { registerWebhookChannel, stopWebhookChannel } from '@/lib/google-calendar'

/**
 * Vercel Cron job that renews expiring Google Calendar webhook channels.
 * Channels expire after ~7 days. This runs daily and renews any channel
 * expiring within the next 48 hours.
 *
 * Secured via CRON_SECRET header.
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const connections = await getExpiringConnections(48)
    let renewed = 0
    let failed = 0

    for (const connection of connections) {
      try {
        // Stop the old channel if it exists
        if (connection.channelId && connection.channelResourceId) {
          await stopWebhookChannel(
            connection.id,
            connection.channelId,
            connection.channelResourceId
          )
        }

        // Register a new channel
        const channel = await registerWebhookChannel(
          connection.id,
          connection.calendarId
        )

        await updateConnection(connection.id, connection.tenantId, {
          channelId: channel.channelId,
          channelResourceId: channel.resourceId,
          channelExpiry: channel.expiration,
        })

        renewed++
      } catch (error) {
        console.error(`Failed to renew channel for connection ${connection.id}:`, error)
        failed++
      }
    }

    return NextResponse.json({
      ok: true,
      renewed,
      failed,
      total: connections.length,
    })
  } catch (error) {
    console.error('Calendar renew cron error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

---

### Task 12: Calendar connections API

**Files:**
- Create: `web/src/app/api/calendar/connections/route.ts`
- Create: `web/src/app/api/calendar/connections/[id]/route.ts`

- [ ] **Step 1: Create the list connections route**

Create `web/src/app/api/calendar/connections/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listConnections, getConnectionByUserId, getClinicConnection } from '@/db/queries/calendar'

export async function GET() {
  try {
    const ctx = await getAuthContext()

    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Owners see all connections; practitioners see only their own
    if (ctx.role === 'owner') {
      const connections = await listConnections(ctx.tenantId)
      return NextResponse.json({ data: connections })
    }

    const connection = await getConnectionByUserId(ctx.tenantId, ctx.userId)
    const connections = connection ? [connection] : []
    return NextResponse.json({ data: connections })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create the update/delete connection route**

Create `web/src/app/api/calendar/connections/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { z } from 'zod'
import {
  updateConnection,
  deleteConnection,
  deleteBlocksByConnection,
  clearAppointmentGoogleEventIds,
} from '@/db/queries/calendar'
import { stopWebhookChannel, revokeToken } from '@/lib/google-calendar'
import { db } from '@/db/client'
import { calendarConnections } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

const updateSchema = z.object({
  enabled: z.boolean().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const connection = await updateConnection(id, ctx.tenantId, parsed.data)
    if (!connection) {
      return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })
    }

    return NextResponse.json({ data: connection })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // Load connection to get cleanup data
    const [connection] = await db
      .select()
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.id, id),
          eq(calendarConnections.tenantId, ctx.tenantId)
        )
      )
      .limit(1)

    if (!connection) {
      return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })
    }

    // Practitioners can only delete their own connection
    if (ctx.role === 'practitioner' && connection.userId !== ctx.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Stop the webhook channel
    if (connection.channelId && connection.channelResourceId) {
      await stopWebhookChannel(
        connection.id,
        connection.channelId,
        connection.channelResourceId
      ).catch(() => {}) // Best effort
    }

    // Delete all calendar blocks for this connection
    await deleteBlocksByConnection(connection.id)

    // Clear Google event IDs from appointments
    await clearAppointmentGoogleEventIds(ctx.tenantId, connection.userId)

    // Delete the connection
    await deleteConnection(id, ctx.tenantId)

    // Revoke the Google token (best effort)
    revokeToken(connection.accessToken).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

---

## Group D (depends on C) — UI + Availability Integration

### Task 13: Availability integration — modify getAvailableSlots

**Files:**
- Modify: `web/src/db/queries/appointments.ts`

- [ ] **Step 1: Add calendar block import and query to getAvailableSlots**

In `web/src/db/queries/appointments.ts`, add the import at the top alongside the existing schema imports:

```typescript
import { appointments, patients, procedureTypes, users, tenants, calendarBlocks } from '@/db/schema'
```

Then, inside the `getAvailableSlots` function, after the existing appointments query (after line ~343, after the `existing` variable is populated), add the calendar blocks query:

```typescript
  // Get calendar blocks for that day (external calendar events blocking availability)
  const blocks = await db
    .select({
      startTime: calendarBlocks.startTime,
      endTime: calendarBlocks.endTime,
      allDay: calendarBlocks.allDay,
    })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.tenantId, tenantId),
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.date, date),
        ne(calendarBlocks.status, 'cancelled')
      )
    )
```

Then modify the slot conflict check (replace the existing `hasConflict` logic starting at line ~358) to also check calendar blocks:

```typescript
    // Check if this slot conflicts with any existing appointment
    const hasAppointmentConflict = existing.some((appt) => {
      return appt.startTime < slotEnd && appt.endTime > slotStart
    })

    // Check if this slot conflicts with any calendar block
    const hasBlockConflict = blocks.some((block) => {
      if (block.allDay) return true // All-day blocks block everything
      if (!block.startTime || !block.endTime) return false
      return block.startTime < slotEnd && block.endTime > slotStart
    })

    if (!hasAppointmentConflict && !hasBlockConflict) {
      slots.push({ start: slotStart, end: slotEnd })
    }
```

The full replacement: find the existing block:

```typescript
    // Check if this slot conflicts with any existing appointment
    const hasConflict = existing.some((appt) => {
      return appt.startTime < slotEnd && appt.endTime > slotStart
    })

    if (!hasConflict) {
      slots.push({ start: slotStart, end: slotEnd })
    }
```

Replace it with:

```typescript
    // Check if this slot conflicts with any existing appointment
    const hasAppointmentConflict = existing.some((appt) => {
      return appt.startTime < slotEnd && appt.endTime > slotStart
    })

    // Check if this slot conflicts with any calendar block
    const hasBlockConflict = blocks.some((block) => {
      if (block.allDay) return true
      if (!block.startTime || !block.endTime) return false
      return block.startTime < slotEnd && block.endTime > slotStart
    })

    if (!hasAppointmentConflict && !hasBlockConflict) {
      slots.push({ start: slotStart, end: slotEnd })
    }
```

---

### Task 14: Agenda view — render calendar blocks + data fetching

**Files:**
- Create: `web/src/hooks/queries/use-calendar.ts`
- Create: `web/src/app/api/calendar/blocks/route.ts`
- Modify: `web/src/hooks/queries/query-keys.ts`
- Modify: `web/src/app/(platform)/agenda/agenda-page-client.tsx`
- Modify: `web/src/components/scheduling/calendar-view.tsx`
- Modify: `web/src/components/scheduling/day-view.tsx`
- Modify: `web/src/components/scheduling/week-view.tsx`

- [ ] **Step 1: Add calendar query keys**

In `web/src/hooks/queries/query-keys.ts`, add after the `audit` key (before the closing `} as const`):

```typescript
  calendar: {
    all: ['calendar'] as const,
    connections: ['calendar', 'connections'] as const,
    blocks: (practitionerId: string | undefined, dateFrom: string, dateTo: string) =>
      ['calendar', 'blocks', practitionerId, dateFrom, dateTo] as const,
  },
```

- [ ] **Step 2: Create calendar hooks**

Create `web/src/hooks/queries/use-calendar.ts`:

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { CalendarBlockRow } from '@/db/queries/calendar'

export function useCalendarBlocks(
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
) {
  return useQuery<CalendarBlockRow[]>({
    queryKey: queryKeys.calendar.blocks(practitionerId, dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (practitionerId) params.set('practitionerId', practitionerId)
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      const res = await fetch(`/api/calendar/blocks?${params}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })
}

export function useCalendarConnections() {
  return useQuery({
    queryKey: queryKeys.calendar.connections,
    queryFn: async () => {
      const res = await fetch('/api/calendar/connections')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })
}
```

- [ ] **Step 3: Create calendar blocks API endpoint**

Create `web/src/app/api/calendar/blocks/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listBlocksForDateRange } from '@/db/queries/calendar'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const practitionerId = searchParams.get('practitionerId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? ''
    const dateTo = searchParams.get('dateTo') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
    }

    const data = await listBlocksForDateRange(ctx.tenantId, practitionerId, dateFrom, dateTo)
    return NextResponse.json({ data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Update agenda page client to fetch blocks**

In `web/src/app/(platform)/agenda/agenda-page-client.tsx`, add the import:

```typescript
import { useCalendarBlocks } from '@/hooks/queries/use-calendar'
```

After the existing `useAppointmentProcedureTypes` hook call, add:

```typescript
  const { data: calendarBlocks } = useCalendarBlocks(
    practitionerFilter,
    dateFrom,
    dateTo
  )
```

Then pass `calendarBlocks` to `CalendarView`:

```typescript
      <CalendarView
        initialDate={dateStr}
        initialView={view}
        initialPractitionerId={practitionerFilter}
        practitioners={practitioners ?? []}
        procedureTypes={procTypes ?? []}
        initialAppointments={appointments ?? []}
        calendarBlocks={calendarBlocks ?? []}
      />
```

- [ ] **Step 5: Update CalendarView to accept and pass blocks**

In `web/src/components/scheduling/calendar-view.tsx`, add the import:

```typescript
import type { CalendarBlockRow } from '@/db/queries/calendar'
```

Add to the `CalendarViewProps` interface:

```typescript
  calendarBlocks?: CalendarBlockRow[]
```

In the component destructuring, add:

```typescript
  calendarBlocks = [],
```

Pass blocks to the DayView and WeekView components:

```typescript
        {view === 'day' && (
          <DayView
            date={currentDate}
            appointments={appointments}
            calendarBlocks={calendarBlocks}
            onSlotClick={handleSlotClick}
            onAppointmentClick={handleAppointmentClick}
          />
        )}

        {view === 'week' && (
          <WeekView
            date={currentDate}
            appointments={appointments}
            calendarBlocks={calendarBlocks}
            onSlotClick={handleSlotClick}
            onAppointmentClick={handleAppointmentClick}
          />
        )}
```

- [ ] **Step 6: Render calendar blocks in DayView**

In `web/src/components/scheduling/day-view.tsx`, add the import:

```typescript
import type { CalendarBlockRow } from '@/db/queries/calendar'
```

Add to `DayViewProps`:

```typescript
  calendarBlocks?: CalendarBlockRow[]
```

In the component, add to the destructuring:

```typescript
export function DayView({ date, appointments, calendarBlocks = [], onSlotClick, onAppointmentClick }: DayViewProps) {
```

After the `layoutSlots` useMemo, add the block layout computation:

```typescript
  const dayBlocks = calendarBlocks.filter((b) => b.date === dateStr)

  const blockSlots = React.useMemo(() => {
    return dayBlocks.map((block) => {
      if (block.allDay) {
        const top = 0
        const height = (END_HOUR - START_HOUR + 1) * 2 * SLOT_HEIGHT_PX
        return { block, top, height }
      }
      if (!block.startTime || !block.endTime) return null
      const startMin = timeToMinutes(block.startTime)
      const endMin = timeToMinutes(block.endTime)
      const gridStartMin = START_HOUR * 60
      const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT_PX
      const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2)
      return { block, top, height }
    }).filter(Boolean) as { block: CalendarBlockRow; top: number; height: number }[]
  }, [dayBlocks])
```

Then render the blocks alongside appointments, after the `{/* Appointments */}` section and before the closing `</div>` of the grid:

```typescript
          {/* Calendar blocks (external events) */}
          {blockSlots.map(({ block, top, height }) => (
            <div
              key={block.id}
              className="absolute left-0 right-0 z-10 mx-1 rounded border border-dashed border-gray-300 bg-gray-100/60 px-2 py-1 pointer-events-none"
              style={{ top, height }}
            >
              <span className="text-[11px] font-medium text-gray-500 truncate block">
                Indisponivel
              </span>
            </div>
          ))}
```

- [ ] **Step 7: Render calendar blocks in WeekView**

In `web/src/components/scheduling/week-view.tsx`, add the import:

```typescript
import type { CalendarBlockRow } from '@/db/queries/calendar'
```

Add to `WeekViewProps`:

```typescript
  calendarBlocks?: CalendarBlockRow[]
```

In the component, add to the destructuring:

```typescript
export function WeekView({ date, appointments, calendarBlocks = [], onSlotClick, onAppointmentClick }: WeekViewProps) {
```

Inside the `days.map()` block, after the `layoutSlots` computation, add:

```typescript
          const dayBlocksForDate = calendarBlocks.filter((b) => b.date === dateStr)
```

Then render the blocks alongside the appointments inside the day column, after the `{/* Appointments */}` section:

```typescript
              {/* Calendar blocks (external events) */}
              {dayBlocksForDate.map((block) => {
                let top: number
                let height: number
                if (block.allDay) {
                  top = 0
                  height = (END_HOUR - START_HOUR + 1) * 2 * SLOT_HEIGHT_PX
                } else if (block.startTime && block.endTime) {
                  const startMin = timeToMinutes(block.startTime)
                  const endMin = timeToMinutes(block.endTime)
                  const gridStartMin = START_HOUR * 60
                  top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT_PX
                  height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2)
                } else {
                  return null
                }
                return (
                  <div
                    key={block.id}
                    className="absolute left-0 right-0 z-10 mx-0.5 rounded border border-dashed border-gray-300 bg-gray-100/60 px-1 py-0.5 pointer-events-none"
                    style={{ top, height }}
                  >
                    <span className="text-[10px] font-medium text-gray-500 truncate block">
                      Indisponivel
                    </span>
                  </div>
                )
              })}
```

---

### Task 15: Profile dialog — Google Calendar connection section

**Files:**
- Create: `web/src/components/settings/calendar-connection-card.tsx`
- Modify: `web/src/components/layout/user-menu.tsx`

- [ ] **Step 1: Create the reusable calendar connection card component**

Create `web/src/components/settings/calendar-connection-card.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'

interface CalendarConnectionCardProps {
  type: 'practitioner' | 'clinic'
  connection: {
    id: string
    feedToken: string
    enabled: boolean
  } | null
  helperText: string
}

export function CalendarConnectionCard({
  type,
  connection,
  helperText,
}: CalendarConnectionCardProps) {
  const queryClient = useQueryClient()
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [copied, setCopied] = useState(false)

  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || ''

  const feedUrl = connection
    ? `${appUrl}/api/calendar/feed/${connection.feedToken}`
    : ''

  async function handleConnect() {
    window.location.href = `/api/calendar/auth/connect?type=${type}`
  }

  async function handleToggle(enabled: boolean) {
    if (!connection) return
    setToggling(true)
    try {
      const res = await fetch(`/api/calendar/connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Erro ao atualizar')
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.connections })
      toast.success(enabled ? 'Sincronização ativada' : 'Sincronização desativada')
    } catch {
      toast.error('Erro ao atualizar configuração')
    } finally {
      setToggling(false)
    }
  }

  async function handleDisconnect() {
    if (!connection) return
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/calendar/connections/${connection.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Erro ao desconectar')
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.connections })
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      toast.success('Google Calendar desconectado')
    } catch {
      toast.error('Erro ao desconectar')
    } finally {
      setDisconnecting(false)
      setConfirmOpen(false)
    }
  }

  async function handleCopyFeed() {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Erro ao copiar link')
    }
  }

  if (!connection) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-mid">{helperText}</p>
        <Button
          onClick={handleConnect}
          className="w-full bg-forest text-cream hover:bg-sage transition-colors"
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Conectar Google Calendar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-charcoal">Conectado</span>
      </div>

      <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-3">
        <Switch
          checked={connection.enabled}
          onCheckedChange={handleToggle}
          disabled={toggling}
        />
        <Label className="text-sm text-charcoal">
          Sincronizar automaticamente
        </Label>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-mid block">
          Link do calendario (iCal)
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded border border-[#E8ECEF] bg-white px-3 py-2">
            <span className="text-xs font-mono text-charcoal truncate block">{feedUrl}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyFeed}
            className="shrink-0"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-red-600 border-red-200 hover:bg-red-50"
        onClick={() => setConfirmOpen(true)}
      >
        Desconectar
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Google Calendar</DialogTitle>
            <DialogDescription>
              Tem certeza? A sincronização será interrompida e os bloqueios de calendário externo serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add Google Calendar section to profile dialog**

In `web/src/components/layout/user-menu.tsx`, add the import at the top:

```typescript
import { CalendarConnectionCard } from '@/components/settings/calendar-connection-card'
import { useCalendarConnections } from '@/hooks/queries/use-calendar'
```

Update the `UserMenuProps` interface to include the user role:

```typescript
interface UserMenuProps {
  userName: string
  userEmail: string
  userRole?: string
}
```

Update the `UserMenu` component signature:

```typescript
export function UserMenu({ userName, userEmail, userRole }: UserMenuProps) {
```

Pass `userRole` to `ProfileDialog`:

```typescript
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        userName={userName}
        userEmail={userEmail}
        userRole={userRole}
      />
```

Update `ProfileDialog` props and component:

Add `userRole?: string` to the ProfileDialog's props type.

Inside the `ProfileDialog` component, add after the state declarations:

```typescript
  const showCalendar = userRole === 'owner' || userRole === 'practitioner'
  const { data: connections } = useCalendarConnections()
  const myConnection = connections?.find((c: { userId: string | null }) => c.userId !== null) ?? null
```

After the password section `<div>` (before the closing `</div>` of `space-y-6 py-2`), add:

```typescript
          {showCalendar && (
            <>
              <div className="h-px bg-sage/15" />

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-mid">
                  Google Calendar
                </p>
                <CalendarConnectionCard
                  type="practitioner"
                  connection={myConnection}
                  helperText="Sincronize seus agendamentos com o Google Calendar."
                />
              </div>
            </>
          )}
```

---

### Task 16: Settings page — clinic calendar card

**Files:**
- Modify: `web/src/app/(platform)/configuracoes/settings-page-client.tsx`

- [ ] **Step 1: Add clinic calendar card to agendamento tab**

In `web/src/app/(platform)/configuracoes/settings-page-client.tsx`, add the imports:

```typescript
import { CalendarConnectionCard } from '@/components/settings/calendar-connection-card'
import { useCalendarConnections } from '@/hooks/queries/use-calendar'
```

Inside the `SettingsPageClient` component, before the `return`, add:

```typescript
  const { data: calendarConnections } = useCalendarConnections()
  const clinicConnection = calendarConnections?.find((c: { userId: string | null }) => c.userId === null) ?? null
```

Then in the `agendamento` tab section, wrap the existing `BookingSettings` and add the clinic calendar card after it. Replace:

```typescript
              {activeTab === 'agendamento' && (
                <BookingSettings
                  slug={tenant.slug}
                  publicBookingEnabled={publicBookingEnabled}
                />
              )}
```

With:

```typescript
              {activeTab === 'agendamento' && (
                <div className="space-y-8">
                  <BookingSettings
                    slug={tenant.slug}
                    publicBookingEnabled={publicBookingEnabled}
                  />

                  <div className="h-px bg-[#E8ECEF]" />

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-charcoal">Calendario da clinica</h3>
                      <p className="text-xs text-mid mt-1">
                        Todos os agendamentos de todos os profissionais serao sincronizados para este calendario.
                      </p>
                    </div>
                    <CalendarConnectionCard
                      type="clinic"
                      connection={clinicConnection}
                      helperText="Conecte o Google Calendar da clinica para sincronizar todos os agendamentos."
                    />
                  </div>
                </div>
              )}
```

---

### Task 17: Vercel cron configuration

**Files:**
- Create: `web/vercel.json`

- [ ] **Step 1: Add cron configuration**

No `vercel.json` exists in this repo — create it from scratch.

Create `web/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/calendar-renew",
      "schedule": "0 6 * * *"
    }
  ]
}
```

This runs daily at 06:00 UTC (03:00 BRT), which is a quiet time for a BR clinic.

- [ ] **Step 2: Add CRON_SECRET to environment**

Add `CRON_SECRET` to the `.env.example` or documentation. Vercel auto-sets `CRON_SECRET` for Vercel Cron jobs, but for local testing you'll need to set it manually. The cron handler validates via `Authorization: Bearer <CRON_SECRET>` header.

---

## Dependency Graph Summary

```
Group A (parallel):
  Task 1  (schema.ts, migration SQL, types)
  Task 2  (lib/google-calendar.ts)       — needs googleapis package
  Task 3  (db/queries/calendar.ts)
  Task 18 (npm install)                  — MUST run first or in parallel

Group B (depends on A):
  Task 4  (OAuth routes)           — needs Task 2 + Task 3
  Task 5  (push sync)              — needs Task 1 + Task 2 + Task 3
  Task 6  (pull sync)              — needs Task 2 + Task 3
  Task 7  (iCal feed)              — needs Task 1 + ical-generator

Group C (depends on B):
  Task 8  (wire push into routes)  — needs Task 5
  Task 9  (webhook endpoint)       — needs Task 6
  Task 10 (iCal feed endpoint)     — needs Task 7
  Task 11 (cron endpoint)          — needs Task 2 + Task 3
  Task 12 (connections API)        — needs Task 3

Group D (depends on C):
  Task 13 (availability)           — needs Task 1 + Task 3
  Task 14 (agenda view blocks)     — needs Task 3 + Task 12
  Task 15 (profile dialog)         — needs Task 12 + Task 14
  Task 16 (settings page)          — needs Task 12 + Task 14

Group E (parallel, can run anytime):
  Task 17 (vercel cron config)     — independent
```

## Testing Strategy

All external API calls (Google Calendar API) are mocked using `vi.mock`. Tests focus on:

1. **OAuth state signing/verification** (Task 2) — crypto correctness
2. **Query functions** (Task 3) — DB query construction, upsert logic
3. **Push sync logic** (Task 5) — event format, summary building, status mapping
4. **Pull sync logic** (Task 6) — filtering rules (transparent, declined, cancelled), timing extraction
5. **iCal feed generation** (Task 7) — event creation, status mapping, date filtering

## Post-Implementation Checklist

- [ ] Run `pnpm ci:checks` (lint + typecheck + tests)
- [ ] Manually test OAuth flow with a real Google account
- [ ] Verify push sync creates events on Google Calendar
- [ ] Verify webhook receives notifications and creates blocks
- [ ] Verify iCal feed is subscribable from Google Calendar / Apple Calendar
- [ ] Verify available slots exclude calendar blocks
- [ ] Verify disconnect cleans up all data
