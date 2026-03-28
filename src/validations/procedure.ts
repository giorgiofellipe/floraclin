import { z } from 'zod'

// ─── Procedure Schemas ─────────────────────────────────────────────

export const createProcedureSchema = z.object({
  patientId: z.string().uuid('ID do paciente inválido'),
  procedureTypeId: z.string().uuid('Tipo de procedimento é obrigatório'),
  appointmentId: z.string().uuid('ID do agendamento inválido').optional(),
  technique: z.string().max(5000, 'Técnica deve ter no máximo 5000 caracteres').optional(),
  clinicalResponse: z.string().max(5000, 'Resposta clínica deve ter no máximo 5000 caracteres').optional(),
  adverseEffects: z.string().max(5000, 'Efeitos adversos deve ter no máximo 5000 caracteres').optional(),
  notes: z.string().max(5000, 'Notas devem ter no máximo 5000 caracteres').optional(),
  followUpDate: z.string().optional(),
  nextSessionObjectives: z.string().max(5000, 'Objetivos devem ter no máximo 5000 caracteres').optional(),
})

export type CreateProcedureInput = z.infer<typeof createProcedureSchema>

export const updateProcedureSchema = createProcedureSchema.partial().extend({
  id: z.string().uuid('ID do procedimento inválido'),
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
})

export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>

// ─── Diagram Schemas ───────────────────────────────────────────────

export const diagramPointSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  productName: z.string().min(1, 'Nome do produto é obrigatório').max(255),
  activeIngredient: z.string().max(255).optional(),
  quantity: z.number().positive('Quantidade deve ser maior que zero'),
  quantityUnit: z.enum(['U', 'mL']),
  technique: z.string().max(100).optional(),
  depth: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
})

export const diagramSaveSchema = z.object({
  procedureRecordId: z.string().uuid('ID do procedimento inválido'),
  viewType: z.enum(['front', 'left_profile', 'right_profile']),
  points: z.array(diagramPointSchema),
})

export type DiagramSaveInput = z.infer<typeof diagramSaveSchema>

// ─── Product Application Schemas ───────────────────────────────────

export const productApplicationItemSchema = z.object({
  productName: z.string().min(1, 'Nome do produto é obrigatório').max(255),
  activeIngredient: z.string().max(255).optional(),
  totalQuantity: z.number().positive('Quantidade total deve ser maior que zero'),
  quantityUnit: z.enum(['U', 'mL']),
  batchNumber: z.string().max(100).optional(),
  expirationDate: z.string().optional(),
  labelPhotoId: z.string().uuid().optional(),
  applicationAreas: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
})

export const productApplicationSchema = z.object({
  procedureRecordId: z.string().uuid('ID do procedimento inválido'),
  applications: z.array(productApplicationItemSchema),
})

export type ProductApplicationInput = z.infer<typeof productApplicationSchema>
export type ProductApplicationItem = z.infer<typeof productApplicationItemSchema>
