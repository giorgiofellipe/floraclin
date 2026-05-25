import { z } from 'zod'

export const PROSPECT_STAGES = ['novo', 'contatado', 'qualificado', 'agendado', 'convertido', 'perdido'] as const
export type ProspectStage = (typeof PROSPECT_STAGES)[number]

export const updateProspectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  stage: z.enum(PROSPECT_STAGES).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
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

export const prospectFilterSchema = z.object({
  stage: z.enum(PROSPECT_STAGES).optional(),
  search: z.string().optional(),
  assignedUserId: z.string().uuid().optional(),
})

export type UpdateProspectInput = z.infer<typeof updateProspectSchema>
export type ConvertProspectInput = z.infer<typeof convertProspectSchema>
export type ProspectFilterInput = z.infer<typeof prospectFilterSchema>
