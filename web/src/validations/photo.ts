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

// Standard image types that browsers render natively. These upload without
// any client-side decoding — just the existing resize-and-compress path.
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

// DNG (Adobe Digital Negative, e.g. iPhone ProRAW, Sony/Canon/Nikon raw).
// Not renderable by browsers — must be decoded client-side to a JPEG via
// libraw-wasm before upload. Raw files can be much larger than 10MB, so we
// allow a bigger input limit; the resulting JPEG is still bounded by
// MAX_FILE_SIZE_BYTES after conversion.
export const MAX_RAW_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100MB
const DNG_MIME_TYPES = new Set(['image/x-adobe-dng', 'image/dng'])

export const MAX_IMAGE_WIDTH = 2048

export function isDngFile(file: File): boolean {
  if (DNG_MIME_TYPES.has(file.type.toLowerCase())) return true
  // Fall back to extension — some browsers report empty MIME or
  // application/octet-stream for DNG.
  return /\.dng$/i.test(file.name)
}

export function validateImageFile(file: File): string | null {
  const isDng = isDngFile(file)

  if (!isDng && !ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
    return 'Tipo de arquivo não aceito. Use JPEG, PNG, WebP ou DNG.'
  }

  const sizeLimit = isDng ? MAX_RAW_FILE_SIZE_BYTES : MAX_FILE_SIZE_BYTES
  if (file.size > sizeLimit) {
    const limitMb = Math.floor(sizeLimit / (1024 * 1024))
    return `Arquivo muito grande. O tamanho máximo é ${limitMb}MB.`
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
