'use client'

import { useState, useMemo, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateExpense } from '@/hooks/mutations/use-expense-mutations'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { formatCurrency, formatDate } from '@/lib/utils'
import { addDays, format } from 'date-fns'
import { getCategoryIcon } from './category-icon'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'

interface Installment {
  id: string
  installmentNumber: number
  amount: string
  dueDate: string
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

interface Expense {
  id: string
  description: string
  categoryId: string
  notes: string | null
  totalAmount: string
  installmentCount: number
  status: string
  installments: Installment[]
}

interface ExpenseEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: Expense
}

interface Category {
  id: string
  name: string
  icon: string
}

interface FormValues {
  description: string
  categoryId: string
  notes: string
  totalAmount: string
  installmentCount: string
  unpaidDueDates: string[]
}

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i + 1), `${i + 1}x`]),
)

export function ExpenseEditDialog({ open, onOpenChange, expense }: ExpenseEditDialogProps) {
  const update = useUpdateExpense()
  const { data: categoriesResponse } = useExpenseCategories()
  const categoryList: Category[] = (categoriesResponse?.data as Category[]) ?? []
  const categoryItems = useMemo(
    () => Object.fromEntries(categoryList.map((c) => [c.id, c.name])),
    [categoryList],
  )

  const paid = expense.installments.filter((i) => i.status === 'paid')
  const paidCount = paid.length
  const sumPaidCents = paid.reduce(
    (acc, i) => acc + Math.round(Number(i.amount) * 100),
    0,
  )
  const sumPaid = sumPaidCents / 100
  const unpaid = expense.installments.filter((i) => i.status !== 'paid')

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      description: expense.description,
      categoryId: expense.categoryId,
      notes: expense.notes ?? '',
      totalAmount: maskCurrency(String(Math.round(Number(expense.totalAmount) * 100))),
      installmentCount: String(expense.installmentCount),
      unpaidDueDates: unpaid.map((u) => u.dueDate),
    },
  })

  const totalAmountRaw = watch('totalAmount')
  const installmentCountRaw = watch('installmentCount')
  const unpaidDueDates = watch('unpaidDueDates')

  const parsedAmount = totalAmountRaw ? parseCurrency(totalAmountRaw) : 0
  const totalCents = Math.round(parsedAmount * 100)
  const parsedCount = Math.max(1, Math.min(24, parseInt(installmentCountRaw, 10) || 1))
  const unpaidCount = parsedCount - paidCount
  const remainingCents = totalCents - sumPaidCents

  // Client-side validation mirrors server constraints.
  const errorsList: string[] = []
  if (totalCents < sumPaidCents) errorsList.push('Valor menor que o já pago')
  if (parsedCount < paidCount) errorsList.push('Parcelas menor que as já pagas')
  if ((remainingCents === 0) !== (unpaidCount === 0)) {
    errorsList.push('Valor e parcelas inconsistentes')
  }

  // Compute distribution preview for unpaid rows (cents-integer arithmetic).
  const unpaidPreview = useMemo(() => {
    if (unpaidCount <= 0) return []
    const perSlotCents = Math.floor(remainingCents / unpaidCount)
    const remainderCents = remainingCents - perSlotCents * unpaidCount
    return Array.from({ length: unpaidCount }, (_, i) => {
      const amountCents = perSlotCents + (i === 0 ? remainderCents : 0)
      return { amount: amountCents / 100, dueDate: unpaidDueDates[i] || '' }
    })
  }, [unpaidCount, remainingCents, unpaidDueDates])

  // Keep unpaidDueDates length in sync with unpaidCount in an effect
  // (not during render, to avoid feedback loops with RHF's watch()).
  useEffect(() => {
    if (unpaidCount < 0) return
    const current = unpaidDueDates
    if (current.length === unpaidCount) return
    const today = new Date()
    const next = Array.from({ length: unpaidCount }, (_, i) =>
      current[i] || format(addDays(today, (paidCount + i) * 30), 'yyyy-MM-dd'),
    )
    setValue('unpaidDueDates', next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaidCount, paidCount])

  async function onSubmit(data: FormValues) {
    if (errorsList.length > 0) return
    try {
      await update.mutateAsync({
        id: expense.id,
        description: data.description.trim(),
        categoryId: data.categoryId,
        notes: data.notes.trim() || undefined,
        totalAmount: parseCurrency(data.totalAmount),
        installmentCount: parsedCount,
        unpaidDueDates: data.unpaidDueDates.slice(0, unpaidCount),
      })
      toast.success('Despesa atualizada')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  const isInvalid = errorsList.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar despesa</DialogTitle>
          <DialogDescription>
            Parcelas já pagas ficam bloqueadas. Você pode ajustar valor, número de parcelas e datas das pendentes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Scalar fields */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Categoria</Label>
            <Controller
              name="categoryId"
              control={control}
              rules={{ required: 'Categoria é obrigatória' }}
              render={({ field }) => (
                <Select
                  items={categoryItems}
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryList.map((cat) => {
                      const Icon = getCategoryIcon(cat.icon)
                      return (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-4 text-sage" />
                            {cat.name}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description" className="uppercase tracking-wider text-xs font-medium text-mid">
              Descrição
            </Label>
            <Input
              id="edit-description"
              {...register('description', { required: 'Descrição é obrigatória' })}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-amount" className="uppercase tracking-wider text-xs font-medium text-mid">
                Valor Total
              </Label>
              <Controller
                name="totalAmount"
                control={control}
                render={({ field }) => (
                  <MaskedInput
                    id="edit-amount"
                    mask={maskCurrency}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">
                Parcelas
              </Label>
              <Select
                items={INSTALLMENT_COUNT_ITEMS}
                value={installmentCountRaw}
                onValueChange={(v) => v && setValue('installmentCount', v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes" className="uppercase tracking-wider text-xs font-medium text-mid">
              Observações
            </Label>
            <Textarea id="edit-notes" {...register('notes')} rows={2} />
          </div>

          {/* Paid installments (locked) */}
          {paidCount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">
                {paidCount} parcelas pagas · {formatCurrency(sumPaid)}
              </p>
              <div className="space-y-1">
                {paid.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm text-mid">
                    <span className="flex items-center gap-2">
                      <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />
                      Parcela {p.installmentNumber} — {p.paidAt ? formatDate(p.paidAt) : ''}
                      {p.paymentMethod ? ` · ${PAYMENT_METHOD_ITEMS[p.paymentMethod] ?? p.paymentMethod}` : ''}
                    </span>
                    <span className="tabular-nums">{formatCurrency(Number(p.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unpaid slots (editable dates) */}
          {unpaidCount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">
                Parcelas pendentes
              </p>
              <div className="space-y-2">
                {unpaidPreview.map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-mid w-24">
                      {paidCount + i + 1}ª parcela
                    </span>
                    <DatePicker
                      className="w-[160px]"
                      value={unpaidDueDates[i] || ''}
                      onChange={(v) => {
                        const next = [...unpaidDueDates]
                        next[i] = v
                        setValue('unpaidDueDates', next)
                      }}
                    />
                    <span className="ml-auto text-sm font-medium text-charcoal tabular-nums">
                      {formatCurrency(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error surface */}
          {errorsList.length > 0 && (
            <div className="text-sm text-destructive space-y-1">
              {errorsList.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isInvalid || update.isPending}>
              {update.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
