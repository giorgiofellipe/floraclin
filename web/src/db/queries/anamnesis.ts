import { db } from '@/db/client'
import { anamneses, patients } from '@/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import { verifyTenantOwnership } from './helpers'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '@/lib/anamnesis/default-template'
import { STALE_ANAMNESIS_MESSAGE } from '@/lib/anamnesis/prepare-save'
import type { AnamnesisRecord, AnamnesisWrite } from '@/lib/anamnesis/types'
import type { FormResponses, FormSection } from '@/lib/forms/types'

export async function getAnamnesis(tenantId: string, patientId: string): Promise<AnamnesisRecord | null> {
  const [row] = await db
    .select({
      id: anamneses.id,
      patientId: anamneses.patientId,
      templateVersion: anamneses.templateVersion,
      templateSnapshot: anamneses.templateSnapshot,
      responses: anamneses.responses,
      updatedBy: anamneses.updatedBy,
      createdAt: anamneses.createdAt,
      updatedAt: anamneses.updatedAt,
    })
    .from(anamneses)
    .where(and(eq(anamneses.tenantId, tenantId), eq(anamneses.patientId, patientId)))
    .limit(1)

  if (!row) return null
  return {
    id: row.id,
    patientId: row.patientId,
    // Null only between the deploy and the post-deploy conversion run; 0034 makes these NOT NULL.
    templateVersion: row.templateVersion ?? DEFAULT_ANAMNESIS_TEMPLATE.version,
    templateSnapshot: (row.templateSnapshot as FormSection[] | null) ?? DEFAULT_ANAMNESIS_TEMPLATE.sections,
    responses: (row.responses as FormResponses | null) ?? {},
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class StaleDataError extends Error {
  constructor() {
    super(STALE_ANAMNESIS_MESSAGE)
    this.name = 'StaleDataError'
  }
}

export async function upsertAnamnesis(
  tenantId: string,
  patientId: string,
  userId: string,
  data: AnamnesisWrite,
  expectedUpdatedAt?: Date,
) {
  await verifyTenantOwnership(tenantId, patients, patientId, 'Patient')

  const existing = await getAnamnesis(tenantId, patientId)
  const content = {
    templateVersion: data.templateVersion,
    templateSnapshot: data.templateSnapshot,
    responses: data.responses,
    updatedBy: userId,
  }

  const [saved] = existing
    ? await db
        .update(anamneses)
        .set({ ...content, updatedAt: new Date() })
        .where(
          and(
            eq(anamneses.id, existing.id),
            eq(anamneses.tenantId, tenantId),
            // A legacy row not yet converted reads as {}; writing over it would lose its answers.
            isNotNull(anamneses.responses),
            // updated_at keeps microseconds; the client only ever saw the millisecond Date.
            expectedUpdatedAt
              ? sql`date_trunc('milliseconds', ${anamneses.updatedAt}) = ${expectedUpdatedAt.toISOString()}::timestamptz`
              : undefined,
          ),
        )
        .returning()
    : await db
        .insert(anamneses)
        .values({ tenantId, patientId, ...content })
        .onConflictDoNothing({ target: anamneses.patientId })
        .returning()
  if (!saved) throw new StaleDataError()

  return {
    id: saved.id,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
    templateVersion: data.templateVersion,
    templateSnapshot: data.templateSnapshot,
  }
}
