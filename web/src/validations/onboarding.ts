import { z } from 'zod'
import { addressSchema, workingHoursSchema } from './tenant'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'

const PRODUCT_CATEGORIES = ['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other'] as const

// Reject control characters and bidi-override codepoints (U+202A-U+202E, U+2066-U+2069).
const SAFE_TEXT_PATTERN = /^[^\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]*$/

const safeTrimmedString = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres`)
    .regex(SAFE_TEXT_PATTERN, `${label} contém caracteres inválidos`)

export const productSelectionSchema = z
  .object({
    name: safeTrimmedString('Nome', 150).min(1, 'Nome do produto é obrigatório'),
    category: z.enum(PRODUCT_CATEGORIES),
    activeIngredient: safeTrimmedString('Princípio ativo', 150).optional().default(''),
    defaultUnit: z.enum(['U', 'mL']).default('U'),
  })
  .strict()

export type ProductSelection = z.infer<typeof productSelectionSchema>

const clinicDataSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: addressSchema.optional(),
  workingHours: workingHoursSchema,
})

const procedureTypeInputSchema = z.object({
  name: z.string().trim().min(1),
  category: z.enum(PROCEDURE_CATEGORIES),
  estimatedDurationMin: z.number().int().min(5).max(480).optional(),
  defaultPrice: z.string().optional(),
})

export const onboardingCompleteSchema = z.object({
  clinic: clinicDataSchema,
  procedureTypes: z.array(procedureTypeInputSchema).max(100, 'Muitos procedimentos').default([]),
  selectedProducts: z.array(productSelectionSchema).max(200, 'Muitos produtos').default([]),
})

export type OnboardingCompleteInput = z.infer<typeof onboardingCompleteSchema>
