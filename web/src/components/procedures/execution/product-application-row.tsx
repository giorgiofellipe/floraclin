'use client'

import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { FormFieldError } from '@/components/forms/form-field-error'
import type { ProcedureExecutionFormData } from '@/validations/procedure'

interface Props {
  control: Control<ProcedureExecutionFormData>
  form: UseFormReturn<ProcedureExecutionFormData>
  index: number
  productName: string
  totalQuantity: number
  quantityUnit: string
  isFirstForProduct: boolean
  isLastForProduct: boolean
  lotNumber: number
  entriesForProduct: number
  canRemove: boolean
  disabled?: boolean
  onRemove: () => void
  onAddBatch: () => void
}

export function ProductApplicationRow({
  control,
  form,
  index,
  productName,
  totalQuantity,
  quantityUnit,
  isFirstForProduct,
  isLastForProduct,
  lotNumber,
  entriesForProduct,
  canRemove,
  disabled,
  onRemove,
  onAddBatch,
}: Props) {
  return (
    <div>
      {isFirstForProduct && (
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-medium text-charcoal">{productName}</h4>
          <Badge
            variant="outline"
            className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5"
          >
            {totalQuantity}
            {quantityUnit}
          </Badge>
        </div>
      )}

      <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-5">
        {entriesForProduct > 1 && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-mid uppercase tracking-wider">
              Lote {lotNumber}
            </span>
            {canRemove && !disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onRemove}
              >
                <Trash2Icon className="size-3.5 text-mid" />
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Lote / Batch
            </Label>
            <Input
              {...form.register(`productApplications.${index}.batchNumber` as const)}
              placeholder="Ex: ABC12345"
              disabled={disabled}
              className="mt-1"
            />
            <FormFieldError form={form} name={`productApplications.${index}.batchNumber`} />
          </div>
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid">
              Validade
            </Label>
            <Controller
              control={control}
              name={`productApplications.${index}.expirationDate` as const}
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(v)}
                  disabled={disabled}
                  className="mt-1"
                />
              )}
            />
            <FormFieldError form={form} name={`productApplications.${index}.expirationDate`} />
          </div>
        </div>

        <div className="mt-3">
          <Label className="uppercase tracking-wider text-xs text-mid">
            Áreas de aplicação
          </Label>
          <Input
            {...form.register(`productApplications.${index}.applicationAreas` as const)}
            placeholder="Ex: Frontal, Glabela, Periorbital"
            disabled={disabled}
            className="mt-1"
          />
          <FormFieldError form={form} name={`productApplications.${index}.applicationAreas`} />
        </div>
      </div>

      {isLastForProduct && !disabled && (
        <div className="mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddBatch}
            className="text-xs border-sage/30 text-sage hover:bg-sage/5"
          >
            <PlusIcon className="size-3.5 mr-1" />
            Adicionar lote
          </Button>
        </div>
      )}
    </div>
  )
}
