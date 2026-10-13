import type { FormQuestion } from './types'

export function isQuestionAnswered(question: FormQuestion, value: unknown): boolean {
  if (value === undefined || value === null) return false

  switch (question.type) {
    case 'radio':
      return typeof value === 'string' && value.length > 0
    case 'checkbox':
      return Array.isArray(value) && value.length > 0
    case 'scale':
      return typeof value === 'number'
    case 'text':
      return typeof value === 'string' && value.trim().length > 0
    case 'checkbox_with_other': {
      const v = value as { selected?: string[]; other?: string }
      return !!(v.selected && v.selected.length > 0) || (typeof v.other === 'string' && v.other.trim().length > 0)
    }
    case 'radio_with_other': {
      const v = value as { selected?: string; other?: string }
      return (typeof v.selected === 'string' && v.selected.length > 0) || (typeof v.other === 'string' && v.other.trim().length > 0)
    }
    case 'list':
      return (
        Array.isArray(value) &&
        value.some(
          (row) =>
            row && typeof row === 'object' &&
            Object.values(row).some((c) => typeof c === 'string' && c.trim() !== ''),
        )
      )
    case 'face_diagram':
      return !!(value as { completed?: boolean })?.completed
    default:
      return false
  }
}
