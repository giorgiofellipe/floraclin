import { db } from '@/db/client'
import { metaConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'

export type MetaConnection = typeof metaConnections.$inferSelect

/** A connection that finished both OAuth legs, so it has a dataset to post to. */
export type UsableMetaConnection = MetaConnection & { datasetId: string }

export interface UpsertMetaConnectionInput {
  datasetId: string | null
  accessToken: string
  connectionType: 'oauth' | 'manual'
  status?: 'active' | 'pending_dataset'
  businessId?: string | null
  tokenExpiresAt?: Date | null
  testEventCode?: string | null
  advancedMatchingEnabled?: boolean
}

/**
 * `pending_dataset` is excluded alongside `disabled`: the OAuth flow stores
 * the token before the owner picks a dataset, and a connection with no
 * dataset has nowhere to post. Callers must read this as "no connection" so
 * events are skipped instead of aimed at an empty id.
 */
export async function getMetaConnection(tenantId: string): Promise<UsableMetaConnection | null> {
  const connection = await getMetaConnectionRaw(tenantId)
  if (!connection) return null
  if (connection.status === 'disabled' || connection.status === 'pending_dataset') return null

  const { datasetId } = connection
  if (!datasetId) return null

  return { ...connection, datasetId }
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
      status: data.status ?? 'active',
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
        status: data.status ?? 'active',
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return connection
}

export interface UpdateMetaConnectionSettingsInput {
  datasetId: string
  advancedMatchingEnabled?: boolean
  testEventCode?: string | null
  /** Only leg 2 of the OAuth flow sets this, to flip `pending_dataset` to `active`. */
  status?: 'active'
}

/**
 * Settings-only update: leaves the stored credentials and the connection type
 * untouched, so an OAuth clinic can change these without pasting a token it
 * does not have. The status moves only when the caller asks for it.
 */
export async function updateMetaConnectionSettings(
  tenantId: string,
  data: UpdateMetaConnectionSettingsInput,
): Promise<MetaConnection | null> {
  const values: Partial<typeof metaConnections.$inferInsert> = {
    datasetId: data.datasetId,
    updatedAt: new Date(),
  }
  if (data.advancedMatchingEnabled !== undefined) {
    values.advancedMatchingEnabled = data.advancedMatchingEnabled
  }
  if (data.testEventCode !== undefined) {
    values.testEventCode = data.testEventCode
  }
  if (data.status !== undefined) {
    values.status = data.status
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
