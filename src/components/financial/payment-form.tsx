'use client'

import { useMemo, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateFinancialEntry } from '@/hooks/mutations/use-financial-mutations'
import { formatCurrency, formatDate } from '@/lib/utils'
import { addDays } from 'date-fns'
import { maskCurrency, parseCurrency } from '@/lib/masks'

interface Patient {
  id: string
  fullName: string
}

interface PaymentFormProps {
  patients: Patient[]
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PaymentForm({ patients, open, onClose, onSuccess }: PaymentFormProps) {
  const [patientId, setPatientId] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [patientSearch, setPatientSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null)
  const createFinancialEntry = useCreateFinancialEntry()
  const isPending = createFinancialEntry.isPending

  const parsedAmount = totalAmount ? parseCurrency(totalAmount) : 0
  const parsedCount = parseInt(installmentCount, 10) || 1

  const installmentPreview = useMemo(() => {
    if (parsedAmount <= 0 || parsedCount < 1) return []

    const installmentAmount = Math.floor((parsedAmount * 100) / parsedCount) / 100
    const remainder = Math.round((parsedAmount - installmentAmount * parsedCount) * 100) / 100
    const today = new Date()

    return Array.from({ length: parsedCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      return {
        number: i + 1,
        amount,
        dueDate: addDays(today, i * 30),
      }
    })
  }, [parsedAmount, parsedCount])

  const filteredPatients = patients.filter((p) =>
    p.fullName.toLowerCase().includes(patientSearch.toLowerCase())
  )

  function handleAmountChange(value: string) {
    setTotalAmount(maskCurrency(value))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-charcoal">Nova Cobrança</DialogTitle>
          <DialogDescription className="text-mid">
            Preencha os dados da cobrança e defina o parcelamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          setFieldErrors(null)
          const formData = new FormData(e.currentTarget)
          try {
            await createFinancialEntry.mutateAsync({
              patientId,
              description: (formData.get('description') as string) || '',
              totalAmount: parsedAmount,
              installmentCount: parsedCount,
              notes: (formData.get('notes') as string) || undefined,
            })
            onSuccess()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao criar cobrança')
          }
        }} className="space-y-5" data-testid="payment-form">

          {/* Patient select */}
          <div className="space-y-2">
            <Label htmlFor="patientSelect" className="uppercase tracking-wider text-xs font-medium text-mid">Paciente</Label>
            <Select value={patientId} onValueChange={(v) => setPatientId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o paciente">
                  {(value: string) => patients.find((p) => p.id === value)?.fullName ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors?.patientId && (
              <p className="text-sm text-destructive">{fieldErrors.patientId[0]}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="uppercase tracking-wider text-xs font-medium text-mid">Descricao</Label>
            <Input
              id="description"
              name="description"
              placeholder="Ex: Aplicação de toxina botulínica"
              required
            />
            {fieldErrors?.description && (
              <p className="text-sm text-destructive">{fieldErrors.description[0]}</p>
            )}
          </div>

          {/* Total amount */}
          <div className="space-y-2">
            <Label htmlFor="totalAmountInput" className="uppercase tracking-wider text-xs font-medium text-mid">Valor Total (R$)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                R$
              </span>
              <MaskedInput
                id="totalAmountInput"
                mask={maskCurrency}
                value={totalAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0,00"
                className="pl-10 text-lg font-medium"
                inputMode="numeric"
                data-testid="payment-form-amount"
              />
            </div>
            {fieldErrors?.totalAmount && (
              <p className="text-sm text-destructive">{fieldErrors.totalAmount[0]}</p>
            )}
          </div>

          {/* Installment count */}
          <div className="space-y-2">
            <Label htmlFor="installmentCountSelect" className="uppercase tracking-wider text-xs font-medium text-mid">Parcelas</Label>
            <Select value={installmentCount} onValueChange={(v) => setInstallmentCount(v ?? '1')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors?.installmentCount && (
              <p className="text-sm text-destructive">{fieldErrors.installmentCount[0]}</p>
            )}
          </div>

          {/* Installment preview */}
          {installmentPreview.length > 0 && parsedAmount > 0 && (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">Previa das parcelas</p>
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
            <Label htmlFor="notes" className="uppercase tracking-wider text-xs font-medium text-mid">Observações</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observações opcionais..."
              rows={2}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="pt-2 border-t border-sage/10">
            <Button type="button" variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !patientId || parsedAmount <= 0} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="payment-form-submit">
              {isPending ? 'Salvando...' : 'Criar Cobrança'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
