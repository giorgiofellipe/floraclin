'use client'

import { Loader2, Stethoscope } from 'lucide-react'
import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { FormFieldError } from '@/components/forms/form-field-error'
import type { ProcedurePlanningFormData } from '@/validations/procedure'

export interface ProcedureType {
  id: string
  name: string
  category: string
  defaultPrice: string | null
  estimatedDurationMin: number | null
}

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  procedureTypes: ProcedureType[]
  loading?: boolean
  disabled?: boolean
}

export function ProcedureTypesSection({
  control,
  form,
  procedureTypes,
  loading,
  disabled,
}: Props) {
  return (
    <Card className="bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <Stethoscope className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-[#2A2A2A] font-medium">
            Tipo de Procedimento
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-mid">
            <Loader2 className="size-4 animate-spin" />
            Carregando tipos...
          </div>
        ) : (
          <Controller
            control={control}
            name="procedureTypeId"
            render={({ field: primaryField }) => (
              <Controller
                control={control}
                name="additionalTypeIds"
                render={({ field: additionalField }) => {
                  const procedureTypeId = primaryField.value
                  const additionalTypeIds = additionalField.value ?? []

                  function handleToggle(typeId: string) {
                    if (disabled) return
                    const allSelected = [procedureTypeId, ...additionalTypeIds]
                    const isSelected = allSelected.includes(typeId)
                    if (isSelected) {
                      if (typeId === procedureTypeId) {
                        if (additionalTypeIds.length > 0) {
                          primaryField.onChange(additionalTypeIds[0])
                          additionalField.onChange(additionalTypeIds.slice(1))
                        } else {
                          primaryField.onChange('')
                        }
                      } else {
                        additionalField.onChange(
                          additionalTypeIds.filter((id) => id !== typeId),
                        )
                      }
                    } else {
                      if (!procedureTypeId) {
                        primaryField.onChange(typeId)
                      } else {
                        additionalField.onChange([...additionalTypeIds, typeId])
                      }
                    }
                  }

                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-mid">
                        Selecione um ou mais tipos (o primeiro será o principal).
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {procedureTypes.map((type) => {
                          const allSelected = [procedureTypeId, ...additionalTypeIds]
                          const isSelected = allSelected.includes(type.id)
                          return (
                            <button
                              key={type.id}
                              type="button"
                              onClick={() => handleToggle(type.id)}
                              disabled={disabled}
                              className={cn(
                                'flex items-center gap-3 rounded-[3px] border p-3 text-left text-sm transition-colors',
                                isSelected
                                  ? 'border-sage bg-sage/5 text-charcoal'
                                  : 'border-[#E8ECEF] bg-white text-mid hover:border-sage/50 hover:bg-[#F4F6F8]',
                                disabled && 'cursor-default opacity-70',
                              )}
                            >
                              <div
                                className={cn(
                                  'flex size-5 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors',
                                  isSelected
                                    ? 'border-sage bg-sage'
                                    : 'border-[#E8ECEF]',
                                )}
                              >
                                {isSelected && (
                                  <svg
                                    className="size-3 text-white"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-charcoal">
                                  {type.name}
                                </span>
                                {type.defaultPrice && (
                                  <span className="ml-2 text-xs text-mid">
                                    R$ {parseFloat(type.defaultPrice).toFixed(2)}
                                  </span>
                                )}
                                {type.id === procedureTypeId && (
                                  <span className="ml-2 text-xs text-sage font-medium">
                                    (principal)
                                  </span>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <FormFieldError form={form} name="procedureTypeId" />
                    </div>
                  )
                }}
              />
            )}
          />
        )}
      </CardContent>
    </Card>
  )
}
