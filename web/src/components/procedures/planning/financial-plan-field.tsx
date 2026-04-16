'use client'

import { Controller, type Control, type UseFormReturn } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MaskedInput } from '@/components/ui/masked-input'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { FormFieldError, hasFieldError } from '@/components/forms/form-field-error'
import { cn } from '@/lib/utils'
import type { ProcedurePlanningFormData } from '@/validations/procedure'
import type { PaymentMethod } from '@/types'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}x${i === 0 ? ' (à vista)' : ''}`])
)

interface Props {
  control: Control<ProcedurePlanningFormData>
  form: UseFormReturn<ProcedurePlanningFormData>
  disabled?: boolean
}

export function FinancialPlanField({ control, form, disabled }: Props) {
  return (
    <Controller
      control={control}
      name="financialPlan"
      render={({ field }) => {
        const value = field.value ?? {
          totalAmount: 0,
          installmentCount: 1,
          paymentMethod: undefined as PaymentMethod | undefined,
          notes: '',
        }
        const update = (patch: Partial<typeof value>) =>
          field.onChange({ ...value, ...patch })

        // Display the totalAmount as a masked currency string for the UI
        const maskedTotal = value.totalAmount
          ? maskCurrency(String(Math.round(value.totalAmount * 100)))
          : ''

        const totalAmountHasError = hasFieldError(form, 'financialPlan.totalAmount')
        const installmentCountHasError = hasFieldError(form, 'financialPlan.installmentCount')
        const notesHasError = hasFieldError(form, 'financialPlan.notes')

        return (
          <div className="space-y-5">
            <p className="text-xs text-mid">
              Defina o valor e condições de pagamento. A entrada financeira será criada somente após a aprovação.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label
                  className={cn(
                    'uppercase tracking-wider text-xs mb-2 block',
                    totalAmountHasError ? 'text-red-600' : 'text-mid',
                  )}
                >
                  Valor total
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mid">
                    R$
                  </span>
                  <MaskedInput
                    mask={maskCurrency}
                    value={maskedTotal}
                    onChange={(e) =>
                      update({ totalAmount: parseCurrency(e.target.value) })
                    }
                    placeholder="0,00"
                    disabled={disabled}
                    aria-invalid={totalAmountHasError || undefined}
                    className={cn(
                      'pl-10',
                      totalAmountHasError
                        ? 'border-red-200 bg-red-50 focus:border-red-400'
                        : 'border-sage/20 focus:border-sage/40',
                    )}
                  />
                </div>
                <FormFieldError form={form} name="financialPlan.totalAmount" />
              </div>

              <div>
                <Label
                  className={cn(
                    'uppercase tracking-wider text-xs mb-2 block',
                    installmentCountHasError ? 'text-red-600' : 'text-mid',
                  )}
                >
                  Parcelas
                </Label>
                <Select
                  items={INSTALLMENT_COUNT_ITEMS}
                  value={String(value.installmentCount)}
                  onValueChange={(v) =>
                    update({ installmentCount: parseInt(String(v ?? '1'), 10) })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    aria-invalid={installmentCountHasError || undefined}
                    className={cn(
                      installmentCountHasError
                        ? 'border-red-200 bg-red-50 focus:border-red-400'
                        : 'border-sage/20 focus:border-sage/40',
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <FormFieldError form={form} name="financialPlan.installmentCount" />
              </div>
            </div>

            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Forma de pagamento
              </Label>
              <Select
                items={PAYMENT_METHOD_LABELS}
                value={value.paymentMethod ?? ''}
                onValueChange={(v) =>
                  update({ paymentMethod: (v || undefined) as PaymentMethod | undefined })
                }
                disabled={disabled}
              >
                <SelectTrigger className="max-w-sm border-sage/20 focus:border-sage/40">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>

            <div>
              <Label
                className={cn(
                  'uppercase tracking-wider text-xs mb-2 block',
                  notesHasError ? 'text-red-600' : 'text-mid',
                )}
              >
                Observações
              </Label>
              <Textarea
                value={value.notes ?? ''}
                onChange={(e) => update({ notes: e.target.value })}
                placeholder="Condições especiais, descontos, etc."
                disabled={disabled}
                maxLength={1000}
                aria-invalid={notesHasError || undefined}
                className={cn(
                  'min-h-[60px] resize-none',
                  notesHasError
                    ? 'border-red-200 bg-red-50 focus:border-red-400'
                    : 'border-sage/20 focus:border-sage/40',
                )}
                rows={2}
              />
              <FormFieldError form={form} name="financialPlan.notes" />
            </div>

            {maskedTotal && value.installmentCount > 1 && (
              <div className="rounded-[3px] bg-[#F4F6F8] p-3">
                <p className="text-xs text-mid">
                  {value.installmentCount}x de{' '}
                  <span className="font-medium text-charcoal">
                    R${' '}
                    {(value.totalAmount / value.installmentCount).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </p>
              </div>
            )}
          </div>
        )
      }}
    />
  )
}
