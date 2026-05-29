import { z } from 'zod'

export const procedureSessionFormSchema = z.object({
  performedAt: z.string().min(1, 'Informe a data e hora.'),
  technique: z.string().max(2000).optional().default(''),
  clinicalResponse: z.string().max(2000).optional().default(''),
  adverseEffects: z.string().max(2000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().nullable().optional(),
  nextSessionObjectives: z.string().max(2000).optional().default(''),
})

export type ProcedureSessionFormValues = z.infer<typeof procedureSessionFormSchema>

export const createSessionWireSchema = procedureSessionFormSchema.extend({
  procedureRecordId: z.string().uuid(),
  productApplications: z.array(z.object({
    productName: z.string().min(1),
    activeIngredient: z.string().optional(),
    totalQuantity: z.number().nonnegative(),
    quantityUnit: z.string(),
    batchNumber: z.string().optional(),
    expirationDate: z.string().nullable().optional(),
    applicationAreas: z.string().optional(),
    notes: z.string().optional(),
  })).optional().default([]),
  diagramPoints: z.array(z.object({
    viewType: z.string(),
    points: z.array(z.object({
      x: z.number(),
      y: z.number(),
      productName: z.string(),
      activeIngredient: z.string().optional(),
      quantity: z.number(),
      quantityUnit: z.string(),
      technique: z.string().optional(),
      depth: z.string().optional(),
      notes: z.string().optional(),
      sortOrder: z.number().int(),
    })),
  })).optional().default([]),
  photoAssetIds: z.array(z.string().uuid()).optional().default([]),
})

export type CreateSessionWire = z.infer<typeof createSessionWireSchema>
