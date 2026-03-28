import { db } from '@/db/client'
import { users, tenantUsers } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
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
  const adminClient = createAdminClient()

  // Step 1: Invite user via Supabase Auth (creates auth user + sends invite email)
  const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(
    data.email,
    {
      data: {
        full_name: data.fullName,
      },
    }
  )

  if (authError) {
    // If user already exists in auth, try to get the existing user
    if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
      const { data: existingUsers } = await adminClient.auth.admin.listUsers()
      const existingUser = existingUsers?.users?.find(u => u.email === data.email)

      if (!existingUser) {
        return { success: false, error: `Erro ao convidar usuário: ${authError.message}` }
      }

      // Check if already a member of this tenant
      const [existingMembership] = await db
        .select()
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, tenantId),
            eq(tenantUsers.userId, existingUser.id)
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
          return { success: true }
        }
        return { success: false, error: 'Usuário já é membro desta clínica' }
      }

      // User exists in auth but not in this tenant — add them
      try {
        await withTransaction(async (tx) => {
          // Ensure users record exists
          const [existingDbUser] = await tx
            .select()
            .from(users)
            .where(eq(users.id, existingUser.id))
            .limit(1)

          if (!existingDbUser) {
            await tx.insert(users).values({
              id: existingUser.id,
              email: data.email,
              fullName: data.fullName,
            })
          }

          await tx.insert(tenantUsers).values({
            tenantId,
            userId: existingUser.id,
            role: data.role,
          })
        })
        return { success: true }
      } catch (dbError) {
        console.error('Failed to add existing user to tenant after auth lookup:', dbError)
        return { success: false, error: 'Erro ao vincular usuário à clínica' }
      }
    }

    return { success: false, error: `Erro ao convidar usuário: ${authError.message}` }
  }

  if (!authData.user) {
    return { success: false, error: 'Erro inesperado ao criar usuário' }
  }

  // Step 2: Create DB records in transaction
  try {
    await withTransaction(async (tx) => {
      // Create users record
      await tx.insert(users).values({
        id: authData.user.id,
        email: data.email,
        fullName: data.fullName,
      })

      // Create tenant_users record
      await tx.insert(tenantUsers).values({
        tenantId,
        userId: authData.user.id,
        role: data.role,
      })
    })
  } catch (dbError) {
    // Auth user was created but DB insert failed — log the error
    // Auth user can be re-linked on retry
    console.error(
      'CRITICAL: Auth user created but DB insert failed. Auth user ID:',
      authData.user.id,
      'Email:',
      data.email,
      'Error:',
      dbError
    )
    return {
      success: false,
      error: 'Usuário criado no sistema de autenticação, mas houve erro ao vincular à clínica. Tente novamente.',
    }
  }

  return { success: true }
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
