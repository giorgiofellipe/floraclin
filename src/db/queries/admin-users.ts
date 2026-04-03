import { db } from '@/db/client'
import { tenants, users, tenantUsers } from '@/db/schema'
import { eq, and, ilike, or, sql, desc, count } from 'drizzle-orm'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PaginatedResult } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

export type UserMembership = {
  tenantId: string
  tenantName: string
  role: string
  isActive: boolean
}

export type UserListItem = typeof users.$inferSelect & {
  memberships: UserMembership[]
}

// ─── List all users (platform admin) ────────────────────────────────

export async function listAllUsers(
  search = '',
  page = 1,
  limit = 20
): Promise<PaginatedResult<UserListItem>> {
  const offset = (page - 1) * limit

  const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const searchCondition = escaped
    ? or(
        ilike(users.fullName, `%${escaped}%`),
        ilike(users.email, `%${escaped}%`)
      )
    : undefined

  const whereCondition = searchCondition ?? undefined

  const [rawUsers, countResult] = await Promise.all([
    db
      .select()
      .from(users)
      .where(whereCondition)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereCondition),
  ])

  const total = countResult[0]?.count ?? 0

  // Batch-load memberships for the page of users
  const userIds = rawUsers.map((u) => u.id)

  const memberships =
    userIds.length > 0
      ? await db
          .select({
            userId: tenantUsers.userId,
            tenantId: tenantUsers.tenantId,
            tenantName: tenants.name,
            role: tenantUsers.role,
            isActive: tenantUsers.isActive,
          })
          .from(tenantUsers)
          .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
          .where(
            sql`${tenantUsers.userId} IN ${userIds}`
          )
      : []

  const membershipsByUser = new Map<string, UserMembership[]>()
  for (const m of memberships) {
    const list = membershipsByUser.get(m.userId) ?? []
    list.push({
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      role: m.role,
      isActive: m.isActive,
    })
    membershipsByUser.set(m.userId, list)
  }

  const data: UserListItem[] = rawUsers.map((u) => ({
    ...u,
    memberships: membershipsByUser.get(u.id) ?? [],
  }))

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

// ─── Create user with membership ────────────────────────────────────

export async function createUserWithMembership(data: {
  email: string
  fullName: string
  phone?: string
  tenantId: string
  role: string
}) {
  const admin = createAdminClient()

  // Check our DB first to find existing user (avoids fetching all Supabase users)
  const [existingDbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email.toLowerCase()))
    .limit(1)
  const existingAuthUser = existingDbUser ?? null

  let authUserId: string

  if (existingAuthUser) {
    authUserId = existingAuthUser.id
  } else {
    const { data: invited, error } =
      await admin.auth.admin.inviteUserByEmail(data.email)
    if (error || !invited.user) {
      throw new Error(`Falha ao convidar usuário: ${error?.message ?? 'unknown'}`)
    }
    authUserId = invited.user.id
  }

  // Upsert user row
  const [user] = await db
    .insert(users)
    .values({
      id: authUserId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        fullName: data.fullName,
        phone: data.phone ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  // Insert tenant_users (reactivate if already exists but inactive)
  await db
    .insert(tenantUsers)
    .values({
      tenantId: data.tenantId,
      userId: authUserId,
      role: data.role,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [tenantUsers.tenantId, tenantUsers.userId] as never,
      set: {
        role: data.role,
        isActive: true,
        updatedAt: new Date(),
      },
    })

  return user
}

// ─── Update user (admin) ────────────────────────────────────────────

export async function updateUserAdmin(
  userId: string,
  adminUserId: string,
  data: {
    fullName?: string
    phone?: string
    isPlatformAdmin?: boolean
  }
) {
  // Get current state for audit
  const [currentUser] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.fullName !== undefined) updateData.fullName = data.fullName
  if (data.phone !== undefined) updateData.phone = data.phone
  if (data.isPlatformAdmin !== undefined)
    updateData.isPlatformAdmin = data.isPlatformAdmin

  const [user] = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning()

  // Audit log for isPlatformAdmin changes
  if (data.isPlatformAdmin !== undefined && currentUser?.isPlatformAdmin !== data.isPlatformAdmin) {
    const { createAuditLog } = await import('@/lib/audit')
    await createAuditLog({
      tenantId: 'platform',
      userId: adminUserId,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      changes: {
        isPlatformAdmin: { old: currentUser?.isPlatformAdmin, new: data.isPlatformAdmin },
      },
    })
  }

  return user ?? null
}

// ─── Add user membership ────────────────────────────────────────────

export async function addUserMembership(
  userId: string,
  tenantId: string,
  role: string
) {
  // Check if membership exists (possibly inactive)
  const [existing] = await db
    .select()
    .from(tenantUsers)
    .where(
      and(eq(tenantUsers.userId, userId), eq(tenantUsers.tenantId, tenantId))
    )
    .limit(1)

  if (existing) {
    // Reactivate if inactive
    const [updated] = await db
      .update(tenantUsers)
      .set({ role, isActive: true, updatedAt: new Date() })
      .where(eq(tenantUsers.id, existing.id))
      .returning()
    return updated
  }

  const [membership] = await db
    .insert(tenantUsers)
    .values({
      tenantId,
      userId,
      role,
      isActive: true,
    })
    .returning()

  return membership
}

// ─── Remove user membership ─────────────────────────────────────────

export async function removeUserMembership(
  userId: string,
  tenantId: string
) {
  // Count active memberships
  const [result] = await db
    .select({ count: count() })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.isActive, true)))

  const activeCount = result?.count ?? 0

  if (activeCount <= 1) {
    throw new Error('Não é possível remover a última clínica do usuário')
  }

  const [membership] = await db
    .update(tenantUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(eq(tenantUsers.userId, userId), eq(tenantUsers.tenantId, tenantId))
    )
    .returning()

  return membership ?? null
}

// ─── Reset user password ────────────────────────────────────────────

export async function resetUserPassword(email: string) {
  const admin = createAdminClient()

  const { error } = await admin.auth.resetPasswordForEmail(email)

  if (error) {
    throw new Error(`Falha ao enviar e-mail de recuperação: ${error.message}`)
  }

  return { success: true }
}
