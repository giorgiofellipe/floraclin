import { z } from 'zod'

const coord = z.number().min(0).max(1)

const landmarksSchema = z.object({
  leftEye: z.object({ x: coord, y: coord }),
  rightEye: z.object({ x: coord, y: coord }),
  noseTip: z.object({ x: coord, y: coord }),
  interPupillaryDistance: z.number().min(0).max(1),
})

export const photoCropSchema = z.object({
  x: coord,
  y: coord,
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  rotation: z.number().min(-360).max(360),
  landmarks: landmarksSchema.optional(),
  aspect: z.enum(['3:4', '4:3', '1:1', 'free']),
}).refine(
  (d) => d.x + d.width <= 1.0001 && d.y + d.height <= 1.0001,
  { message: 'Recorte excede os limites da imagem' },
)

export type PhotoCropData = z.infer<typeof photoCropSchema>

export const saveCropSchema = z.object({
  cropBox: photoCropSchema.nullable(),
})

export type SaveCropData = z.infer<typeof saveCropSchema>
