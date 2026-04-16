'use client'

import type { UseFieldArrayReturn, UseFormReturn } from 'react-hook-form'
import { ProductApplicationRow } from './product-application-row'
import type { ProcedureExecutionFormData, ProductApplicationItem } from '@/validations/procedure'

interface Props {
  form: UseFormReturn<ProcedureExecutionFormData>
  fieldArray: UseFieldArrayReturn<ProcedureExecutionFormData, 'productApplications'>
  disabled?: boolean
}

export function ProductApplicationsSection({ form, fieldArray, disabled }: Props) {
  // Watch the live field array to compute grouping metadata
  const watched = form.watch('productApplications') ?? []

  return (
    <div className="space-y-4">
      {fieldArray.fields.map((fieldItem, index) => {
        const app = (watched[index] ?? {}) as Partial<ProductApplicationItem>
        const prev = (watched[index - 1] ?? {}) as Partial<ProductApplicationItem>
        const next = (watched[index + 1] ?? {}) as Partial<ProductApplicationItem>
        const productName = app.productName ?? ''
        const quantityUnit = String(app.quantityUnit ?? '')
        const totalQuantity = Number(app.totalQuantity ?? 0)

        const isFirstForProduct = index === 0 || prev.productName !== productName
        const isLastForProduct =
          index === fieldArray.fields.length - 1 || next.productName !== productName
        const entriesForProduct = watched.filter(
          (a) => (a as Partial<ProductApplicationItem>).productName === productName
        ).length
        const canRemove = entriesForProduct > 1
        // Compute lot number (1-indexed among entries for same product up to this index)
        const lotNumber = watched
          .slice(0, index + 1)
          .filter((a) => (a as Partial<ProductApplicationItem>).productName === productName)
          .length

        return (
          <ProductApplicationRow
            key={fieldItem.id}
            control={form.control}
            form={form}
            index={index}
            productName={productName}
            totalQuantity={totalQuantity}
            quantityUnit={quantityUnit}
            isFirstForProduct={isFirstForProduct}
            isLastForProduct={isLastForProduct}
            lotNumber={lotNumber}
            entriesForProduct={entriesForProduct}
            canRemove={canRemove}
            disabled={disabled}
            onRemove={() => fieldArray.remove(index)}
            onAddBatch={() => {
              const source = watched[index] as Partial<ProductApplicationItem> | undefined
              fieldArray.insert(index + 1, {
                productName: source?.productName ?? '',
                activeIngredient: source?.activeIngredient,
                totalQuantity: 0,
                quantityUnit: (source?.quantityUnit ?? 'U') as 'U' | 'mL',
              })
            }}
          />
        )
      })}
    </div>
  )
}
