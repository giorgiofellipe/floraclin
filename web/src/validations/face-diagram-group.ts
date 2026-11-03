import { z } from 'zod'
import { diagramPointSchema } from '@/validations/procedure'

export const quotationLineSchema = z.object({
  procedureTypeId: z.string().uuid(),
  procedureTypeName: z.string().min(1),
  sessions: z.number().int().min(1).max(50),
  unitPrice: z
    .number()
    .nonnegative()
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-9, {
      message: 'Valor deve ter no máximo 2 casas decimais',
    }),
})

export const quotationLinesSchema = z.array(quotationLineSchema).refine(
  (lines) => new Set(lines.map((l) => l.procedureTypeId)).size === lines.length,
  { message: 'Procedimento repetido no orçamento' },
)

export type QuotationLine = z.infer<typeof quotationLineSchema>

export const diagramViewSchema = z.object({
  viewType: z.enum(['front', 'left_profile', 'right_profile']),
  points: z.array(diagramPointSchema),
})

const diagramGroupPayload = {
  views: z
    .array(diagramViewSchema)
    .min(1)
    .refine((views) => new Set(views.map((v) => v.viewType)).size === views.length, {
      message: 'Vista repetida',
    }),
  quotationLines: quotationLinesSchema.default([]),
}

export const createDiagramGroupSchema = z.object(diagramGroupPayload)
export const updateDiagramGroupSchema = z.object(diagramGroupPayload)

export type DiagramGroupOrigin = 'standalone' | 'wizard'
