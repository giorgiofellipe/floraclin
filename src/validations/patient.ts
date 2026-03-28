import { z } from 'zod'

const addressSchema = z.object({
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
}).optional()

export const createPatientSchema = z.object({
  fullName: z.string().min(1, 'Nome completo é obrigatório'),
  phone: z.string().min(1, 'Telefone é obrigatório'),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phoneSecondary: z.string().optional(),
  address: addressSchema,
  occupation: z.string().optional(),
  referralSource: z.string().optional(),
  notes: z.string().optional(),
})

export const updatePatientSchema = z.object({
  id: z.string().uuid('ID inválido'),
  fullName: z.string().min(1, 'Nome completo é obrigatório').optional(),
  phone: z.string().min(1, 'Telefone é obrigatório').optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phoneSecondary: z.string().optional(),
  address: addressSchema,
  occupation: z.string().optional(),
  referralSource: z.string().optional(),
  notes: z.string().optional(),
})

export const patientSearchSchema = z.object({
  search: z.string().optional().default(''),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export type CreatePatientInput = z.infer<typeof createPatientSchema>
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>
export type PatientSearchInput = z.infer<typeof patientSearchSchema>
