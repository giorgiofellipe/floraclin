import { db } from '@/db/client'
import { users, tenantUsers, tenants } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { sendInviteEmail } from '@/lib/email'
import type { InviteUserInput } from '@/validations/user'
import type { Role } from '@/types'

export type TenantUserWithDetails = {
  id: string
  tenantId: string
  userId: string
  role: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  user: {
    id: string
    email: string
    fullName: string
    phone: string | null
    avatarUrl: string | null
  }
}

export async function listTenantUsers(tenantId: string): Promise<TenantUserWithDetails[]> {
  const results = await db
    .select({
      id: tenantUsers.id,
      tenantId: tenantUsers.tenantId,
      userId: tenantUsers.userId,
      role: tenantUsers.role,
      isActive: tenantUsers.isActive,
      createdAt: tenantUsers.createdAt,
      updatedAt: tenantUsers.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(eq(tenantUsers.tenantId, tenantId))

  return results
}

export async function inviteUser(
  tenantId: string,
  data: InviteUserInput
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Look up existing user by email
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1)

    let userId: string

    if (existingUser) {
      userId = existingUser.id

      // Check if already a member of this tenant
      const [existingMembership] = await db
        .select()
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, tenantId),
            eq(tenantUsers.userId, userId)
          )
        )
        .limit(1)

      if (existingMembership) {
        if (!existingMembership.isActive) {
          // Reactivate
          await db
            .update(tenantUsers)
            .set({ isActive: true, role: data.role, updatedAt: new Date() })
            .where(eq(tenantUsers.id, existingMembership.id))
        } else {
          return { success: false, error: 'Usuário já é membro desta clínica' }
        }
      } else {
        // Existing user, new tenant membership
        await db.insert(tenantUsers).values({
          tenantId,
          userId,
          role: data.role,
        })
      }
    } else {
      // Step 2: New user — generate ID and create records in a transaction
      userId = crypto.randomUUID()

      await withTransaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email: data.email,
          fullName: data.fullName,
        })

        await tx.insert(tenantUsers).values({
          tenantId,
          userId,
          role: data.role,
        })
      })
    }

    // Step 3: Get clinic name and send invite email
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)

    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.floraclin.com.br'}/login`
    await sendInviteEmail(data.email, loginUrl, tenant?.name)

    return { success: true }
  } catch (error) {
    console.error('Failed to invite user:', error)
    return { success: false, error: 'Erro ao convidar usuário' }
  }
}

export async function updateUserRole(
  tenantId: string,
  userId: string,
  role: Role
): Promise<TenantUserWithDetails | null> {
  const [updated] = await db
    .update(tenantUsers)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId)
      )
    )
    .returning()

  if (!updated) return null

  const results = await db
    .select({
      id: tenantUsers.id,
      tenantId: tenantUsers.tenantId,
      userId: tenantUsers.userId,
      role: tenantUsers.role,
      isActive: tenantUsers.isActive,
      createdAt: tenantUsers.createdAt,
      updatedAt: tenantUsers.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId)
      )
    )
    .limit(1)

  return results[0] ?? null
}

export async function deactivateUser(
  tenantId: string,
  userId: string
): Promise<boolean> {
  const [updated] = await db
    .update(tenantUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId)
      )
    )
    .returning()

  return !!updated
}
