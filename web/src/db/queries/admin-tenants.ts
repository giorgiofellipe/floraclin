import { db } from '@/db/client'
import { tenants, users, tenantUsers, patients, financialEntries, plans } from '@/db/schema'
import { eq, and, ilike, or, sql, desc, isNull } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { sendInviteEmail } from '@/lib/email'
import { createSubscription } from '@/db/queries/subscriptions'
import { notifyDiscord } from '@/lib/discord'
import type { PaginatedResult } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

export type TenantListItem = typeof tenants.$inferSelect & {
  isActive: boolean
  userCount: number
  patientCount: number
}

export type TenantDetail = typeof tenants.$inferSelect & {
  isActive: boolean
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

  const whereCondition = searchCondition ?? undefined

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
        status: tenants.status,
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
    data: data.map((t) => ({ ...t, isActive: !t.deletedAt })) as TenantListItem[],
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

  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/login`

  const tenant = await withTransaction(async (tx) => {
    // 1. Check if user already exists in our DB
    const [existingDbUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.ownerEmail.toLowerCase()))
      .limit(1)

    let userId: string

    if (existingDbUser) {
      userId = existingDbUser.id
    } else {
      // New user — generate UUID and insert directly (no password; they'll use magic link)
      userId = crypto.randomUUID()

      await tx.insert(users).values({
        id: userId,
        fullName: data.ownerName,
        email: data.ownerEmail.toLowerCase(),
      })
    }

    // 2. Update user name if they already existed
    if (existingDbUser) {
      await tx
        .update(users)
        .set({
          fullName: data.ownerName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
    }

    // 3. Insert tenant
    const [t] = await tx
      .insert(tenants)
      .values({
        name: data.name,
        slug,
      })
      .returning()

    // 4. Insert tenant_users (owner)
    await tx.insert(tenantUsers).values({
      tenantId: t.id,
      userId,
      role: 'owner',
      isActive: true,
    })

    // 5. Send invite email (outside transaction is fine — fire-and-forget)
    sendInviteEmail(data.ownerEmail, loginUrl, data.name).catch(() => {
      // Email delivery failure should not break tenant creation
    })

    return t
  })

  const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
  if (freePlan) {
    const { created } = await createSubscription(tenant.id, freePlan.id)
    if (created) {
      await notifyDiscord({
        kind: 'subscription.created',
        tenantName: tenant.name,
        planName: freePlan.name,
        priceCents: freePlan.priceCents,
        tenantId: tenant.id,
      })
    }
  }

  return tenant
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
    isActive: !tenant.deletedAt,
    userCount: members.length,
    patientCount: patientCountResult[0]?.count ?? 0,
    financialEntryCount: financialCountResult[0]?.count ?? 0,
    members,
  }
}

// ─── Self-signup & approval ────────────────────────────────────────

export function generateSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'clinica'
}

export async function createSelfSignupTenant(data: {
  userId: string
  clinicName: string
  phone: string
}) {
  const baseSlug = generateSlug(data.clinicName)

  return withTransaction(async (tx) => {
    let slug = baseSlug
    let attempt = 0

    for (;;) {
      const [existing] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1)

      if (!existing) break

      attempt++
      slug = `${baseSlug}-${attempt}`
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: data.clinicName,
        slug,
        status: 'pending_approval',
        phone: data.phone,
      })
      .returning()

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: data.userId,
      role: 'owner',
      isActive: true,
    })

    return tenant
  })
}

export async function listTenantsByStatus(status?: string) {
  const conditions = [isNull(tenants.deletedAt)]
  if (status) {
    conditions.push(eq(tenants.status, status))
  }

  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      phone: tenants.phone,
      email: tenants.email,
      createdAt: tenants.createdAt,
      ownerName: users.fullName,
      ownerEmail: users.email,
    })
    .from(tenants)
    .innerJoin(tenantUsers, and(eq(tenantUsers.tenantId, tenants.id), eq(tenantUsers.role, 'owner')))
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(...conditions))
    .orderBy(desc(tenants.createdAt))
}

export async function approveTenant(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending_approval')))
    .returning({ id: tenants.id, name: tenants.name })

  if (updated) {
    const [freePlan] = await db.select().from(plans).where(eq(plans.slug, 'free')).limit(1)
    if (freePlan) {
      const { created } = await createSubscription(tenantId, freePlan.id)
      if (created) {
        await notifyDiscord({
          kind: 'subscription.created',
          tenantName: updated.name,
          planName: freePlan.name,
          priceCents: freePlan.priceCents,
          tenantId,
        })
      }
    }
  }

  return updated
}

export async function rejectTenant(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({ status: 'rejected', deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending_approval')))
    .returning({ id: tenants.id, name: tenants.name })

  return updated
}

export async function getTenantOwnerEmail(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner')))
    .limit(1)

  return row?.email ?? null
}
