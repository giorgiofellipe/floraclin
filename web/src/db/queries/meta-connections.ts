import { db } from '@/db/client'
import { metaConnections } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

export type MetaConnection = typeof metaConnections.$inferSelect

/**
 * `access_token` is encrypted at rest. This module is the only boundary that
 * knows that: every caller reads and writes plaintext.
 */
function withPlainToken<T extends { accessToken: string }>(row: T): T {
  return { ...row, accessToken: decryptSecret(row.accessToken) }
}

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

  return row ? withPlainToken(row) : null
}

/**
 * Every connection whose token can read the Marketing API.
 *
 * Exists so the ad-metadata backfill in the meta-events cron does not select
 * the table directly: a raw select hands back the ciphertext, and Meta answers
 * every request with it as a plain auth failure.
 */
export async function listActiveOAuthConnections(): Promise<MetaConnection[]> {
  const rows = await db
    .select()
    .from(metaConnections)
    .where(and(eq(metaConnections.connectionType, 'oauth'), eq(metaConnections.status, 'active')))

  return rows.map(withPlainToken)
}

export async function upsertMetaConnection(
  tenantId: string,
  data: UpsertMetaConnectionInput,
): Promise<MetaConnection> {
  const accessToken = encryptSecret(data.accessToken)

  // Only what the caller supplied. An omitted column keeps the value the row
  // already holds: re-authorizing an expired OAuth token used to reset
  // `advancedMatchingEnabled` to true and blank `testEventCode` and
  // `businessId`, so a clinic that had deliberately turned off sending hashed
  // patient data got it turned back on by reconnecting.
  const supplied: Partial<typeof metaConnections.$inferInsert> = {}
  if (data.businessId !== undefined) supplied.businessId = data.businessId
  if (data.testEventCode !== undefined) supplied.testEventCode = data.testEventCode
  if (data.advancedMatchingEnabled !== undefined) {
    supplied.advancedMatchingEnabled = data.advancedMatchingEnabled
  }

  const [connection] = await db
    .insert(metaConnections)
    .values({
      tenantId,
      datasetId: data.datasetId,
      accessToken,
      connectionType: data.connectionType,
      ...supplied,
      // Describes the token being written, so it travels with it rather than
      // surviving from whatever token the row held before.
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      status: data.status ?? 'active',
    })
    .onConflictDoUpdate({
      target: metaConnections.tenantId,
      set: {
        datasetId: data.datasetId,
        accessToken,
        connectionType: data.connectionType,
        ...supplied,
        tokenExpiresAt: data.tokenExpiresAt ?? null,
        // Re-pasting a token is how a clinic recovers from an expired one.
        status: data.status ?? 'active',
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return withPlainToken(connection)
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

  return connection ? withPlainToken(connection) : null
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
