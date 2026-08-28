import { db } from '@/db/client'
import { metaConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

export type MetaConnection = typeof metaConnections.$inferSelect

export interface UpsertMetaConnectionInput {
  datasetId: string
  accessToken: string
  connectionType: 'oauth' | 'manual'
  businessId?: string | null
  tokenExpiresAt?: Date | null
  testEventCode?: string | null
  advancedMatchingEnabled?: boolean
}

export async function getMetaConnection(tenantId: string): Promise<MetaConnection | null> {
  const connection = await getMetaConnectionRaw(tenantId)
  if (!connection || connection.status === 'disabled') return null
  return connection
}

export async function getMetaConnectionRaw(tenantId: string): Promise<MetaConnection | null> {
  const [row] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.tenantId, tenantId))
    .limit(1)

  return row ?? null
}

export async function upsertMetaConnection(
  tenantId: string,
  data: UpsertMetaConnectionInput,
): Promise<MetaConnection> {
  const [connection] = await db
    .insert(metaConnections)
    .values({
      tenantId,
      datasetId: data.datasetId,
      accessToken: data.accessToken,
      connectionType: data.connectionType,
      businessId: data.businessId ?? null,
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      testEventCode: data.testEventCode ?? null,
      advancedMatchingEnabled: data.advancedMatchingEnabled ?? true,
    })
    .onConflictDoUpdate({
      target: metaConnections.tenantId,
      set: {
        datasetId: data.datasetId,
        accessToken: data.accessToken,
        connectionType: data.connectionType,
        businessId: data.businessId ?? null,
        tokenExpiresAt: data.tokenExpiresAt ?? null,
        testEventCode: data.testEventCode ?? null,
        advancedMatchingEnabled: data.advancedMatchingEnabled ?? true,
        // Re-pasting a token is how a clinic recovers from an expired one.
        status: 'active',
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return connection
}

export interface UpdateMetaConnectionSettingsInput {
  advancedMatchingEnabled?: boolean
  testEventCode?: string | null
}

/**
 * Settings-only update: leaves the stored credentials, the connection type and
 * the status untouched, so an OAuth clinic can change these without pasting a
 * token it does not have.
 */
export async function updateMetaConnectionSettings(
  tenantId: string,
  data: UpdateMetaConnectionSettingsInput,
): Promise<MetaConnection | null> {
  const values: Partial<typeof metaConnections.$inferInsert> = { updatedAt: new Date() }
  if (data.advancedMatchingEnabled !== undefined) {
    values.advancedMatchingEnabled = data.advancedMatchingEnabled
  }
  if (data.testEventCode !== undefined) {
    values.testEventCode = data.testEventCode
  }

  const [connection] = await db
    .update(metaConnections)
    .set(values)
    .where(eq(metaConnections.tenantId, tenantId))
    .returning()

  return connection ?? null
}

export async function markConnectionInvalid(tenantId: string, message: string): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      status: 'invalid_token',
      lastError: message,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.tenantId, tenantId))
}

export async function markConnectionVerified(tenantId: string): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.tenantId, tenantId))
}

export async function deleteMetaConnection(tenantId: string): Promise<void> {
  await db.delete(metaConnections).where(eq(metaConnections.tenantId, tenantId))
}

export async function recordAcknowledgement(
  tenantId: string,
  userId: string,
  version: string,
): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
      acknowledgementVersion: version,
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.tenantId, tenantId))
}
