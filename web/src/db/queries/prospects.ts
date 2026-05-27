import { db } from '@/db/client'
import { prospects, prospectActivities, prospectProcedureTypes, procedureTypes, whatsappConversations, users } from '@/db/schema'
import { eq, and, or, desc, ilike, isNull, sql, inArray } from 'drizzle-orm'
import { normalizeBrPhone } from '@/lib/phone'
import type { ProspectStage } from '@/validations/prospect'

export type Prospect = typeof prospects.$inferSelect

export async function createProspect(
  tenantId: string,
  data: { phone: string; name?: string | null; source?: string },
): Promise<Prospect> {
  const [prospect] = await db
    .insert(prospects)
    .values({
      tenantId,
      phone: normalizeBrPhone(data.phone),
      name: data.name ?? null,
      source: data.source ?? 'whatsapp',
    })
    .onConflictDoUpdate({
      target: [prospects.tenantId, prospects.phone] as never,
      set: {
        name: data.name ?? sql`${prospects.name}`,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return prospect
}

export async function createNewProspect(
  tenantId: string,
  data: { phone: string; name?: string | null; source?: string },
): Promise<Prospect> {
  const [prospect] = await db
    .insert(prospects)
    .values({
      tenantId,
      phone: normalizeBrPhone(data.phone),
      name: data.name ?? null,
      source: data.source ?? 'whatsapp',
    })
    .returning()

  return prospect
}

export async function getProspect(tenantId: string, prospectId: string): Promise<Prospect | null> {
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(
      and(
        eq(prospects.id, prospectId),
        eq(prospects.tenantId, tenantId),
        isNull(prospects.deletedAt),
      ),
    )
    .limit(1)

  return prospect ?? null
}

export async function getProspectByPhone(tenantId: string, phone: string): Promise<Prospect | null> {
  const normalized = normalizeBrPhone(phone)
  const rows = await db
    .select()
    .from(prospects)
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        eq(prospects.phone, normalized),
        isNull(prospects.deletedAt),
      ),
    )
    .orderBy(desc(prospects.createdAt))

  if (rows.length === 0) return null
  return rows.find((p) => p.stage !== 'convertido' && p.stage !== 'perdido') ?? rows[0]
}

export async function listProspects(
  tenantId: string,
  opts: { stage?: ProspectStage; search?: string; assignedUserId?: string } = {},
): Promise<Prospect[]> {
  const { stage, search, assignedUserId } = opts

  const baseConditions = [
    eq(prospects.tenantId, tenantId),
    isNull(prospects.deletedAt),
  ]

  if (stage) {
    baseConditions.push(eq(prospects.stage, stage))
  }

  if (assignedUserId) {
    baseConditions.push(eq(prospects.assignedUserId, assignedUserId))
  }

  const escaped = (search ?? '').trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const searchCondition = escaped
    ? or(
        ilike(prospects.name, `%${escaped}%`),
        ilike(prospects.phone, `%${escaped}%`),
      )
    : undefined

  const whereConditions = searchCondition
    ? and(...baseConditions, searchCondition)
    : and(...baseConditions)

  return db
    .select()
    .from(prospects)
    .where(whereConditions)
    .orderBy(desc(prospects.createdAt))
}

export async function updateProspect(
  tenantId: string,
  prospectId: string,
  data: Partial<{
    name: string | null
    stage: string
    intent: string | null
    sentiment: string | null
    aiTags: unknown
    value: string | null
    assignedUserId: string | null
    notes: string | null
    lostReason: string | null
  }>,
): Promise<Prospect | null> {
  const [updated] = await db
    .update(prospects)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(prospects.id, prospectId),
        eq(prospects.tenantId, tenantId),
        isNull(prospects.deletedAt),
      ),
    )
    .returning()

  return updated ?? null
}

export async function softDeleteProspect(tenantId: string, prospectId: string): Promise<Prospect | null> {
  const [deleted] = await db
    .update(prospects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(prospects.id, prospectId),
        eq(prospects.tenantId, tenantId),
        isNull(prospects.deletedAt),
      ),
    )
    .returning()

  return deleted ?? null
}

