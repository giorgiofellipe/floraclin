import type { FormQuestionType } from './types'

export const QUESTION_TYPE_LABELS: Record<FormQuestionType, string> = {
  radio: 'Escolha única',
  checkbox: 'Múltipla escolha',
  scale: 'Escala',
  text: 'Texto livre',
  checkbox_with_other: 'Múltipla escolha com "Outro"',
  radio_with_other: 'Escolha única com "Outro"',
  list: 'Lista',
  face_diagram: 'Diagrama facial',
}

export const CHOICE_QUESTION_TYPES: readonly FormQuestionType[] = [
  'radio', 'checkbox', 'radio_with_other', 'checkbox_with_other',
]

export function generateFormId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const FORM_LIMITS = {
  labelLength: 500,
  textLength: 5000,
  sections: 50,
  questionsPerSection: 100,
  options: 50,
  listColumns: 20,
  listRows: 200,
  scaleSpan: 20,
} as const

export const DEFAULT_SCALE_MIN = 1
export const DEFAULT_SCALE_MAX = 5
