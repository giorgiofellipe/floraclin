import { z } from 'zod'

// Body length cap matches the migration's expectation; if a user pastes a
// huge wall of text we want to reject at the API boundary, not surface a
// Postgres `value too long` error.
export const EVOLUTION_BODY_MAX = 10_000

// Delete reason is logged into audit for traceability — keep it bounded.
export const EVOLUTION_DELETE_REASON_MAX = 500

export const createEvolutionSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Conteúdo obrigatório')
    .max(EVOLUTION_BODY_MAX, `Conteúdo deve ter no máximo ${EVOLUTION_BODY_MAX} caracteres`),
  // Server defaults to now() when absent.
  occurredAt: z.string().datetime().optional(),
})

export const editEvolutionSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Conteúdo obrigatório')
    .max(EVOLUTION_BODY_MAX, `Conteúdo deve ter no máximo ${EVOLUTION_BODY_MAX} caracteres`),
  occurredAt: z.string().datetime().optional(),
})

export const deleteEvolutionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Motivo obrigatório')
    .max(EVOLUTION_DELETE_REASON_MAX, `Motivo deve ter no máximo ${EVOLUTION_DELETE_REASON_MAX} caracteres`),
})

export type CreateEvolutionInput = z.infer<typeof createEvolutionSchema>
export type EditEvolutionInput = z.infer<typeof editEvolutionSchema>
export type DeleteEvolutionInput = z.infer<typeof deleteEvolutionSchema>
