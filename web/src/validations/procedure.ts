import { z } from 'zod'

// ─── Procedure Schemas ─────────────────────────────────────────────

export const procedureStatusSchema = z.enum(['draft', 'planned', 'approved', 'executed', 'cancelled'])

export const financialPlanSchema = z.object({
  totalAmount: z.number().positive('Valor total deve ser maior que zero'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(12, 'Máximo 12 parcelas'),
  paymentMethod: z.enum(['pix', 'credit_card', 'debit_card', 'cash', 'transfer']).optional(),
  notes: z.string().max(1000, 'Observações devem ter no máximo 1000 caracteres').optional(),
})

export type FinancialPlan = z.infer<typeof financialPlanSchema>

export const createProcedureSchema = z.object({
  patientId: z.string().uuid('ID do paciente inválido'),
  procedureTypeId: z.string().uuid('Tipo de procedimento é obrigatório'),
  additionalTypeIds: z.array(z.string().uuid()).optional(),
  appointmentId: z.string().uuid('ID do agendamento inválido').optional(),
  technique: z.string().max(5000, 'Técnica deve ter no máximo 5000 caracteres').optional(),
  clinicalResponse: z.string().max(5000, 'Resposta clínica deve ter no máximo 5000 caracteres').optional(),
  adverseEffects: z.string().max(5000, 'Efeitos adversos deve ter no máximo 5000 caracteres').optional(),
  notes: z.string().max(5000, 'Notas devem ter no máximo 5000 caracteres').optional(),
  followUpDate: z.string().optional(),
  nextSessionObjectives: z.string().max(5000, 'Objetivos devem ter no máximo 5000 caracteres').optional(),
  financialPlan: financialPlanSchema.optional(),
})

export type CreateProcedureInput = z.infer<typeof createProcedureSchema>

export const updateProcedureSchema = createProcedureSchema.partial().extend({
  id: z.string().uuid('ID do procedimento inválido'),
})

export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>

// ─── Diagram Schemas ───────────────────────────────────────────────

export const diagramPointSchema = z.object({
  // Client-side identity fields — preserved by zod parse so React keys and
  // view-filtering keep working after form.reset(). The wire payload builders
  // strip these explicitly before sending to the server.
  id: z.string().optional(),
  viewType: z.string().optional(),
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

// ─── Planning form schemas (step 3) ─────────────────────────────────

export const procedurePlanningFormSchema = z.object({
  procedureTypeId: z.string().uuid('Tipo de procedimento é obrigatório'),
  additionalTypeIds: z.array(z.string().uuid()).default([]),
  technique: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  clinicalResponse: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  adverseEffects: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  notes: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000, 'Máximo 5000 caracteres').optional().default(''),
  financialPlan: financialPlanSchema.optional(),
  diagramPoints: z.array(diagramPointSchema).default([]),
  evaluationResponses: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
})
export type ProcedurePlanningFormData = z.infer<typeof procedurePlanningFormSchema>

export const procedurePlanningFinalSchema = procedurePlanningFormSchema.superRefine((data, ctx) => {
  // Emit errors at the most specific path the UI renders, so FormFieldError
  // under each sub-field can display the message inline.
  if (!data.financialPlan) {
    ctx.addIssue({
      code: 'custom',
      path: ['financialPlan', 'totalAmount'],
      message: 'Plano financeiro obrigatório',
    })
  }
  if (data.diagramPoints.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['diagramPoints'], message: 'Marque ao menos um ponto no diagrama' })
  }
})

// ─── Execution form schemas (step 5) ────────────────────────────────
// NOTE: mirrors the real payload — no performedAt (server sets it).

export const procedureExecutionFormSchema = z.object({
  technique: z.string().max(5000).optional().default(''),
  clinicalResponse: z.string().max(5000).optional().default(''),
  adverseEffects: z.string().max(5000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000).optional().default(''),
  diagramPoints: z.array(diagramPointSchema).default([]),
  productApplications: z.array(productApplicationItemSchema).default([]),
})
export type ProcedureExecutionFormData = z.infer<typeof procedureExecutionFormSchema>

// ─── Execution wire schema (POST body for /api/procedures/[id]/execute) ─
// Server-side validation of the body shape. The client builds this from
// the form's values before POSTing.

export const procedureExecutionWireSchema = z.object({
  technique: z.string().max(5000).optional(),
  clinicalResponse: z.string().max(5000).optional(),
  adverseEffects: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  followUpDate: z.string().optional(),
  nextSessionObjectives: z.string().max(5000).optional(),
  diagrams: z
    .array(
      z.object({
        viewType: z.enum(['front', 'left_profile', 'right_profile']),
        points: z.array(diagramPointSchema),
      }),
    )
    .optional(),
  productApplications: z.array(productApplicationItemSchema).optional(),
})
export type ProcedureExecutionWireInput = z.infer<typeof procedureExecutionWireSchema>
