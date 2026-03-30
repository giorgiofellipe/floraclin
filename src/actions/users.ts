'use server'

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listTenantUsers as listTenantUsersQuery,
  inviteUser as inviteUserQuery,
  updateUserRole as updateUserRoleQuery,
  deactivateUser as deactivateUserQuery,
} from '@/db/queries/users'
import {
  inviteUserSchema,
  updateUserRoleSchema,
  deactivateUserSchema,
} from '@/validations/user'
import type { InviteUserInput, UpdateUserRoleInput } from '@/validations/user'
import type { Role } from '@/types'

export type ActionState = {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
} | null

export async function listTenantUsersAction() {
  try {
    const auth = await requireRole('owner')
    return await listTenantUsersQuery(auth.tenantId)
  } catch {
    return []
  }
}

export async function inviteUserAction(data: InviteUserInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = inviteUserSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const result = await inviteUserQuery(auth.tenantId, parsed.data)

    if (!result.success) {
      return { error: result.error || 'Erro ao convidar usuário' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'create',
      entityType: 'tenant_user',
      changes: { invite: { old: null, new: { email: parsed.data.email, role: parsed.data.role } } },
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para convidar usuários' }
    }
    return { error: 'Erro ao convidar usuário' }
  }
}

export async function updateUserRoleAction(data: UpdateUserRoleInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = updateUserRoleSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos' }
    }

    const updated = await updateUserRoleQuery(auth.tenantId, parsed.data.userId, parsed.data.role as Role)
    if (!updated) {
      return { error: 'Usuário não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'tenant_user',
      entityId: parsed.data.userId,
      changes: { role: { old: null, new: parsed.data.role } },
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar papel do usuário' }
    }
    return { error: 'Erro ao alterar papel do usuário' }
  }
}

export async function deactivateUserAction(userId: string): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = deactivateUserSchema.safeParse({ userId })
    if (!parsed.success) {
      return { error: 'Dados inválidos' }
    }

    // Can't deactivate yourself
    if (parsed.data.userId === auth.userId) {
      return { error: 'Você não pode desativar sua própria conta' }
    }

    const result = await deactivateUserQuery(auth.tenantId, parsed.data.userId)
    if (!result) {
      return { error: 'Usuário não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'tenant_user',
      entityId: parsed.data.userId,
      changes: { isActive: { old: true, new: false } },
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para desativar usuários' }
    }
    return { error: 'Erro ao desativar usuário' }
  }
}
