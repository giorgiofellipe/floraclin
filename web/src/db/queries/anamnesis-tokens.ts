import { db } from '@/db/client'
import { anamnesisTokens, patients } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { verifyTenantOwnership } from './helpers'

export async function createAnamnesisToken(tenantId: string, patientId: string, createdBy: string) {
  await verifyTenantOwnership(tenantId, patients, patientId, 'Patient')

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours

  const [token] = await db
    .insert(anamnesisTokens)
    .values({ patientId, tenantId, expiresAt, createdBy })
    .returning()

  return token
}

export async function getValidToken(token: string) {
  const [row] = await db
    .select({
      id: anamnesisTokens.id,
      token: anamnesisTokens.token,
      patientId: anamnesisTokens.patientId,
      tenantId: anamnesisTokens.tenantId,
      createdBy: anamnesisTokens.createdBy,
      expiresAt: anamnesisTokens.expiresAt,
      usedAt: anamnesisTokens.usedAt,
      patientName: patients.fullName,
    })
    .from(anamnesisTokens)
    .innerJoin(
      patients,
      and(
        eq(patients.id, anamnesisTokens.patientId),
        eq(patients.tenantId, anamnesisTokens.tenantId),
        isNull(patients.deletedAt)
      )
    )
    .where(
      and(
        eq(anamnesisTokens.token, token),
        isNull(anamnesisTokens.usedAt),
        sql`${anamnesisTokens.expiresAt} > now()`
      )
    )
    .limit(1)

  return row ?? null
}

export async function markTokenUsed(token: string) {
  const [row] = await db
    .update(anamnesisTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(anamnesisTokens.token, token),
        isNull(anamnesisTokens.usedAt),
        sql`${anamnesisTokens.expiresAt} > now()`
      )
    )
    .returning()

  return row ?? null
}
