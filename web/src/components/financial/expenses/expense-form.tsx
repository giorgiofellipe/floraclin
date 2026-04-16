'use client'

import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { CreateCategoryModal } from './create-category-modal'
import { useForm, Controller } from 'react-hook-form'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import { useCreateExpense } from '@/hooks/mutations/use-expense-mutations'
import { useExpenseCategories } from '@/hooks/queries/use-financial-settings'
import { formatCurrency, formatDate } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { addDays, format } from 'date-fns'
import { getCategoryIcon } from './category-icon'

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i + 1), `${i + 1}x`])
)

interface ExpenseFormProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

interface FormValues {
  categoryId: string
  description: string
  totalAmount: string
  installmentCount: string
  notes: string
  dueDates: string[]
}

interface Category {
  id: string
  name: string
  icon: string
}

export function ExpenseForm({ open, onClose, onSuccess }: ExpenseFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
  const createExpense = useCreateExpense()
  const { data: categoriesResponse } = useExpenseCategories()
  const categoryList: Category[] = (categoriesResponse?.data as Category[]) ?? []
  const categoryItems = useMemo(
    () => Object.fromEntries(categoryList.map((c) => [c.id, c.name])),
    [categoryList],
  )

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      categoryId: '',
      description: '',
      totalAmount: '',
      installmentCount: '1',
      notes: '',
      dueDates: [format(new Date(), 'yyyy-MM-dd')],
    },
  })

  const totalAmountRaw = watch('totalAmount')
  const installmentCountRaw = watch('installmentCount')
  const dueDates = watch('dueDates')

  const parsedAmount = totalAmountRaw ? parseCurrency(totalAmountRaw) : 0
  const parsedCount = Math.max(1, Math.min(24, parseInt(installmentCountRaw, 10) || 1))

  // When installment count changes, reset custom due dates array
  const handleInstallmentCountChange = (value: string | null) => {
    if (!value) return
    setValue('installmentCount', value)
    const count = Math.max(1, Math.min(24, parseInt(value, 10) || 1))
    const today = new Date()
    const newDates = Array.from({ length: count }, (_, i) =>
      format(addDays(today, i * 30), 'yyyy-MM-dd')
    )
    setValue('dueDates', newDates)
  }

  const installmentPreview = useMemo(() => {
    if (parsedAmount <= 0 || parsedCount < 1) return []

    const installmentAmount = Math.floor((parsedAmount * 100) / parsedCount) / 100
    const remainder = Math.round((parsedAmount - installmentAmount * parsedCount) * 100) / 100
    const today = new Date()

    return Array.from({ length: parsedCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const dueDate = dueDates[i]
        ? new Date(dueDates[i] + 'T12:00:00')
        : addDays(today, i * 30)
      return {
        number: i + 1,
        amount,
        dueDate,
      }
    })
  }, [parsedAmount, parsedCount, dueDates])

  async function onSubmit(data: FormValues) {
    setError(null)
    const amount = parseCurrency(data.totalAmount)
    const count = Math.max(1, Math.min(24, parseInt(data.installmentCount, 10) || 1))

    if (amount <= 0) {
      setError('Valor deve ser positivo')
      return
    }

    if (!data.categoryId) {
      setError('Selecione uma categoria')
      return
    }

    try {
      await createExpense.mutateAsync({
        categoryId: data.categoryId,
        description: data.description,
        totalAmount: amount,
        installmentCount: count,
        notes: data.notes || undefined,
        customDueDates: data.dueDates.slice(0, count),
      })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar despesa')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">Nova Despesa</DialogTitle>
          <DialogDescription className="text-mid">
            Preencha os dados da despesa e defina o parcelamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" data-testid="expense-form">
          {/* Category select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Categoria</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-[#4A6B52]"
                onClick={() => setCreateCategoryOpen(true)}
              >
                <PlusIcon className="h-3 w-3" />
                Nova categoria
              </Button>
            </div>
            <Controller
              name="categoryId"
              control={control}
              rules={{ required: 'Categoria é obrigatória' }}
              render={({ field }) => (
                <Select items={categoryItems} value={field.value} onValueChange={(v) => field.onChange(v ?? '')}>
                  <SelectTrigger className="w-full" data-testid="expense-category-select">
                    <SelectValue placeholder="Selecione a categoria" />
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
            {errors.categoryId && (
              <p className="text-sm text-destructive">{errors.categoryId.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="expense-description" className="uppercase tracking-wider text-xs font-medium text-mid">Descrição</Label>
            <Input
              id="expense-description"
              {...register('description', { required: 'Descrição é obrigatória' })}
              placeholder="Ex: Aluguel do consultório"
              data-testid="expense-description"
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          {/* Total amount */}
          <div className="space-y-2">
            <Label htmlFor="expense-amount" className="uppercase tracking-wider text-xs font-medium text-mid">Valor Total (R$)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                R$
              </span>
              <Controller
                name="totalAmount"
                control={control}
                rules={{ required: 'Valor é obrigatório' }}
                render={({ field }) => (
                  <MaskedInput
                    id="expense-amount"
                    mask={maskCurrency}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    placeholder="0,00"
                    className="pl-10 text-lg font-medium"
                    inputMode="numeric"
                    data-testid="expense-amount"
                  />
                )}
              />
            </div>
            {errors.totalAmount && (
              <p className="text-sm text-destructive">{errors.totalAmount.message}</p>
            )}
          </div>

          {/* Installment count */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Parcelas</Label>
            <Select items={INSTALLMENT_COUNT_ITEMS} value={installmentCountRaw} onValueChange={handleInstallmentCountChange}>
              <SelectTrigger className="w-full" data-testid="expense-installment-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          {/* Custom due date inputs */}
          {parsedCount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">Datas de vencimento</p>
              <div className="space-y-2">
                {Array.from({ length: parsedCount }, (_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-mid w-20">{i + 1}a parcela</span>
                    <DatePicker
                      className="w-[160px]"
                      value={dueDates[i] || ''}
                      onChange={(v) => {
                        const newDates = [...dueDates]
                        newDates[i] = v
                        setValue('dueDates', newDates)
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Installment preview */}
          {installmentPreview.length > 0 && parsedAmount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3" data-testid="installment-preview">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">Prévia das parcelas</p>
              <div className="space-y-2">
                {installmentPreview.map((inst) => (
                  <div
                    key={inst.number}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-mid">
                      {inst.number}a parcela -- {formatDate(inst.dueDate)}
                    </span>
                    <span className="font-medium text-charcoal tabular-nums">
                      {formatCurrency(inst.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="expense-notes" className="uppercase tracking-wider text-xs font-medium text-mid">Observações</Label>
            <Textarea
              id="expense-notes"
              {...register('notes')}
              placeholder="Observações opcionais..."
              rows={2}
              data-testid="expense-notes"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="expense-form-error">{error}</p>
          )}

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button type="button" variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createExpense.isPending}
              className="bg-forest text-cream hover:bg-sage transition-colors"
              data-testid="expense-form-submit"
            >
              {createExpense.isPending ? 'Salvando...' : 'Criar Despesa'}
            </Button>
          </DialogFooter>
        </form>
        <CreateCategoryModal
          open={createCategoryOpen}
          onOpenChange={setCreateCategoryOpen}
          onCreated={(categoryId) => {
            setValue('categoryId', categoryId)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
