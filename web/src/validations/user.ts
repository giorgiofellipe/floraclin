import { z } from 'zod'

// Invites and role changes never create a second owner.
export const ASSIGNABLE_ROLES = ['practitioner', 'receptionist', 'financial'] as const

export const inviteUserSchema = z.object({
  // Normalised on the way in: uq_users_email_lower treats addresses as
  // case-insensitive, and `authorize` looks users up lowercased, so a
  // mixed-case row can never be signed into and blocks the matching signup.
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  fullName: z.string().min(1, 'Nome completo é obrigatório'),
  role: z.enum(ASSIGNABLE_ROLES, {
    message: 'Papel inválido',
  }),
})

export const updateUserRoleSchema = z.object({
  userId: z.string().uuid('ID inválido'),
  role: z.enum(ASSIGNABLE_ROLES, {
    message: 'Papel inválido',
  }),
})

export const deactivateUserSchema = z.object({
  userId: z.string().uuid('ID inválido'),
})

export type InviteUserInput = z.infer<typeof inviteUserSchema>
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>
