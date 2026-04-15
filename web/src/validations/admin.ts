import { z } from 'zod'

const roles = ['owner', 'practitioner', 'receptionist', 'financial'] as const

export const adminSearchSchema = z.object({
  search: z.string().optional().default(''),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug inválido').optional(),
  ownerEmail: z.string().email('E-mail inválido'),
  ownerName: z.string().min(1, 'Nome do responsável é obrigatório'),
})

export const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
})

export const createAdminUserSchema = z.object({
  email: z.string().email('E-mail inválido'),
  fullName: z.string().min(1, 'Nome é obrigatório'),
  phone: z.string().optional(),
  tenantId: z.string().uuid('Clínica inválida'),
  role: z.enum(roles as unknown as [string, ...string[]], { message: 'Perfil inválido' }),
})

export const updateAdminUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  isPlatformAdmin: z.boolean().optional(),
})

export const addMembershipSchema = z.object({
  tenantId: z.string().uuid('Clínica inválida'),
  role: z.enum(roles as unknown as [string, ...string[]], { message: 'Perfil inválido' }),
})

export const impersonateSchema = z.object({
  tenantId: z.string().uuid('Clínica inválida'),
})

export type AdminSearchInput = z.infer<typeof adminSearchSchema>
export type CreateTenantInput = z.infer<typeof createTenantSchema>
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>
export type AddMembershipInput = z.infer<typeof addMembershipSchema>
