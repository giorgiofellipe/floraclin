import { z } from 'zod'
import type { EvaluationSection, EvaluationQuestionType } from '@/types/evaluation'

interface Template {
  id: string
  sections: EvaluationSection[]
}

/**
 * Returns a zod schema for a single question's response value.
 * Required questions must have a non-empty answer; optional questions
 * accept undefined or any value (to match the stored-responses shape).
 */
function questionSchema(type: EvaluationQuestionType, required: boolean): z.ZodTypeAny {
  if (!required) {
    return z.unknown().optional()
  }

  switch (type) {
    case 'radio':
    case 'text':
      return z.string().min(1, 'Campo obrigatório')

    case 'scale':
      return z.number({ message: 'Campo obrigatório' })

    case 'checkbox':
      return z.array(z.string()).min(1, 'Selecione ao menos uma opção')

    case 'radio_with_other':
      return z.preprocess(
        (v) => v ?? { selected: '', other: '' },
        z.object({
          selected: z.string().optional().default(''),
          other: z.string().optional().default(''),
        }).refine(
          (v) => (v.selected && v.selected.length > 0) || (v.other && v.other.trim().length > 0),
          { message: 'Campo obrigatório' }
        )
      )

    case 'checkbox_with_other':
      return z.preprocess(
        (v) => v ?? { selected: [], other: '' },
        z.object({
          selected: z.array(z.string()).optional().default([]),
          other: z.string().optional().default(''),
        }).refine(
          (v) => (v.selected && v.selected.length > 0) || (v.other && v.other.trim().length > 0),
          { message: 'Selecione ao menos uma opção' }
        )
      )

    case 'face_diagram':
      return z.object({
        completed: z.literal(true, { message: 'Complete o diagrama' }),
      })

    default:
      return z.unknown()
  }
}

/**
 * Builds a zod schema that validates evaluation responses against runtime templates.
 * Returns a permissive schema when no templates are present.
 * Shape: Record<templateId, Record<questionId, responseValue>>
 */
export function buildEvaluationResponseSchema(
  templates: Template[],
): z.ZodType<Record<string, Record<string, unknown>>> {
  if (templates.length === 0) {
    return z.record(z.string(), z.record(z.string(), z.unknown()))
  }

  const templateShapes: Record<string, z.ZodTypeAny> = {}
  for (const template of templates) {
    const questionShapes: Record<string, z.ZodTypeAny> = {}
    for (const section of template.sections ?? []) {
      for (const question of section.questions ?? []) {
        questionShapes[question.id] = questionSchema(question.type, question.required)
      }
    }
    templateShapes[template.id] = z.object(questionShapes)
  }

  return z.object(templateShapes) as z.ZodType<Record<string, Record<string, unknown>>>
}
