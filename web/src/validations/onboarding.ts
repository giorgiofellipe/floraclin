import { z } from 'zod'
import { addressSchema, workingHoursSchema } from './tenant'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'
import { hasClinicPhone } from '@/lib/clinic-phone'

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

export const ONBOARDING_STEPS = ['clinic', 'procedures', 'products', 'team'] as const

// An address with every field emptied is stored as none, so clearing it sticks.
const clinicAddressSchema = addressSchema.unwrap().transform((address) =>
  Object.values(address).some(Boolean) ? address : null,
)

const clinicDataSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug inválido').optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: clinicAddressSchema.optional(),
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

// Autosave runs on every keystroke, so a half-typed value is dropped (not saved yet) instead of failing the save.
const savedWhenComplete = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

const progressClinicSchema = z.object({
  name: savedWhenComplete(safeTrimmedString('Nome', 255).min(1)),
  phone: savedWhenComplete(z.string().trim().max(20).refine(hasClinicPhone)),
  email: savedWhenComplete(z.string().trim().max(255).email()),
  address: savedWhenComplete(clinicAddressSchema),
  workingHours: savedWhenComplete(workingHoursSchema),
})

export const onboardingDraftSchema = z.object({
  step: z.number().int().min(0).max(ONBOARDING_STEPS.length - 1),
  procedures: z
    .array(
      z.object({
        selected: z.boolean(),
        durationMin: z.number().int().min(5).max(480),
        defaultPrice: z.string().max(20),
      }),
    )
    .max(100),
  selectedProductNames: z.array(z.string().max(150)).max(200),
  productsTouched: z.boolean(),
  customProducts: z.array(productSelectionSchema).max(200),
  customSlug: z.string().max(100).regex(/^[a-z0-9-]*$/),
})

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>

export const onboardingProgressSchema = z.object({
  clinic: progressClinicSchema.default({}),
  draft: savedWhenComplete(onboardingDraftSchema),
})

export type OnboardingProgressInput = z.input<typeof onboardingProgressSchema>