export async function convertProspect(
  tenantId: string,
  prospectId: string,
  patientId: string,
): Promise<Prospect | null> {
  const [updated] = await db
    .update(prospects)
    .set({
      convertedPatientId: patientId,
      stage: 'convertido',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(prospects.id, prospectId),
        eq(prospects.tenantId, tenantId),
      ),
    )
    .returning()

  // Also update the conversation FK to point to the patient
  if (updated) {
    await db
      .update(whatsappConversations)
      .set({ patientId, updatedAt: new Date() })
      .where(
        and(
          eq(whatsappConversations.tenantId, tenantId),
          eq(whatsappConversations.prospectId, prospectId),
        ),
      )
  }

  return updated ?? null
}

export async function getProspectStats(tenantId: string): Promise<Record<string, number>> {
  const results = await db
    .select({
      stage: prospects.stage,
      count: sql<number>`count(*)::int`,
    })
    .from(prospects)
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        isNull(prospects.deletedAt),
      ),
    )
    .groupBy(prospects.stage)

  const stats: Record<string, number> = {
    novo: 0,
    contatado: 0,
    qualificado: 0,
    agendado: 0,
    convertido: 0,
    perdido: 0,
  }

  for (const row of results) {
    stats[row.stage] = row.count
  }

  return stats
}

// ─── PROSPECT ↔ PROCEDURE TYPES ───────────────────────────────────

export async function getProspectProcedures(
  prospectId: string,
): Promise<{ id: string; name: string; defaultPrice: string | null }[]> {
  return db
    .select({
      id: procedureTypes.id,
      name: procedureTypes.name,
      defaultPrice: procedureTypes.defaultPrice,
    })
    .from(prospectProcedureTypes)
    .innerJoin(procedureTypes, eq(prospectProcedureTypes.procedureTypeId, procedureTypes.id))
    .where(eq(prospectProcedureTypes.prospectId, prospectId))
}

export async function setProspectProcedures(
  tenantId: string,
  prospectId: string,
  procedureTypeIds: string[],
) {
  await db
    .delete(prospectProcedureTypes)
    .where(eq(prospectProcedureTypes.prospectId, prospectId))

  if (procedureTypeIds.length > 0) {
    await db.insert(prospectProcedureTypes).values(
      procedureTypeIds.map((procedureTypeId) => ({
        tenantId,
        prospectId,
        procedureTypeId,
      })),
    )
  }
}

export async function getProspectProceduresBatch(
  prospectIds: string[],
): Promise<Record<string, { id: string; name: string; defaultPrice: string | null }[]>> {
  if (prospectIds.length === 0) return {}

  const rows = await db
    .select({
      prospectId: prospectProcedureTypes.prospectId,
      id: procedureTypes.id,
      name: procedureTypes.name,
      defaultPrice: procedureTypes.defaultPrice,
    })
    .from(prospectProcedureTypes)
    .innerJoin(procedureTypes, eq(prospectProcedureTypes.procedureTypeId, procedureTypes.id))
    .where(inArray(prospectProcedureTypes.prospectId, prospectIds))

  const result: Record<string, { id: string; name: string; defaultPrice: string | null }[]> = {}
  for (const row of rows) {
    if (!result[row.prospectId]) result[row.prospectId] = []
    result[row.prospectId].push({ id: row.id, name: row.name, defaultPrice: row.defaultPrice })
  }
  return result
}

// ─── ACTIVITY LOG ──────────────────────────────────────────────────

export type ProspectActivity = typeof prospectActivities.$inferSelect & {
  performedByName?: string | null
}

export async function logProspectActivity(
  tenantId: string,
  prospectId: string,
  action: string,
  details?: Record<string, unknown> | null,
  performedBy?: string | null,
) {
  await db.insert(prospectActivities).values({
    tenantId,
    prospectId,
    action,
    details: details ?? null,
    performedBy: performedBy ?? null,
  })
}

export async function getProspectActivities(
  tenantId: string,
  prospectId: string,
): Promise<ProspectActivity[]> {
  const rows = await db
    .select({
      id: prospectActivities.id,
      tenantId: prospectActivities.tenantId,
      prospectId: prospectActivities.prospectId,
      action: prospectActivities.action,
      details: prospectActivities.details,
      performedBy: prospectActivities.performedBy,
      createdAt: prospectActivities.createdAt,
      performedByName: users.fullName,
    })
    .from(prospectActivities)
    .leftJoin(users, eq(prospectActivities.performedBy, users.id))
    .where(
      and(
        eq(prospectActivities.tenantId, tenantId),
        eq(prospectActivities.prospectId, prospectId),
      ),
    )
    .orderBy(desc(prospectActivities.createdAt))

  return rows
}
