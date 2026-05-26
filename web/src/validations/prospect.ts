import { z } from 'zod'

export const PROSPECT_STAGES = ['novo', 'contatado', 'qualificado', 'agendado', 'convertido', 'perdido'] as const
export type ProspectStage = (typeof PROSPECT_STAGES)[number]

export const updateProspectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  stage: z.enum(PROSPECT_STAGES).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  value: z.string().regex(/^\d+([.,]\d{1,2})?$/, 'Valor inválido').nullable().optional(),
  procedureTypeIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).optional(),
  lostReason: z.string().max(500).optional(),
})

export const convertProspectSchema = z.object({
  patientId: z.string().uuid().optional(),
  createPatient: z.object({
    fullName: z.string().min(1),
    phone: z.string().min(1),
  }).optional(),
}).refine(
  (data) => data.patientId || data.createPatient,
  { message: 'Selecione um paciente ou crie um novo' },
)

export const createProspectSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255),
  phone: z.string().min(8, 'Telefone é obrigatório').max(30),
  source: z.enum(['manual', 'whatsapp', 'instagram', 'indicacao', 'outro']).default('manual'),
  notes: z.string().max(2000).optional(),
})

export const prospectFilterSchema = z.object({
  stage: z.enum(PROSPECT_STAGES).optional(),
  search: z.string().optional(),
  assignedUserId: z.string().uuid().optional(),
})

export type CreateProspectInput = z.infer<typeof createProspectSchema>
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>
export type ConvertProspectInput = z.infer<typeof convertProspectSchema>
export type ProspectFilterInput = z.infer<typeof prospectFilterSchema>
