import { db } from '@/db/client'
import { tenants, procedureTypes, consentTemplates } from '@/db/schema'
import { eq, and, isNull, asc, desc } from 'drizzle-orm'
import type { UpdateTenantInput, ProcedureTypeInput } from '@/validations/tenant'

export type Tenant = typeof tenants.$inferSelect
export type ProcedureType = typeof procedureTypes.$inferSelect
export type ConsentTemplate = typeof consentTemplates.$inferSelect

// ─── TENANT ─────────────────────────────────────────────────────────

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  return tenant ?? null
}

export async function updateTenant(
  tenantId: string,
  data: UpdateTenantInput
): Promise<Tenant | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) updateData.name = data.name
  if (data.phone !== undefined) updateData.phone = data.phone || null
  if (data.email !== undefined) updateData.email = data.email || null
  if (data.address !== undefined) updateData.address = data.address || null
  if (data.workingHours !== undefined) updateData.workingHours = data.workingHours
  if (data.settings !== undefined) updateData.settings = data.settings

  const [tenant] = await db
    .update(tenants)
    .set(updateData)
    .where(eq(tenants.id, tenantId))
    .returning()

  return tenant ?? null
}

export async function updateTenantSettings(
  tenantId: string,
  settings: Record<string, unknown>
): Promise<Tenant | null> {
  const existing = await getTenant(tenantId)
  if (!existing) return null

  const merged = { ...(existing.settings as Record<string, unknown> || {}), ...settings }

  const [tenant] = await db
    .update(tenants)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning()

  return tenant ?? null
}

// ─── PROCEDURE TYPES ────────────────────────────────────────────────

export async function listProcedureTypes(tenantId: string): Promise<ProcedureType[]> {
  return db
    .select()
    .from(procedureTypes)
    .where(
      and(
        eq(procedureTypes.tenantId, tenantId),
        isNull(procedureTypes.deletedAt)
      )
    )
    .orderBy(asc(procedureTypes.name))
}

export async function getProcedureType(
  tenantId: string,
  id: string
): Promise<ProcedureType | null> {
  const [pt] = await db
    .select()
    .from(procedureTypes)
    .where(
      and(
        eq(procedureTypes.id, id),
        eq(procedureTypes.tenantId, tenantId),
        isNull(procedureTypes.deletedAt)
      )
    )
    .limit(1)

  return pt ?? null
}

export async function createProcedureType(
  tenantId: string,
  data: ProcedureTypeInput
): Promise<ProcedureType> {
  const [pt] = await db
    .insert(procedureTypes)
    .values({
      tenantId,
      name: data.name,
      category: data.category,
      description: data.description || null,
      defaultPrice: data.defaultPrice || null,
      estimatedDurationMin: data.estimatedDurationMin ?? 60,
      isActive: data.isActive ?? true,
    })
    .returning()

  return pt
}

export async function updateProcedureType(
  tenantId: string,
  id: string,
  data: Partial<ProcedureTypeInput>
): Promise<ProcedureType | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) updateData.name = data.name
  if (data.category !== undefined) updateData.category = data.category
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.defaultPrice !== undefined) updateData.defaultPrice = data.defaultPrice || null
  if (data.estimatedDurationMin !== undefined) updateData.estimatedDurationMin = data.estimatedDurationMin
  if (data.isActive !== undefined) updateData.isActive = data.isActive

  const [pt] = await db
    .update(procedureTypes)
    .set(updateData)
    .where(
      and(
        eq(procedureTypes.id, id),
        eq(procedureTypes.tenantId, tenantId),
        isNull(procedureTypes.deletedAt)
      )
    )
    .returning()

  return pt ?? null
}

export async function deleteProcedureType(
  tenantId: string,
  id: string
): Promise<ProcedureType | null> {
  const [pt] = await db
    .update(procedureTypes)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(procedureTypes.id, id),
        eq(procedureTypes.tenantId, tenantId),
        isNull(procedureTypes.deletedAt)
      )
    )
    .returning()

  return pt ?? null
}

// ─── CONSENT TEMPLATES ──────────────────────────────────────────────

export async function listConsentTemplates(tenantId: string): Promise<ConsentTemplate[]> {
  return db
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.tenantId, tenantId))
    .orderBy(asc(consentTemplates.type), desc(consentTemplates.version))
}
