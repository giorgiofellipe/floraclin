'use client'

import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import { FormFieldError, hasFieldError } from '@/components/forms/form-field-error'
import { cn } from '@/lib/utils'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import type { ProcedurePlanningFormData } from '@/validations/procedure'

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  previousPoints?: DiagramPointData[]
  gender?: string | null
  products?: CatalogProduct[]
  showComparison?: boolean
  readOnly?: boolean
}

export function DiagramSection({
  control,
  form,
  previousPoints,
  gender,
  products,
  showComparison,
  readOnly,
}: Props) {
  const invalid = hasFieldError(form, 'diagramPoints')
  return (
    <Controller
      control={control}
      name="diagramPoints"
      render={({ field }) => (
        <div
          aria-invalid={invalid || undefined}
          className={cn(
            'rounded-[3px] transition-colors',
            invalid && 'border border-red-200 bg-red-50 p-3',
          )}
        >
          <FaceDiagramEditor
            points={(field.value ?? []) as DiagramPointData[]}
            onChange={(pts) => field.onChange(pts)}
            previousPoints={previousPoints}
            showComparison={showComparison}
            readOnly={readOnly}
            gender={gender}
            products={products}
          />
          <FormFieldError form={form} name="diagramPoints" />
        </div>
      )}
    />
  )
}
