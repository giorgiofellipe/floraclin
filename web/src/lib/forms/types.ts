export const BASE_QUESTION_TYPES = [
  'radio', 'checkbox', 'scale', 'text', 'checkbox_with_other', 'radio_with_other', 'list',
] as const
/** 'face_diagram' exists only in evaluation templates and is rendered by the evaluation wrapper. */
export type FormQuestionType = (typeof BASE_QUESTION_TYPES)[number] | 'face_diagram'

export interface FormListColumn {
  id: string
  label: string
  kind: 'text' | 'select'
  options?: string[]
  required?: boolean
}

export interface FormQuestion {
  id: string
  label: string
  type: FormQuestionType
  required: boolean
  order: number
  options?: string[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  helpText?: string
  warningText?: string
  columns?: FormListColumn[]
}

export interface FormSection {
  id: string
  title: string
  order: number
  questions: FormQuestion[]
}

export type FormListResponse = Record<string, string>[]
export type FormResponseValue =
  | string
  | string[]
  | number
  | { selected: string[]; other: string }
  | { selected: string; other: string }
  | { completed: boolean }
  | FormListResponse
export type FormResponses = Record<string, FormResponseValue>
