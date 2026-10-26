import crypto from 'node:crypto'
import { db } from '@/db/client'
import { consentSigningTokens, consentAcceptances, patients, consentTemplates, tenants } from '@/db/schema'
import { eq, and, isNull, sql, inArray } from 'drizzle-orm'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'

const SIGNING_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export async function createSigningToken(
  tenantId: string,
  patientId: string,
  procedureRecordId: string | null,
  consentTemplateIds: string[],
  createdBy: string,
  renderedContents?: Record<string, string>,
) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SIGNING_TOKEN_TTL_MS)

  const [row] = await db
    .insert(consentSigningTokens)
    .values({
      token,
      tenantId,
      patientId,
      procedureRecordId,
      consentTemplateIds,
      renderedContents: renderedContents ?? null,
      expiresAt,
      createdBy,
    })
    .returning()

  return row
}

export async function getValidSigningToken(token: string) {
  const [row] = await db
    .select({
      id: consentSigningTokens.id,
      token: consentSigningTokens.token,
      tenantId: consentSigningTokens.tenantId,
      patientId: consentSigningTokens.patientId,
      procedureRecordId: consentSigningTokens.procedureRecordId,
      consentTemplateIds: consentSigningTokens.consentTemplateIds,
      renderedContents: consentSigningTokens.renderedContents,
      expiresAt: consentSigningTokens.expiresAt,
      createdBy: consentSigningTokens.createdBy,
      patientName: patients.fullName,
      tenantSettings: tenants.settings,
    })
    .from(consentSigningTokens)
    .innerJoin(patients, eq(patients.id, consentSigningTokens.patientId))
    .innerJoin(tenants, eq(tenants.id, consentSigningTokens.tenantId))
    .where(
      and(
        eq(consentSigningTokens.token, token),
        isNull(consentSigningTokens.usedAt),
        sql`${consentSigningTokens.expiresAt} > now()`,
      ),
    )
    .limit(1)

  if (!row) return null
  const { tenantSettings, ...signingToken } = row
  return { ...signingToken, whatsappEnabled: isWhatsAppEnabled(tenantSettings as Record<string, unknown> | null) }
}

export async function markSigningTokenUsed(token: string, tx?: typeof db) {
  const target = tx ?? db
  const [row] = await target
    .update(consentSigningTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(consentSigningTokens.token, token),
        isNull(consentSigningTokens.usedAt),
        sql`${consentSigningTokens.expiresAt} > now()`,
      ),
    )
    .returning()

  return row ?? null
}

export async function getRecentlyUsedSigningToken(token: string) {
  const [row] = await db
    .select({
      id: consentSigningTokens.id,
      tenantId: consentSigningTokens.tenantId,
      usedAt: consentSigningTokens.usedAt,
      expiresAt: consentSigningTokens.expiresAt,
    })
    .from(consentSigningTokens)
    .where(eq(consentSigningTokens.token, token))
    .limit(1)

  if (!row || !row.usedAt) return null

  const deadline = new Date(row.usedAt.getTime() + 60 * 60 * 1000)
  if (new Date() > deadline) return null

  return row
}

/**
 * One patient copy per acceptance, and only for acceptances this token signed.
 * Returns null when the acceptance is not this token's.
 */
export async function claimPatientCopy(
  acceptanceId: string,
  signingTokenId: string,
): Promise<{ tenantId: string; alreadySent: boolean } | null> {
  const ownAcceptance = and(
    eq(consentAcceptances.id, acceptanceId),
    eq(consentAcceptances.signingTokenId, signingTokenId),
  )

  const [claimed] = await db
    .update(consentAcceptances)
    .set({ patientCopySentAt: new Date() })
    .where(and(ownAcceptance, isNull(consentAcceptances.patientCopySentAt)))
    .returning({ tenantId: consentAcceptances.tenantId })
  if (claimed) return { tenantId: claimed.tenantId, alreadySent: false }

  const [sent] = await db
    .select({ tenantId: consentAcceptances.tenantId })
    .from(consentAcceptances)
    .where(ownAcceptance)
    .limit(1)
  return sent ? { tenantId: sent.tenantId, alreadySent: true } : null
}

export async function releasePatientCopy(acceptanceId: string) {
  await db
    .update(consentAcceptances)
    .set({ patientCopySentAt: null })
    .where(eq(consentAcceptances.id, acceptanceId))
}

export async function getTemplatesForToken(tenantId: string, templateIds: string[]) {
  return db
    .select({
      id: consentTemplates.id,
      type: consentTemplates.type,
      title: consentTemplates.title,
      content: consentTemplates.content,
      version: consentTemplates.version,
    })
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        inArray(consentTemplates.id, templateIds),
      ),
    )
}
