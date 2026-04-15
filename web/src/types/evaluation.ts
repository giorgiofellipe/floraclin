export type EvaluationQuestionType =
  | 'radio'
  | 'checkbox'
  | 'scale'
  | 'text'
  | 'checkbox_with_other'
  | 'radio_with_other'
  | 'face_diagram'

export interface EvaluationQuestion {
  id: string
  label: string
  type: EvaluationQuestionType
  required: boolean
  order: number
  options?: string[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  helpText?: string
  warningText?: string
}

export interface EvaluationSection {
  id: string
  title: string
  order: number
  questions: EvaluationQuestion[]
}

/** Response value types per question type */
export type EvaluationRadioResponse = string
export type EvaluationCheckboxResponse = string[]
export type EvaluationScaleResponse = number
export type EvaluationTextResponse = string
export type EvaluationCheckboxWithOtherResponse = { selected: string[]; other: string }
export type EvaluationRadioWithOtherResponse = { selected: string; other: string }
export type EvaluationFaceDiagramResponse = { completed: boolean }

export type EvaluationResponseValue =
  | EvaluationRadioResponse
  | EvaluationCheckboxResponse
  | EvaluationScaleResponse
  | EvaluationTextResponse
  | EvaluationCheckboxWithOtherResponse
  | EvaluationRadioWithOtherResponse
  | EvaluationFaceDiagramResponse

/** Stored as JSONB: { [questionId]: EvaluationResponseValue } */
export type EvaluationResponses = Record<string, EvaluationResponseValue>

/** Procedure category to map default templates */
export type ProcedureCategory =
  | 'botox'
  | 'filler'
  | 'biostimulator'
  | 'skinbooster'
  | 'enzima'
  | 'limpeza_pele'
  | 'skincare'
  | 'microagulhamento'

export interface DefaultTemplateDefinition {
  name: string
  category: ProcedureCategory
  sections: EvaluationSection[]
}
