import { z } from 'zod'

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Nome é obrigatório').max(255),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  clinicName: z.string().trim().min(1, 'Nome da clínica é obrigatório').max(255),
  phone: z.string().trim().min(10, 'Telefone inválido').max(20),
})

export const clinicDetailsSchema = z.object({
  clinicName: z.string().trim().min(1, 'Nome da clínica é obrigatório').max(255),
  phone: z.string().trim().min(10, 'Telefone inválido').max(20),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type ClinicDetailsInput = z.infer<typeof clinicDetailsSchema>
