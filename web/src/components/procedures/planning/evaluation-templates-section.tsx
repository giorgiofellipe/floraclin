'use client'

import { Loader2, Stethoscope } from 'lucide-react'
import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { TemplateRenderer } from '@/components/evaluation/template-renderer'
import { FormFieldError } from '@/components/forms/form-field-error'
import type { ProcedurePlanningFormData } from '@/validations/procedure'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import type { EvaluationSection } from '@/types/evaluation'

export interface EvaluationTemplateForForm {
  id: string
  procedureTypeId: string
  procedureTypeName: string
  sections: EvaluationSection[]
  version: number
}

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  templates: EvaluationTemplateForForm[]
  isLoading: boolean
  readOnly?: boolean
  patientGender?: string | null
  catalogProducts?: CatalogProduct[]
  showErrors?: boolean
}

export function EvaluationTemplatesSection({
  control,
  form,
  templates,
  isLoading,
  readOnly,
  patientGender,
  catalogProducts,
  showErrors,
}: Props) {
  if (isLoading) {
    return (
      <div className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-8">
        <div className="flex items-center justify-center gap-3">
          <Loader2 className="size-5 animate-spin text-sage" />
          <span className="text-sm text-mid">Carregando fichas de avaliação...</span>
        </div>
      </div>
    )
  }

  if (!templates || templates.length === 0) return null

  return (
    <Controller
      control={control}
      name="evaluationResponses"
      render={({ field: respField }) => (
        <Controller
          control={control}
          name="diagramPoints"
          render={({ field: diagramField }) => (
            <>
              {templates.map((template) => {
                // Face diagram is always rendered as a standalone section
                // after the evaluation templates — any face_diagram question
                // inside a template shows a "see diagram section below" hint
                // instead of its own editor.
                const passDiagramRendered = true

                const responses =
                  ((respField.value ?? {}) as Record<string, Record<string, unknown>>)[
                    template.id
                  ] ?? {}

                return (
                  <div key={template.id} className="space-y-0">
                    <div className="flex items-center gap-2.5 rounded-t-[3px] bg-forest/5 px-5 py-3 border border-b-0 border-[#E8ECEF]">
                      <div className="flex size-6 items-center justify-center rounded-full bg-forest/10">
                        <Stethoscope className="size-3.5 text-forest" />
                      </div>
                      <span className="text-sm font-semibold text-charcoal">
                        {template.procedureTypeName} — Ficha de Avaliação
                      </span>
                    </div>
                    <div className="rounded-b-[3px] border border-t-0 border-[#E8ECEF] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-5">
                      <TemplateRenderer
                        sections={template.sections}
                        responses={responses}
                        onChange={(r) =>
                          respField.onChange({
                            ...((respField.value ?? {}) as Record<string, unknown>),
                            [template.id]: r,
                          })
                        }
                        readOnly={readOnly}
                        patientGender={patientGender}
                        diagramPoints={(diagramField.value ?? []) as DiagramPointData[]}
                        onDiagramChange={(pts) => diagramField.onChange(pts)}
                        diagramRendered={passDiagramRendered}
                        products={catalogProducts}
                        showErrors={showErrors}
                      />
                    </div>
                    <FormFieldError
                      form={form}
                      name={`evaluationResponses.${template.id}`}
                    />
                  </div>
                )
              })}
            </>
          )}
        />
      )}
    />
  )
}
