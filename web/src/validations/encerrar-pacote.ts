import { z } from 'zod'

export const closeReasonValues = ['patient_lost_expiry', 'patient_stopped_treatment', 'other'] as const
export type CloseReason = typeof closeReasonValues[number]

export const closePackageSchema = z.object({
  closedReason: z.enum(closeReasonValues),
  closeNote: z.string().max(1000).optional().default(''),
}).superRefine((data, ctx) => {
  if (data.closedReason === 'other' && data.closeNote.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closeNote'],
      message: 'Descreva o motivo quando selecionar "Outro".',
    })
  }
})

export const closeReasonLabels: Record<CloseReason, string> = {
  patient_lost_expiry: 'Paciente perdeu a data de validade',
  patient_stopped_treatment: 'Paciente desistiu do tratamento',
  other: 'Outro',
}

export type ClosePackageFormValues = z.infer<typeof closePackageSchema>
