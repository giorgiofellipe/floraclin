import { z } from 'zod'

export const REGISTRY_TYPES = ['CRM', 'CRO', 'CRBM', 'CRF', 'CREFITO', 'COREN', 'OTHER'] as const

export const professionalProfileSchema = z.object({
  signatureData: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,/)
    .max(500_000)
    .nullable()
    .optional(),
  professionalTitle: z.string().min(1).max(100).nullable().optional(),
  registryType: z.enum(REGISTRY_TYPES).nullable().optional(),
  registryNumber: z.string().min(1).max(20).nullable().optional(),
  registryState: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
})

export type ProfessionalProfileInput = z.infer<typeof professionalProfileSchema>
