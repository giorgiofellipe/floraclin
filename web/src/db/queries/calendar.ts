import { db } from '@/db/client'
import { calendarConnections, calendarBlocks, appointments, users, tenantUsers } from '@/db/schema'
import { eq, and, or, isNull, inArray, gte, lte, ne, sql, type SQL } from 'drizzle-orm'
import { BusinessError } from '@/lib/errors'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

// ─── Calendar Connection Queries ────────────────────────────────────

/**
 * `access_token` and `refresh_token` are encrypted at rest. This module is the
 * only boundary that knows that: every caller reads and writes plaintext.
 *
 * The `CalendarConnectionRow` selects below never project either column, so
 * only the full-row reads and the `returning()` rows go through here.
 */
function withPlainTokens<T extends { accessToken: string; refreshToken: string }>(row: T): T {
  return {
    ...row,
    accessToken: decryptSecret(row.accessToken),
    refreshToken: decryptSecret(row.refreshToken),
  }
}

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
        accessToken: encryptSecret(data.accessToken),
        refreshToken: encryptSecret(data.refreshToken),
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

    return withPlainTokens(result)
  }

  const [result] = await db
    .insert(calendarConnections)
    .values({
      tenantId: data.tenantId,
      userId: data.userId,
      accessToken: encryptSecret(data.accessToken),
      refreshToken: encryptSecret(data.refreshToken),
      tokenExpiresAt: data.tokenExpiresAt,
      calendarId: data.calendarId ?? 'primary',
      feedToken: data.feedToken,
      channelId: data.channelId ?? null,
      channelResourceId: data.channelResourceId ?? null,
      channelExpiry: data.channelExpiry ?? null,
      syncToken: data.syncToken ?? null,
    })
    .returning()

  return withPlainTokens(result)
}

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
      ...(data.accessToken !== undefined && { accessToken: encryptSecret(data.accessToken) }),
      ...(data.refreshToken !== undefined && { refreshToken: encryptSecret(data.refreshToken) }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(calendarConnections.id, connectionId),
        eq(calendarConnections.tenantId, tenantId)
      )
    )
    .returning()

  return result ? withPlainTokens(result) : null
}

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

  return result ? withPlainTokens(result) : null
}

export async function getConnectionById(connectionId: string) {
  const [result] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1)

  return result ? withPlainTokens(result) : null
}

export async function getConnectionByChannelId(
  channelId: string
) {
  const [result] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.channelId, channelId))
    .limit(1)

  return result ? withPlainTokens(result) : null
}

export async function getConnectionByFeedToken(
  feedToken: string
) {
  const [result] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.feedToken, feedToken))
    .limit(1)

  return result ? withPlainTokens(result) : null
}

export async function getExpiringConnections(withinHours: number = 48) {
  const threshold = new Date(Date.now() + withinHours * 60 * 60 * 1000)

  const rows = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.enabled, true),
        lte(calendarConnections.channelExpiry, threshold),
        sql`${calendarConnections.channelId} IS NOT NULL`
      )
    )

  return rows.map(withPlainTokens)
}

// ─── Calendar Block Queries ─────────────────────────────────────────

export type CalendarBlockSource = 'google' | 'manual'

export interface CalendarBlockRow {
  id: string
  tenantId: string
  practitionerId: string | null
  practitionerName: string | null
  source: CalendarBlockSource
  title: string | null
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  status: string
}

export async function listBlocksForDateRange(
  tenantId: string,
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
): Promise<CalendarBlockRow[]> {
  const conditions: (SQL | undefined)[] = [
    eq(calendarBlocks.tenantId, tenantId),
    gte(calendarBlocks.date, dateFrom),
    lte(calendarBlocks.date, dateTo),
    ne(calendarBlocks.status, 'cancelled'),
  ]

  if (practitionerId) {
    conditions.push(or(eq(calendarBlocks.practitionerId, practitionerId), isNull(calendarBlocks.practitionerId)))
  }

  return db
    .select({
      id: calendarBlocks.id,
      tenantId: calendarBlocks.tenantId,
      practitionerId: calendarBlocks.practitionerId,
      practitionerName: users.fullName,
      source: calendarBlocks.source,
      title: calendarBlocks.title,
      date: calendarBlocks.date,
      startTime: calendarBlocks.startTime,
      endTime: calendarBlocks.endTime,
      allDay: calendarBlocks.allDay,
      status: calendarBlocks.status,
    })
    .from(calendarBlocks)
    .leftJoin(users, eq(calendarBlocks.practitionerId, users.id))
    .where(and(...conditions))
    .orderBy(calendarBlocks.date, calendarBlocks.startTime)
}

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
    .values({ ...data, source: 'google' })
    .returning()

  return result
}

async function assertClinicalMember(tenantId: string, userId: string) {
  const [member] = await db
    .select({ id: tenantUsers.userId })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.isActive, true),
        isNull(users.deletedAt),
        inArray(tenantUsers.role, ['practitioner', 'owner'])
      )
    )
    .limit(1)

  if (!member) throw new BusinessError('PRACTITIONER_NOT_FOUND', 'Profissional não encontrado')
}

export async function createManualBlock(
  tenantId: string,
  data: {
    practitionerId: string | null
    title: string | null
    date: string
    startTime: string | null
    endTime: string | null
    allDay: boolean
  }
): Promise<{ id: string }> {
  if (data.practitionerId) await assertClinicalMember(tenantId, data.practitionerId)

  const [row] = await db
    .insert(calendarBlocks)
    .values({ tenantId, source: 'manual', connectionId: null, googleEventId: null, ...data })
    .returning({ id: calendarBlocks.id })

  return row
}

export async function getBlockById(
  tenantId: string,
  blockId: string
) {
  const [row] = await db
    .select({
      id: calendarBlocks.id,
      practitionerId: calendarBlocks.practitionerId,
      source: calendarBlocks.source,
      title: calendarBlocks.title,
      date: calendarBlocks.date,
      startTime: calendarBlocks.startTime,
      endTime: calendarBlocks.endTime,
      allDay: calendarBlocks.allDay,
    })
    .from(calendarBlocks)
    .where(and(eq(calendarBlocks.id, blockId), eq(calendarBlocks.tenantId, tenantId)))
    .limit(1)

  return row ?? null
}

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

export async function deleteBlockById(
  tenantId: string,
  blockId: string
) {
  const [result] = await db
    .delete(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.id, blockId),
        eq(calendarBlocks.tenantId, tenantId)
      )
    )
    .returning()

  return result ?? null
}

export async function deleteBlocksByConnection(connectionId: string) {
  return db
    .delete(calendarBlocks)
    .where(eq(calendarBlocks.connectionId, connectionId))
}

export async function clearAppointmentGoogleEventIds(
  tenantId: string,
  userId: string | null
) {
  if (userId) {
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
