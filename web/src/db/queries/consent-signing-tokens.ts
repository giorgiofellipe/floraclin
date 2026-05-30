import crypto from 'node:crypto'
import { db } from '@/db/client'
import { consentSigningTokens, patients, consentTemplates } from '@/db/schema'
import { eq, and, isNull, sql, inArray } from 'drizzle-orm'

const SIGNING_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export async function createSigningToken(
  tenantId: string,
  patientId: string,
  procedureRecordId: string,
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
    })
    .from(consentSigningTokens)
    .innerJoin(patients, eq(patients.id, consentSigningTokens.patientId))
    .where(
      and(
        eq(consentSigningTokens.token, token),
        isNull(consentSigningTokens.usedAt),
        sql`${consentSigningTokens.expiresAt} > now()`,
      ),
    )
    .limit(1)

  return row ?? null
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
        eq(consentTemplates.isActive, true),
      ),
    )
}
