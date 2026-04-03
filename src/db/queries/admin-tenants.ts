import { db } from '@/db/client'
import { tenants, users, tenantUsers, patients, financialEntries } from '@/db/schema'
import { eq, and, ilike, or, sql, desc, isNull } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PaginatedResult } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

export type TenantListItem = typeof tenants.$inferSelect & {
  userCount: number
  patientCount: number
}

export type TenantDetail = typeof tenants.$inferSelect & {
  userCount: number
  patientCount: number
  financialEntryCount: number
  members: {
    id: string
    userId: string
    fullName: string
    email: string
    role: string
    isActive: boolean
  }[]
}

// ─── List all tenants (platform admin) ──────────────────────────────

export async function listAllTenants(
  search = '',
  page = 1,
  limit = 20
): Promise<PaginatedResult<TenantListItem>> {
  const offset = (page - 1) * limit

  const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const searchCondition = escaped
    ? or(
        ilike(tenants.name, `%${escaped}%`),
        ilike(tenants.slug, `%${escaped}%`)
      )
    : undefined

  const whereCondition = searchCondition
    ? and(isNull(tenants.deletedAt), searchCondition)
    : isNull(tenants.deletedAt)

  const userCountSq = sql<number>`(
    SELECT COUNT(*)::int FROM floraclin.tenant_users
    WHERE tenant_id = ${tenants.id} AND is_active = true
  )`.as('user_count')

  const patientCountSq = sql<number>`(
    SELECT COUNT(*)::int FROM floraclin.patients
    WHERE tenant_id = ${tenants.id} AND deleted_at IS NULL
  )`.as('patient_count')

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        logoUrl: tenants.logoUrl,
        phone: tenants.phone,
        email: tenants.email,
        address: tenants.address,
        workingHours: tenants.workingHours,
        settings: tenants.settings,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        deletedAt: tenants.deletedAt,
        userCount: userCountSq,
        patientCount: patientCountSq,
      })
      .from(tenants)
      .where(whereCondition)
      .orderBy(desc(tenants.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenants)
      .where(whereCondition),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    data: data as TenantListItem[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

// ─── Create tenant with owner ───────────────────────────────────────

export async function createTenantWithOwner(data: {
  name: string
  slug?: string
  ownerEmail: string
  ownerName: string
}) {
  const slug =
    data.slug ||
    data.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

  return withTransaction(async (tx) => {
    // 1. Get or create user in Supabase Auth
    const admin = createAdminClient()

    // Filter by email to avoid fetching all users
    const { data: listData } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    })
    // listUsers doesn't support email filter directly — check our DB first
    const [existingDbUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.ownerEmail.toLowerCase()))
      .limit(1)
    const existingAuthUser = existingDbUser
      ? listData?.users?.find((u) => u.id === existingDbUser.id)
      : null

    let authUserId: string

    if (existingAuthUser) {
      authUserId = existingAuthUser.id
    } else {
      const { data: invited, error } =
        await admin.auth.admin.inviteUserByEmail(data.ownerEmail)
      if (error || !invited.user) {
        throw new Error(`Falha ao convidar usuário: ${error?.message ?? 'unknown'}`)
      }
      authUserId = invited.user.id
    }

    // 2. Upsert user row
    await tx
      .insert(users)
      .values({
        id: authUserId,
        fullName: data.ownerName,
        email: data.ownerEmail,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          fullName: data.ownerName,
          updatedAt: new Date(),
        },
      })

    // 3. Insert tenant
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: data.name,
        slug,
      })
      .returning()

    // 4. Insert tenant_users (owner)
    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: authUserId,
      role: 'owner',
      isActive: true,
    })

    return tenant
  })
}

// ─── Update tenant (admin) ──────────────────────────────────────────

export async function updateTenantAdmin(
  tenantId: string,
  data: {
    name?: string
    slug?: string
    settings?: Record<string, unknown>
    isActive?: boolean
  }
) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) updateData.name = data.name
  if (data.slug !== undefined) updateData.slug = data.slug
  if (data.settings !== undefined) updateData.settings = data.settings
  if (data.isActive !== undefined) {
    updateData.deletedAt = data.isActive ? null : new Date()
  }

  const [tenant] = await db
    .update(tenants)
    .set(updateData)
    .where(eq(tenants.id, tenantId))
    .returning()

  return tenant ?? null
}

// ─── Get tenant detail ──────────────────────────────────────────────

export async function getTenantDetail(
  tenantId: string
): Promise<TenantDetail | null> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  if (!tenant) return null

  const [members, patientCountResult, financialCountResult] = await Promise.all([
    db
      .select({
        id: tenantUsers.id,
        userId: tenantUsers.userId,
        fullName: users.fullName,
        email: users.email,
        role: tenantUsers.role,
        isActive: tenantUsers.isActive,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(tenantUsers.userId, users.id))
      .where(eq(tenantUsers.tenantId, tenantId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(patients)
      .where(
        and(eq(patients.tenantId, tenantId), isNull(patients.deletedAt))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          isNull(financialEntries.deletedAt)
        )
      ),
  ])

  return {
    ...tenant,
    userCount: members.length,
    patientCount: patientCountResult[0]?.count ?? 0,
    financialEntryCount: financialCountResult[0]?.count ?? 0,
    members,
  }
}
