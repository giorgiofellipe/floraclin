import type { FormSection } from '@/lib/forms/types'

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
  sections: FormSection[]
}
