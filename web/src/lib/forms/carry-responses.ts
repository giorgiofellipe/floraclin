import { questionResponseSchema } from './response-schema'
import type { FormQuestion, FormResponses, FormResponseValue, FormSection } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function keepValidParts(question: FormQuestion, value: unknown): unknown {
  const options = question.options ?? []
  const isOption = (v: unknown) => typeof v === 'string' && options.includes(v)
  const keepOptions = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isOption))] : v)

  switch (question.type) {
    case 'checkbox':
      return keepOptions(value)
    case 'checkbox_with_other':
      return isRecord(value) ? { ...value, selected: keepOptions(value.selected) } : value
    case 'radio':
      return isOption(value) ? value : undefined
    case 'radio_with_other':
      return isRecord(value) ? { ...value, selected: isOption(value.selected) ? value.selected : '' } : value
    case 'list': {
      if (!Array.isArray(value)) return value
      const columns = new Map((question.columns ?? []).map((c) => [c.id, c]))
      return value
        .filter(isRecord)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([id, cell]) => {
              const column = columns.get(id)
              if (!column || typeof cell !== 'string') return false
              return column.kind !== 'select' || (column.options ?? []).includes(cell)
            }),
          ),
        )
        .filter((row) => Object.values(row).some((cell) => (cell as string).trim() !== ''))
    }
    default:
      return value
  }
}

/**
 * Moves answers onto `sections` by question id. Invalid parts of an answer (a removed option, an
 * unknown list column) are dropped; an answer whose remaining shape still fails is dropped whole.
 * Required questions are not enforced.
 */
export function carryResponses(responses: Record<string, unknown>, sections: FormSection[]): FormResponses {
  const carried: FormResponses = {}
  for (const section of sections) {
    for (const question of section.questions) {
      if (!Object.hasOwn(responses, question.id)) continue
      const value = keepValidParts(question, responses[question.id])
      const parsed = questionResponseSchema(question, { enforceRequired: false }).safeParse(value)
      if (parsed.success && parsed.data !== undefined) carried[question.id] = parsed.data as FormResponseValue
    }
  }
  return carried
}
