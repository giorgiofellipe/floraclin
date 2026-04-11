import { z } from 'zod'
import type { TimelineStage } from '@/types'

// ─── Timeline stage enum ────────────────────────────────────────────

export const timelineStageValues = [
  'pre',
  'immediate_post',
  '7d',
  '30d',
  '90d',
  'other',
] as const satisfies readonly TimelineStage[]

export const timelineStageLabels: Record<TimelineStage, string> = {
  pre: 'Pré',
  immediate_post: 'Pós Imediato',
  '7d': '7 Dias',
  '30d': '30 Dias',
  '90d': '90 Dias',
  other: 'Outro',
}

// ─── Upload schema ──────────────────────────────────────────────────

export const uploadPhotoSchema = z.object({
  patientId: z.string().uuid('ID do paciente inválido'),
  procedureRecordId: z.string().uuid('ID do procedimento inválido').optional(),
  timelineStage: z.enum(timelineStageValues, {
    error: 'Estágio da timeline é obrigatório',
  }),
  notes: z.string().max(1000, 'Observações devem ter no máximo 1000 caracteres').optional(),
})

export type UploadPhotoData = z.infer<typeof uploadPhotoSchema>

// ─── File validation constants ──────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_IMAGE_WIDTH = 2048

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
    return 'Tipo de arquivo não aceito. Use JPEG, PNG ou WebP.'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'Arquivo muito grande. O tamanho máximo é 10MB.'
  }
  return null
}

// ─── Annotation schema ──────────────────────────────────────────────

export const saveAnnotationSchema = z.object({
  photoAssetId: z.string().uuid('ID da foto inválido'),
  annotationData: z.record(z.string(), z.unknown()),
}).refine(
  (data) => Object.keys(data.annotationData).length > 0,
  { message: 'Dados da anotação são obrigatórios', path: ['annotationData'] }
)

export type SaveAnnotationData = z.infer<typeof saveAnnotationSchema>
