import { z } from 'zod'

export const CLINICAL_DOCUMENT_KINDS = ['receita', 'atestado'] as const
export type ClinicalDocumentKind = (typeof CLINICAL_DOCUMENT_KINDS)[number]

export const clinicalDocumentTemplateSchema = z.object({
  kind: z.enum(CLINICAL_DOCUMENT_KINDS),
  name: z.string().min(1, 'Nome é obrigatório').max(255),
  body: z.string().min(1, 'Corpo do modelo é obrigatório'),
  isActive: z.boolean().optional(),
})

export const updateClinicalDocumentTemplateSchema = clinicalDocumentTemplateSchema.partial()

export const issueClinicalDocumentSchema = z.object({
  patientId: z.string().uuid(),
  kind: z.enum(CLINICAL_DOCUMENT_KINDS),
  title: z.string().min(1, 'Título é obrigatório').max(255),
  body: z.string().min(1, 'Corpo do documento é obrigatório'),
  templateId: z.string().uuid().nullable().optional(),
})

export type ClinicalDocumentTemplateInput = z.infer<typeof clinicalDocumentTemplateSchema>
export type UpdateClinicalDocumentTemplateInput = z.infer<
  typeof updateClinicalDocumentTemplateSchema
>
export type IssueClinicalDocumentInput = z.infer<typeof issueClinicalDocumentSchema>

export interface ProfessionalSnapshot {
  name: string
  registryLine: string
  signatureDataUrl: string
}
