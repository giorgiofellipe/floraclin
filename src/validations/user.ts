import { z } from 'zod'

const roles = ['owner', 'practitioner', 'receptionist', 'financial'] as const

export const inviteUserSchema = z.object({
  email: z.string().email('E-mail inválido'),
  fullName: z.string().min(1, 'Nome completo é obrigatório'),
  role: z.enum(roles, {
    message: 'Papel inválido',
  }),
})

export const updateUserRoleSchema = z.object({
  userId: z.string().uuid('ID inválido'),
  role: z.enum(roles, {
    message: 'Papel inválido',
  }),
})

export const deactivateUserSchema = z.object({
  userId: z.string().uuid('ID inválido'),
})

export type InviteUserInput = z.infer<typeof inviteUserSchema>
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>
