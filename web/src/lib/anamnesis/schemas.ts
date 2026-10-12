import { z } from 'zod'
import { formSectionsSchema } from '@/lib/forms/sections-schema'

export const anamnesisSectionsSchema = formSectionsSchema.refine(
  (sections) => sections.every((s) => s.questions.every((q) => q.type !== 'face_diagram')),
  { message: 'Diagrama facial não é permitido na anamnese' },
)

const anamnesisSaveFields = z.object({
  templateVersion: z.number().int().nonnegative(),
  responses: z.record(z.string(), z.unknown()),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  expectNoRow: z.boolean().optional(),
  applyCurrentTemplate: z.boolean().optional(),
})

export const anamnesisPublicSaveBodySchema = anamnesisSaveFields.pick({ templateVersion: true, responses: true })

export const anamnesisSaveBodySchema = anamnesisSaveFields.refine(
  (body) => body.expectedUpdatedAt !== undefined || body.expectNoRow === true,
  { message: 'Informe expectedUpdatedAt ou expectNoRow' },
)

export type AnamnesisSaveBody = z.infer<typeof anamnesisSaveBodySchema>
